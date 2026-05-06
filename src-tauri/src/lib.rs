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
            commands::literature::list_knowledge_bases,
            commands::literature::create_knowledge_base,
            commands::literature::link_kb_to_project,
            commands::literature::unlink_kb_from_project,
            commands::literature::delete_knowledge_base,
            commands::literature::check_citations,
            commands::export::export_document,
            commands::export::preview_html,
            commands::export::generate_template,
            commands::version::git_init,
            commands::version::save_version,
            commands::version::list_versions,
            commands::version::get_version,
            commands::version::delete_version,
            commands::version::list_branches,
            commands::version::create_branch,
            commands::version::switch_branch,
            commands::version::delete_branch,
            commands::version::diff_versions,
            commands::version::set_version_tag,
            commands::version::get_version_tags,
            commands::version::remove_version_tag,
            commands::version::auto_snapshot,
            commands::draft::save_draft,
            commands::draft::load_draft,
            commands::agent::chat_with_tools,
            commands::agent::set_session_kbs,
            commands::agent::get_session_kbs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
