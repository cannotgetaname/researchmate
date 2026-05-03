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
}

impl LlmEngine {
    pub fn new(config: &AppConfig) -> Self {
        let openai_config = async_openai::config::OpenAIConfig::new()
            .with_api_base(&config.deepseek_base_url)
            .with_api_key(&config.deepseek_api_key);

        Self {
            client: Client::with_config(openai_config),
            model: config.model_name.clone(),
        }
    }

    /// Stream chat: each delta is sent through the callback
    pub async fn chat_stream(
        &self,
        system_prompt: &str,
        messages: &[(String, String)], // (role, content)
        user_message: &str,
        on_chunk: impl Fn(String),
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
