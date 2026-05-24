use std::sync::{Arc};
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;

use super::DOC_COLS;
use super::doc_from_row;

/// Get all documents for a project, optionally filtered by knowledge base IDs
#[command]
pub async fn get_documents(
    project_id: String,
    kb_ids: Option<Vec<String>>,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Document>, String> {
    let conn = db.lock_conn();
    let mut sql = format!("SELECT DISTINCT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1", DOC_COLS);
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id)];
    if let Some(ref ids) = kb_ids {
        if !ids.is_empty() {
            let placeholders: Vec<String> = ids.iter().enumerate()
                .map(|(i, _)| format!("?{}", i + 2)).collect();
            sql.push_str(&format!(" AND kd.kb_id IN ({})", placeholders.join(",")));
            for id in ids {
                params.push(Box::new(id.clone()));
            }
        }
    }
    sql.push_str(" ORDER BY d.created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let docs = stmt.query_map(param_refs.as_slice(), doc_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(docs)
}

/// Get all documents in the global pool (not tied to a project)
#[command]
pub async fn get_all_documents(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Document>, String> {
    let conn = db.lock_conn();
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM document ORDER BY created_at DESC", DOC_COLS)
    ).map_err(|e| e.to_string())?;
    let docs = stmt.query_map([], doc_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(docs)
}

/// Delete a document and its vector
#[command]
pub async fn delete_document(
    doc_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    eprintln!("[delete] deleting doc_id={doc_id}");
    let conn = db.lock_conn();
    conn.execute("DELETE FROM citation WHERE document_id = ?1", rusqlite::params![doc_id]).ok();
    conn.execute("DELETE FROM paper_structure WHERE document_id = ?1", rusqlite::params![doc_id]).ok();
    conn.execute("DELETE FROM kb_document WHERE document_id = ?1", rusqlite::params![doc_id]).ok();
    conn.execute("DELETE FROM doc_chunk WHERE document_id = ?1", rusqlite::params![doc_id]).ok();
    conn.execute("DELETE FROM doc_vector WHERE doc_id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM document WHERE id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    eprintln!("[delete] done");
    Ok("已删除".to_string())
}

/// Add existing document to a project
#[command]
pub async fn add_doc_to_project(
    doc_id: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.lock_conn();
    conn.execute(
        "INSERT OR IGNORE INTO project_document (project_id, document_id) VALUES (?1, ?2)",
        rusqlite::params![project_id, doc_id],
    ).map_err(|e| e.to_string())?;
    Ok("已添加".to_string())
}

/// Remove document from a project (doesn't delete the document itself)
#[command]
pub async fn remove_doc_from_project(
    doc_id: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.lock_conn();
    conn.execute(
        "DELETE FROM project_document WHERE project_id = ?1 AND document_id = ?2",
        rusqlite::params![project_id, doc_id],
    ).map_err(|e| e.to_string())?;
    Ok("已移除".to_string())
}
