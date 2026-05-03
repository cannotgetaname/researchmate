use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub deepseek_api_key: String,
    pub deepseek_base_url: String,
    pub model_name: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            deepseek_api_key: String::new(),
            deepseek_base_url: "https://api.deepseek.com".to_string(),
            model_name: "deepseek-chat".to_string(),
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

    pub fn set_api_key(&mut self, key: String, app_dir: &PathBuf) {
        self.deepseek_api_key = key;
        self.save(app_dir);
    }
}
