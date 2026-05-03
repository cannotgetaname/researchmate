mod db;
mod commands;
mod llm;
mod config;

use db::Database;
use std::sync::Arc;

pub fn run() {
    let app_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("researchmate");

    let database = Database::new(&app_dir).expect("failed to initialize database");
    let db = Arc::new(database);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .manage(config::AppConfig::load(&app_dir))
        .invoke_handler(tauri::generate_handler![
            commands::writing::polish_text,
            commands::writing::create_session,
            commands::writing::get_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
