mod knowledge;
mod db;
mod commands;
mod llm;
mod config;

use db::Database;
use std::sync::{Arc, RwLock};

pub fn run() {
    let app_dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".researchmate");

    let database = Database::new(&app_dir).expect("failed to initialize database");
    let db = Arc::new(database);
    let cfg = Arc::new(RwLock::new(config::AppConfig::load(&app_dir)));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .manage(cfg)
        .manage(app_dir)
        .invoke_handler(tauri::generate_handler![
            commands::writing::polish_text,
            commands::writing::create_session,
            commands::writing::get_messages,
            commands::writing::get_config,
            commands::writing::save_config,
            commands::writing::list_projects,
            commands::writing::create_project,
            commands::writing::delete_project,
            commands::literature::upload_document,
            commands::literature::search_knowledge,
            commands::literature::get_documents,
            commands::literature::delete_document,
            commands::literature::ask_knowledge,
            commands::literature::add_doc_to_project,
            commands::literature::remove_doc_from_project,
            commands::literature::get_all_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
