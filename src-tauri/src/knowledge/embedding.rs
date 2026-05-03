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

/// Generate embedding vector using local Ollama API
pub async fn embed_text(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
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
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama embedding 失败 ({}): {}", status, text));
    }

    let data: EmbedResponse = resp
        .json()
        .await
        .map_err(|e| format!("Ollama 响应解析失败: {}", e))?;

    data.embeddings
        .into_iter()
        .next()
        .ok_or("Ollama 未返回嵌入向量".to_string())
}
