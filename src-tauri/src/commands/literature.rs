use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;
use crate::config::AppConfig;
use crate::knowledge::{pdf, embedding};

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub document: Document,
    pub score: f32,
    pub snippet: String,
}

/// Upload a PDF document: copy to data dir, extract text, embed, store
#[command]
pub async fn upload_document(
    file_path: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Document, String> {
    let src = std::path::Path::new(&file_path);
    let filename = src.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.pdf".to_string());
    let doc_id = uuid::Uuid::new_v4().to_string();

    // Copy to data dir
    let data_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".researchmate")
        .join("projects")
        .join(&project_id)
        .join("files");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let dest = data_dir.join(&filename);
    std::fs::copy(src, &dest).map_err(|e| format!("文件复制失败：{}", e))?;

    // Clone config to avoid RwLock guard across await
    let cfg = { config.read().unwrap().clone() };

    // Extract text from PDF (via configured parser)
    let text = pdf::extract_pdf_text(&dest, &cfg)?;

    // Auto-extract metadata with LLM
    let (title, authors, year, journal, domain, keywords, abstract_text) =
        extract_metadata_with_llm(&text, &cfg).await.unwrap_or_default();

    // Generate embedding from abstract + title
    let embed_text = {
        let t = title.clone().unwrap_or_else(|| filename.clone());
        let a = abstract_text.clone().unwrap_or_else(|| text.chars().take(2000).collect::<String>());
        format!("{}\n{}", t, a)
    };

    let vector = embedding::embed_text(&embed_text, &cfg).await?;

    let vector_json = serde_json::to_string(&vector).map_err(|e| e.to_string())?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let doc = Document {
        id: doc_id.clone(),
        project_id,
        filename,
        file_path: dest.to_string_lossy().to_string(),
        title,
        authors: authors.map(|a| a.to_string()),
        year,
        journal,
        doi: None,
        abstract_: abstract_text,
        domain,
        subdomain: None,
        keywords: keywords.map(|k| k.to_string()),
        methodology: None,
        dataset_: None,
        claims: None,
        chunk_count: 0,
        status: "ready".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    conn.execute(
        "INSERT INTO document (id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, chunk_count, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            doc.id, doc.project_id, doc.filename, doc.file_path,
            doc.title, doc.authors, doc.year, doc.journal, doc.doi,
            doc.abstract_, doc.domain, doc.subdomain, doc.keywords,
            doc.methodology, doc.dataset_, doc.claims, doc.chunk_count,
            doc.status, doc.created_at,
        ],
    ).map_err(|e| e.to_string())?;

    // Store vector in separate table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS doc_vector (doc_id TEXT PRIMARY KEY, vector TEXT NOT NULL, FOREIGN KEY(doc_id) REFERENCES document(id))",
        [],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO doc_vector (doc_id, vector) VALUES (?1, ?2)",
        rusqlite::params![doc_id, vector_json],
    ).map_err(|e| e.to_string())?;

    Ok(doc)
}

/// Semantic search across uploaded documents
#[command]
pub async fn search_knowledge(
    query: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Vec<SearchResult>, String> {
    let cfg = { config.read().unwrap().clone() };
    let query_vec = embedding::embed_text(&query, &cfg).await?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut docs_stmt = conn.prepare(
        "SELECT id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, chunk_count, status, created_at FROM document WHERE project_id = ?1 AND status = 'ready'"
    ).map_err(|e| e.to_string())?;

    let docs: Vec<Document> = docs_stmt.query_map(rusqlite::params![project_id], |row| {
        Ok(Document {
            id: row.get(0)?,
            project_id: row.get(1)?,
            filename: row.get(2)?,
            file_path: row.get(3)?,
            title: row.get(4)?,
            authors: row.get(5)?,
            year: row.get(6)?,
            journal: row.get(7)?,
            doi: row.get(8)?,
            abstract_: row.get(9)?,
            domain: row.get(10)?,
            subdomain: row.get(11)?,
            keywords: row.get(12)?,
            methodology: row.get(13)?,
            dataset_: row.get(14)?,
            claims: row.get(15)?,
            chunk_count: row.get(16)?,
            status: row.get(17)?,
            created_at: row.get(18)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    drop(docs_stmt);

    let mut results: Vec<SearchResult> = Vec::new();
    for doc in docs {
        let vector_json: String = conn.query_row(
            "SELECT vector FROM doc_vector WHERE doc_id = ?1",
            rusqlite::params![doc.id],
            |row| row.get(0),
        ).unwrap_or_default();

        let vector: Vec<f32> = serde_json::from_str(&vector_json).unwrap_or_default();
        if vector.is_empty() { continue; }

        let score = cosine_similarity(&query_vec, &vector);
        let snippet = doc.abstract_.clone().unwrap_or_default()
            .chars().take(200).collect();

        results.push(SearchResult { document: doc, score, snippet });
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(10);

    Ok(results)
}

/// Get all documents for a project
#[command]
pub async fn get_documents(
    project_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Document>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, chunk_count, status, created_at FROM document WHERE project_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let docs = stmt.query_map(rusqlite::params![project_id], |row| {
        Ok(Document {
            id: row.get(0)?,
            project_id: row.get(1)?,
            filename: row.get(2)?,
            file_path: row.get(3)?,
            title: row.get(4)?,
            authors: row.get(5)?,
            year: row.get(6)?,
            journal: row.get(7)?,
            doi: row.get(8)?,
            abstract_: row.get(9)?,
            domain: row.get(10)?,
            subdomain: row.get(11)?,
            keywords: row.get(12)?,
            methodology: row.get(13)?,
            dataset_: row.get(14)?,
            claims: row.get(15)?,
            chunk_count: row.get(16)?,
            status: row.get(17)?,
            created_at: row.get(18)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(docs)
}

/// Delete a document and its vector
#[command]
pub async fn delete_document(
    doc_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM doc_vector WHERE doc_id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM document WHERE id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    Ok("已删除".to_string())
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

async fn extract_metadata_with_llm(
    text: &str,
    config: &AppConfig,
) -> Result<(
    Option<String>, Option<serde_json::Value>, Option<i32>,
    Option<String>, Option<String>, Option<serde_json::Value>, Option<String>,
), String> {
    use crate::llm::LlmEngine;

    let model = config.model_for("literature");
    let engine = LlmEngine::new(config, model);

    let prompt = format!(
        r#"你是一个学术论文元数据提取助手。请从以下论文文本中提取结构化信息。

请严格按JSON格式返回，只返回JSON，不要其他文字：
{{
  "title": "论文标题",
  "authors": [{{"name": "作者名", "affiliation": "机构"}}],
  "year": 2024,
  "journal": "期刊/会议名称",
  "domain": "研究领域",
  "keywords": ["关键词1", "关键词2"],
  "abstract": "论文摘要"
}}

如果没有提取到某个字段，填null。

论文开头：{}

论文正文前3000字：{}"#,
        &text[..text.len().min(500)],
        &text[..text.len().min(3000)]
    );

    let response = engine
        .chat_stream(&prompt, &[], "", |_| {})
        .await?;

    let json_str = response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON 解析失败：{}\n原始响应：{}", e, json_str))?;

    Ok((
        parsed["title"].as_str().map(String::from),
        if parsed["authors"].is_array() { Some(parsed["authors"].clone()) } else { None },
        parsed["year"].as_i64().map(|y| y as i32),
        parsed["journal"].as_str().map(String::from),
        parsed["domain"].as_str().map(String::from),
        if parsed["keywords"].is_array() { Some(parsed["keywords"].clone()) } else { None },
        parsed["abstract"].as_str().map(String::from),
    ))
}
