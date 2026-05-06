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

/// Synchronous version of embed_text — uses minreq (pure sync, no tokio).
/// Safe to call from non-async contexts (e.g. tool callbacks).
pub fn embed_text_sync(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
    let url = match config.embedding_provider.as_str() {
        "openai" => format!("{}/embeddings", config.embedding_base_url),
        _ => format!("{}/api/embed", config.embedding_base_url),
    };
    let body = serde_json::json!({
        "model": config.embedding_model,
        "input": [text],
    });

    let mut request = minreq::post(&url)
        .with_header("Content-Type", "application/json")
        .with_body(body.to_string());

    if config.embedding_provider == "openai" {
        request = request.with_header("Authorization", format!("Bearer {}", config.deepseek_api_key));
    }

    let resp = request.send().map_err(|e| format!("Embedding 调用失败：{}", e))?;
    let data: serde_json::Value = serde_json::from_str(resp.as_str().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    if config.embedding_provider == "openai" {
        let vec: Vec<f32> = data["data"][0]["embedding"]
            .as_array().ok_or("无效响应")?
            .iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect();
        Ok(vec)
    } else {
        let vec: Vec<f32> = data["embeddings"][0]
            .as_array().ok_or("无效响应")?
            .iter().map(|v| v.as_f64().unwrap_or(0.0) as f32).collect();
        Ok(vec)
    }
}

/// Generate embedding for a single text
pub async fn embed_text(text: &str, config: &AppConfig) -> Result<Vec<f32>, String> {
    match config.embedding_provider.as_str() {
        "openai" => embed_via_openai_batch(&[text], config).await
            .map(|mut v| v.pop().unwrap_or_default()),
        _ => embed_via_ollama_batch(&[text], config).await
            .map(|mut v| v.pop().unwrap_or_default()),
    }
}

/// Batch embed multiple texts in a single API call
pub async fn embed_batch(texts: &[String], config: &AppConfig) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() { return Ok(vec![]); }
    let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
    match config.embedding_provider.as_str() {
        "openai" => embed_via_openai_batch(&refs, config).await,
        _ => embed_via_ollama_batch(&refs, config).await,
    }
}

/// Ollama batch embedding — all chunks in one request
async fn embed_via_ollama_batch(texts: &[&str], config: &AppConfig) -> Result<Vec<Vec<f32>>, String> {
    let url = format!("{}/api/embed", config.embedding_base_url);
    let body = EmbedRequest {
        model: &config.embedding_model,
        input: texts.to_vec(),
    };

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Ollama 连接失败 ({}): {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Ollama embedding 失败 ({}): {}",
            resp.status(),
            resp.text().await.unwrap_or_default(),
        ));
    }

    let data: EmbedResponse = resp.json().await
        .map_err(|e| format!("Ollama 响应解析失败: {}", e))?;

    Ok(data.embeddings)
}

/// OpenAI-compatible batch embedding
async fn embed_via_openai_batch(texts: &[&str], config: &AppConfig) -> Result<Vec<Vec<f32>>, String> {
    use async_openai::{types::CreateEmbeddingRequestArgs, Client};

    let openai_config = async_openai::config::OpenAIConfig::new()
        .with_api_base(&config.embedding_base_url)
        .with_api_key(&config.deepseek_api_key);

    let client = Client::with_config(openai_config);

    let request = CreateEmbeddingRequestArgs::default()
        .model(&config.embedding_model)
        .input(texts.to_vec())
        .build()
        .map_err(|e| format!("构建 embedding 请求失败：{}", e))?;

    let response = client.embeddings().create(request).await
        .map_err(|e| format!("Embedding API 调用失败：{}", e))?;

    Ok(response.data.into_iter().map(|d| d.embedding.into_iter().map(|f| f as f32).collect()).collect())
}

