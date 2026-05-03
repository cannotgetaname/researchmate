use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use tauri::{command, Emitter, State};

use crate::db::{Database, models::{Message, Session}};
use crate::config::AppConfig;
use crate::llm::LlmEngine;

const WRITING_POLISH_PROMPT: &str = include_str!("../../prompts/writing_polish.md");

#[derive(serde::Serialize, Clone)]
pub struct StreamChunk {
    pub delta: String,
}

/// Polish text: receive text from editor, return polished version with streaming
#[command]
pub async fn polish_text(
    text: String,
    style: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<String, String> {
    let style_instruction = match style.as_deref() {
        Some("academic") => "\n\n请使用严谨学术风格润色，提升正式度与精确度。",
        Some("concise") => "\n\n请使用精简风格改写，适合 PPT 或报告摘要。",
        _ => "\n\n请进行基础语法与清晰度润色。",
    };

    let system_prompt = format!("{}{}", WRITING_POLISH_PROMPT, style_instruction);

    let (engine, key_empty) = {
        let cfg = config.read().unwrap();
        let model = cfg.model_for("writing").to_string();
        let engine = LlmEngine::new(&cfg, &model);
        let key_empty = cfg.deepseek_api_key.is_empty();
        (engine, key_empty)
    };

    if key_empty {
        return Err("请先在设置中配置 DeepSeek API Key。".to_string());
    }

    let handle = app_handle.clone();

    let result = engine
        .chat_stream(
            &system_prompt,
            &[],
            &text,
            move |delta| {
                let _ = handle.emit("polish-stream", StreamChunk { delta });
            },
        )
        .await?;

    Ok(result)
}

/// Create a new session, return session id
#[command]
pub async fn create_session(
    project_id: String,
    module: String,
    db: State<'_, Arc<Database>>,
) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        module,
        title: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    conn.execute(
        "INSERT INTO session (id, project_id, module, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![session.id, session.project_id, session.module, session.title, session.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(session)
}

/// Get current config (masked API key)
#[command]
pub async fn get_config(
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<serde_json::Value, String> {
    use crate::config::MODULES;

    let cfg = config.read().unwrap();
    let masked_key = if cfg.deepseek_api_key.len() > 8 {
        format!("{}...{}",
            &cfg.deepseek_api_key[..4],
            &cfg.deepseek_api_key[cfg.deepseek_api_key.len()-4..]
        )
    } else if cfg.deepseek_api_key.is_empty() {
        String::new()
    } else {
        "****".to_string()
    };

    let overrides: serde_json::Value = MODULES
        .iter()
        .map(|m| {
            (*m, cfg.model_for(m))
        })
        .collect();

    Ok(serde_json::json!({
        "has_key": !cfg.deepseek_api_key.is_empty(),
        "deepseek_api_key_masked": masked_key,
        "deepseek_base_url": cfg.deepseek_base_url,
        "default_model": cfg.default_model,
        "model_overrides": overrides,
        "modules": MODULES,
        "embedding_provider": cfg.embedding_provider,
        "embedding_model": cfg.embedding_model,
        "embedding_base_url": cfg.embedding_base_url,
        "pdf_parser": cfg.pdf_parser,
        "python_path": cfg.python_path,
        "pdf_parsers": crate::config::PDF_PARSERS,
        "embedding_providers": crate::config::EMBEDDING_PROVIDERS,
    }))
}

/// Save full config
#[command]
pub async fn save_config(
    api_key: Option<String>,
    default_model: Option<String>,
    model_overrides: Option<std::collections::HashMap<String, Option<String>>>,
    embedding_provider: Option<String>,
    embedding_model: Option<String>,
    embedding_base_url: Option<String>,
    pdf_parser: Option<String>,
    python_path: Option<String>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
    app_dir: State<'_, PathBuf>,
) -> Result<String, String> {
    let mut cfg = config.write().unwrap();

    if let Some(key) = api_key {
        cfg.deepseek_api_key = key;
    }
    if let Some(model) = default_model {
        cfg.default_model = model;
    }
    if let Some(overrides) = model_overrides {
        for (module, model_opt) in overrides {
            match model_opt {
                Some(model) => { cfg.model_overrides.insert(module, model); }
                None => { cfg.model_overrides.remove(&module); }
            }
        }
    }
    if let Some(v) = embedding_provider {
        cfg.embedding_provider = v;
    }
    if let Some(v) = embedding_model {
        cfg.embedding_model = v;
    }
    if let Some(v) = embedding_base_url {
        cfg.embedding_base_url = v;
    }
    if let Some(v) = pdf_parser {
        cfg.pdf_parser = v;
    }
    if let Some(v) = python_path {
        cfg.python_path = v;
    }

    cfg.save(&app_dir);

    Ok("配置已保存，立即生效。".to_string())
}

/// List all projects
#[command]
pub async fn list_projects(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<crate::db::models::Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, updated_at FROM project ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let projects = stmt.query_map([], |row| {
        Ok(crate::db::models::Project {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(projects)
}

/// Create a new project
#[command]
pub async fn create_project(
    name: String,
    description: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<crate::db::models::Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let project = crate::db::models::Project {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        created_at: now.clone(),
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO project (id, name, description, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params![project.id, project.name, project.description, project.created_at, project.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(project)
}

/// Delete a project and all its data
#[command]
pub async fn delete_project(
    project_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    if project_id == "default" {
        return Err("不能删除默认项目".to_string());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_kb WHERE project_id = ?1", rusqlite::params![project_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM session WHERE project_id = ?1", rusqlite::params![project_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project WHERE id = ?1", rusqlite::params![project_id]).map_err(|e| e.to_string())?;
    Ok("已删除".to_string())
}

/// Get all messages for a session
#[command]
pub async fn get_messages(
    session_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Message>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, session_id, role, content, created_at FROM message WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let messages = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(messages)
}
