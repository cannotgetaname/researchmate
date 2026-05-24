use std::sync::{Arc};
use tauri::{command, State};

use crate::db::Database;

/// List all knowledge bases
#[command]
pub async fn list_knowledge_bases(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock_conn();
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, (SELECT COUNT(*) FROM kb_document WHERE kb_id = k.id) as doc_count FROM knowledge_base k ORDER BY created_at"
    ).map_err(|e| e.to_string())?;
    let kbs = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "created_at": row.get::<_, String>(3)?,
            "doc_count": row.get::<_, i64>(4)?,
        }))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(kbs)
}

/// Create a knowledge base
#[command]
pub async fn create_knowledge_base(
    name: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.lock_conn();
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO knowledge_base (id, name, description, created_at) VALUES (?1,?2,?3,?4)",
        rusqlite::params![id, name, None::<String>, chrono::Utc::now().to_rfc3339()],
    ).map_err(|e| e.to_string())?;

    // Auto-link to all existing projects so the KB is immediately usable
    conn.execute(
        "INSERT OR IGNORE INTO project_kb (project_id, kb_id) SELECT id, ?1 FROM project",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Delete a knowledge base and its document links (documents stay in pool)
#[command]
pub async fn delete_knowledge_base(
    kb_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    if kb_id == "default" {
        return Err("不能删除总知识库".to_string());
    }
    let conn = db.lock_conn();
    conn.execute("DELETE FROM kb_document WHERE kb_id = ?1", rusqlite::params![kb_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_kb WHERE kb_id = ?1", rusqlite::params![kb_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM knowledge_base WHERE id = ?1", rusqlite::params![kb_id]).map_err(|e| e.to_string())?;
    Ok("已删除".to_string())
}

/// Link a knowledge base to a project
#[command]
pub async fn link_kb_to_project(
    project_id: String,
    kb_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.lock_conn();
    conn.execute(
        "INSERT OR IGNORE INTO project_kb (project_id, kb_id) VALUES (?1, ?2)",
        rusqlite::params![project_id, kb_id],
    ).map_err(|e| e.to_string())?;
    Ok("已关联".to_string())
}

/// Unlink a knowledge base from a project
#[command]
pub async fn unlink_kb_from_project(
    project_id: String,
    kb_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.lock_conn();
    conn.execute(
        "DELETE FROM project_kb WHERE project_id = ?1 AND kb_id = ?2",
        rusqlite::params![project_id, kb_id],
    ).map_err(|e| e.to_string())?;
    Ok("已取消关联".to_string())
}
