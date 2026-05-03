use serde::{Deserialize, Serialize};

use crate::config::AppConfig;

#[derive(Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: Vec<&'a str>,
}

#[derive(Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

/// Generate embedding vector. Dispatches to configured provider.
pub async fn embed_text(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
    match config.embedding_provider.as_str() {
        "openai" => embed_via_openai(text, config).await,
        _ => embed_via_ollama(text, config).await,
    }
}

/// Ollama local embedding
async fn embed_via_ollama(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
    let url = format!("{}/api/embed", config.embedding_base_url);
    let body = EmbedRequest {
        model: &config.embedding_model,
        input: vec![text],
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama 连接失败 ({}): {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Ollama embedding 失败 ({}): {} — 请确认 {} 模型已拉取 (ollama pull {})",
            resp.status(),
            resp.text().await.unwrap_or_default(),
            config.embedding_model,
            config.embedding_model,
        ));
    }

    let data: EmbedResponse = resp.json().await
        .map_err(|e| format!("Ollama 响应解析失败: {}", e))?;

    data.embeddings.into_iter().next()
        .ok_or("Ollama 未返回嵌入向量".to_string())
}

/// OpenAI-compatible embedding API (DeepSeek, SiliconFlow, etc.)
async fn embed_via_openai(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
    use async_openai::{
        types::CreateEmbeddingRequestArgs,
        Client,
    };

    let openai_config = async_openai::config::OpenAIConfig::new()
        .with_api_base(&config.embedding_base_url)
        .with_api_key(&config.deepseek_api_key);

    let client = Client::with_config(openai_config);

    let request = CreateEmbeddingRequestArgs::default()
        .model(&config.embedding_model)
        .input([text])
        .build()
        .map_err(|e| format!("构建 embedding 请求失败：{}", e))?;

    let response = client.embeddings().create(request).await
        .map_err(|e| format!("Embedding API 调用失败：{}", e))?;

    let vec = response.data.first()
        .ok_or("API 未返回嵌入向量")?
        .embedding.iter()
        .map(|f| *f as f32)
        .collect();

    Ok(vec)
}
