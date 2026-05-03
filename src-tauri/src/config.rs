use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

pub const MODULES: &[&str] = &["writing", "analysis", "literature", "project_mgmt"];

/// Supported embedding providers
pub const EMBEDDING_PROVIDERS: &[&str] = &["ollama", "openai"];

/// Supported PDF parsers
pub const PDF_PARSERS: &[&str] = &["native", "opendataloader"];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    // ── LLM ──
    pub deepseek_api_key: String,
    pub deepseek_base_url: String,
    pub default_model: String,
    pub model_overrides: HashMap<String, String>,

    // ── Embedding ──
    pub embedding_provider: String,   // "ollama" | "openai"
    pub embedding_model: String,      // "embeddinggemma:latest" | "text-embedding-3-small"
    pub embedding_base_url: String,   // "http://localhost:11434" | "https://api.deepseek.com"

    // ── PDF Parser ──
    pub pdf_parser: String,           // "native" | "opendataloader"
    pub python_path: String,          // path to python3 binary
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            deepseek_api_key: String::new(),
            deepseek_base_url: "https://api.deepseek.com".to_string(),
            default_model: "deepseek-v4-pro".to_string(),
            model_overrides: HashMap::new(),

            embedding_provider: "ollama".to_string(),
            embedding_model: "embeddinggemma:latest".to_string(),
            embedding_base_url: "http://localhost:11434".to_string(),

            pdf_parser: "native".to_string(),
            python_path: "python3".to_string(),
        }
    }
}

impl AppConfig {
    pub fn load(app_dir: &PathBuf) -> Self {
        let config_path = app_dir.join("config.json");
        if config_path.exists() {
            let content = fs::read_to_string(&config_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            let config = Self::default();
            config.save(app_dir);
            config
        }
    }

    pub fn save(&self, app_dir: &PathBuf) {
        fs::create_dir_all(app_dir).ok();
        let config_path = app_dir.join("config.json");
        let content = serde_json::to_string_pretty(self).unwrap_or_default();
        fs::write(config_path, content).ok();
    }

    pub fn model_for(&self, module: &str) -> &str {
        self.model_overrides
            .get(module)
            .map(String::as_str)
            .unwrap_or(&self.default_model)
    }

    pub fn set_api_key(&mut self, key: String, app_dir: &PathBuf) {
        self.deepseek_api_key = key;
        self.save(app_dir);
    }
}
