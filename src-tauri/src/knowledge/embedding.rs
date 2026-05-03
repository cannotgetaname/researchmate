use async_openai::{
    types::CreateEmbeddingRequestArgs,
    Client,
};

use crate::config::AppConfig;

/// Generate an embedding vector for a single text
pub async fn embed_text(
    text: &str,
    config: &AppConfig,
) -> Result<Vec<f32>, String> {
    let openai_config = async_openai::config::OpenAIConfig::new()
        .with_api_base(&config.deepseek_base_url)
        .with_api_key(&config.deepseek_api_key);

    let client = Client::with_config(openai_config);

    let request = CreateEmbeddingRequestArgs::default()
        .model("deepseek-chat")
        .input([text])
        .build()
        .map_err(|e| format!("Failed to build embedding request: {}", e))?;

    let response = client
        .embeddings()
        .create(request)
        .await
        .map_err(|e| format!("Embedding API error: {}", e))?;

    let vec = response
        .data
        .first()
        .ok_or("No embedding returned")?
        .embedding
        .iter()
        .map(|f| *f as f32)
        .collect();

    Ok(vec)
}
