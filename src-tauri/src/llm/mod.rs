use async_openai::{
    types::{
        ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use futures::StreamExt;

use crate::config::AppConfig;

pub struct LlmEngine {
    client: Client<async_openai::config::OpenAIConfig>,
    model: String,
    api_base: String,
    api_key: String,
}

impl LlmEngine {
    pub fn new(config: &AppConfig, model: &str) -> Self {
        let openai_config = async_openai::config::OpenAIConfig::new()
            .with_api_base(&config.deepseek_base_url)
            .with_api_key(&config.deepseek_api_key);

        Self {
            client: Client::with_config(openai_config),
            model: model.to_string(),
            api_base: config.deepseek_base_url.clone(),
            api_key: config.deepseek_api_key.clone(),
        }
    }

    /// Stream chat with DeepSeek thinking mode (via reqwest, supports reasoning_content)
    pub async fn chat_stream_thinking(
        &self,
        system_prompt: &str,
        messages: &[(String, String)],
        user_message: &str,
        mut on_chunk: impl FnMut(String),
        mut on_stage: impl FnMut(&str),
    ) -> Result<String, String> {
        let mut request_messages: Vec<serde_json::Value> = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
        ];

        for (role, content) in messages {
            request_messages.push(serde_json::json!({
                "role": role,
                "content": content,
            }));
        }
        request_messages.push(serde_json::json!({
            "role": "user",
            "content": user_message,
        }));

        let body = serde_json::json!({
            "model": self.model,
            "messages": request_messages,
            "stream": true,
            "thinking": {"type": "enabled"},
        });

        let client = reqwest::Client::new();
        let response = client
            .post(format!("{}/chat/completions", self.api_base))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        let mut stream = response.bytes_stream();
        let mut full = String::new();
        let mut reasoning = String::new();
        let mut stage = "thinking";

        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);

            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() || line == "data: [DONE]" {
                    continue;
                }
                let json_str = line.strip_prefix("data: ").unwrap_or("");
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(choices) = parsed["choices"].as_array() {
                        if let Some(choice) = choices.first() {
                            let delta = &choice["delta"];

                            // reasoning_content comes first
                            if let Some(rc) = delta["reasoning_content"].as_str() {
                                reasoning.push_str(rc);
                                if stage == "thinking" {
                                    on_stage("thinking");
                                    stage = "editing";
                                }
                                on_chunk(rc.to_string());
                            }
                            // then content
                            if let Some(c) = delta["content"].as_str() {
                                if stage == "editing" {
                                    on_stage("editing");
                                    stage = "done";
                                }
                                full.push_str(c);
                                on_chunk(c.to_string());
                            }
                        }
                    }
                }
            }
        }

        Ok(format!("{}\n---\n{}", reasoning, full))
    }

    /// Non-streaming chat with tool calling support (uses raw reqwest for reasoning_content support).
    /// `on_reasoning` is called with each reasoning_content delta from the API response.
    pub async fn chat_with_tools(
        &self,
        system_prompt: &str,
        messages: &[(String, String)],
        user_message: &str,
        tools: Vec<(String, String, serde_json::Value)>,
        mut execute_tool: impl FnMut(&str, serde_json::Value) -> Result<String, String>,
        mut on_reasoning: impl FnMut(String),
    ) -> Result<String, String> {
        // Build initial messages as raw JSON
        let mut msgs: Vec<serde_json::Value> = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
        ];
        for (role, content) in messages {
            msgs.push(serde_json::json!({"role": role, "content": content}));
        }
        msgs.push(serde_json::json!({"role": "user", "content": user_message}));

        let tool_defs: Vec<serde_json::Value> = tools.iter().map(|(name, desc, params)| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": desc,
                    "parameters": params,
                }
            })
        }).collect();

        let client = reqwest::Client::new();
        let url = format!("{}/chat/completions", self.api_base);

        for round in 0..10 {
            eprintln!("[llm] tool loop round {}", round);
            let body = serde_json::json!({
                "model": self.model,
                "messages": msgs,
                "tools": tool_defs,
            });

            let resp = client.post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("API error: {}", e))?;

            let data: serde_json::Value = resp.json().await.map_err(|e| format!("JSON error: {}", e))?;
            eprintln!("[llm] API response received");
            let choice = data["choices"][0].clone();
            let msg = &choice["message"];

            // Forward reasoning_content to the callback
            if let Some(rc) = msg.get("reasoning_content").and_then(|v| v.as_str()) {
                on_reasoning(rc.to_string());
            }

            // If no tool calls, return content
            let tool_calls = msg["tool_calls"].as_array();
            if tool_calls.is_none() || tool_calls.unwrap().is_empty() {
                eprintln!("[llm] no tool calls, returning content");
                return Ok(msg["content"].as_str().unwrap_or("").to_string());
            }

            let tool_calls = tool_calls.unwrap();
            eprintln!("[llm] got {} tool calls", tool_calls.len());

            // Build assistant message to push back (preserve reasoning_content if present)
            let mut assistant_msg = serde_json::json!({
                "role": "assistant",
                "content": msg["content"],
            });
            if let Some(rc) = msg.get("reasoning_content") {
                assistant_msg["reasoning_content"] = rc.clone();
            }
            
            let mut tc_array = Vec::new();
            let mut tool_results = Vec::new();
            for tc in tool_calls {
                let name = tc["function"]["name"].as_str().unwrap_or("");
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let args: serde_json::Value = serde_json::from_str(args_str).unwrap_or(serde_json::Value::Null);
                let tc_id = tc["id"].as_str().unwrap_or("").to_string();

                let result = execute_tool(name, args)?;

                tc_array.push(serde_json::json!({
                    "id": tc_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": args_str,
                    }
                }));
                tool_results.push((tc_id, result));
            }
            assistant_msg["tool_calls"] = serde_json::json!(tc_array);
            
            // Assistant message with tool_calls FIRST
            msgs.push(assistant_msg);
            // Then tool results
            for (tc_id, result) in tool_results {
                msgs.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": result,
                }));
            }
        }

        Err("工具调用超过最大轮次".to_string())
    }

    /// Stream chat: each delta is sent through the callback
    pub async fn chat_stream(
        &self,
        system_prompt: &str,
        messages: &[(String, String)], // (role, content)
        user_message: &str,
        mut on_chunk: impl FnMut(String),
    ) -> Result<String, String> {
        let mut request_messages = vec![
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt.to_string())
                .build()
                .unwrap()
                .into(),
        ];

        for (role, content) in messages {
            if role == "user" {
                request_messages.push(
                    ChatCompletionRequestUserMessageArgs::default()
                        .content(content.clone())
                        .build()
                        .unwrap()
                        .into(),
                );
            } else if role == "assistant" {
                request_messages.push(
                    ChatCompletionRequestAssistantMessageArgs::default()
                        .content(content.clone())
                        .build()
                        .unwrap()
                        .into(),
                );
            }
        }

        request_messages.push(
            ChatCompletionRequestUserMessageArgs::default()
                .content(user_message.to_string())
                .build()
                .unwrap()
                .into(),
        );

        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(request_messages)
            .stream(true)
            .build()
            .map_err(|e| format!("Failed to build request: {}", e))?;

        let mut stream = self
            .client
            .chat()
            .create_stream(request)
            .await
            .map_err(|e| format!("Failed to create stream: {}", e))?;

        let mut full_response = String::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    if let Some(choice) = response.choices.first() {
                        if let Some(delta) = &choice.delta.content {
                            on_chunk(delta.clone());
                            full_response.push_str(delta);
                        }
                    }
                }
                Err(e) => return Err(format!("Stream error: {}", e)),
            }
        }

        Ok(full_response)
    }
}
