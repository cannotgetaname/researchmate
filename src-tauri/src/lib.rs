mod knowledge;
mod db;
mod commands;
mod llm;
mod config;

use db::Database;
use std::sync::{Arc, RwLock};

pub fn run() {
    let app_dir = if cfg!(target_os = "windows") {
        // Windows: portable mode — data next to the exe
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".researchmate")
    } else {
        // Linux/macOS: standard home directory
        dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".researchmate")
    };

    let database = Database::new(&app_dir).expect("failed to initialize database");
    let db = Arc::new(database);
    let cfg = Arc::new(RwLock::new(config::AppConfig::load(&app_dir)));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(db)
        .manage(cfg)
        .manage(app_dir)
        .invoke_handler(tauri::generate_handler![
            commands::writing::polish_text,
            commands::writing::create_session,
            commands::writing::list_sessions,
            commands::writing::save_message,
            commands::writing::delete_message,
            commands::writing::get_messages,
            commands::writing::get_config,
            commands::writing::save_config,
            commands::writing::list_projects,
            commands::writing::create_project,
            commands::writing::delete_project,
            commands::literature::upload::upload_document,
            commands::literature::search::search_knowledge,
            commands::literature::documents::get_documents,
            commands::literature::documents::delete_document,
            commands::literature::rag::ask_knowledge,
            commands::literature::documents::add_doc_to_project,
            commands::literature::documents::remove_doc_from_project,
            commands::literature::documents::get_all_documents,
            commands::literature::kb::list_knowledge_bases,
            commands::literature::kb::create_knowledge_base,
            commands::literature::kb::link_kb_to_project,
            commands::literature::kb::unlink_kb_from_project,
            commands::literature::kb::delete_knowledge_base,
            commands::literature::citation::check_citations,
            commands::literature::structure::extract_paper_structure,
            commands::literature::structure::extract_paper_structure_ai,
            commands::literature::citation::extract_citations,
            commands::literature::citation::extract_citations_ai,
            commands::literature::citation::extract_citations_doi,
            commands::export::export_document,
            commands::export::preview_html,
            commands::export::generate_template,
            commands::export::generate_template_advanced,
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
            commands::util::read_image_as_data_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
