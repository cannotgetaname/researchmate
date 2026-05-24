use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;
use crate::config::AppConfig;
use crate::knowledge::{pdf, embedding, chunker};

/// Upload a PDF document: copy to data dir, extract text, embed, store
#[command]
pub async fn upload_document(
    file_path: String,
    project_id: String,
    kb_id: Option<String>,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Document, String> {
    let src = std::path::Path::new(&file_path);
    let filename = src.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.pdf".to_string());
    let doc_id = uuid::Uuid::new_v4().to_string();

    // Copy to data dir
    let data_dir = if cfg!(target_os = "windows") {
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_else(|| PathBuf::from("."))
    } else {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
    }.join(".researchmate").join("projects")
        .join(&project_id)
        .join("files");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let dest = data_dir.join(&filename);
    std::fs::copy(src, &dest).map_err(|e| format!("文件复制失败：{}", e))?;

    // Clone config to avoid RwLock guard across await
    let cfg = { config.read().unwrap().clone() };

    // Extract text from PDF (via configured parser)
    eprintln!("[upload] extracting text from {} with parser={}", dest.display(), cfg.pdf_parser);
    let text = pdf::extract_pdf_text(&dest, &cfg)?;
    eprintln!("[upload] text extracted: {} chars", text.len());

    // Auto-extract metadata with LLM (fall back to regex if LLM unavailable)
    let llm_meta = extract_metadata_with_llm(&text, &cfg).await.unwrap_or_default();
    let regex_meta = extract_metadata_regex(&text);
    let mut title = llm_meta.0.or(regex_meta.0);
    if title.is_none() {
        title = extract_title_from_filename(&filename);
    }
    let authors = llm_meta.1.or(regex_meta.1);
    let year = llm_meta.2.or(regex_meta.2);
    let journal = llm_meta.3.or(regex_meta.3);
    let domain = llm_meta.4.or(regex_meta.4);
    let keywords = llm_meta.5.or(regex_meta.5);
    let abstract_text = llm_meta.6.or(regex_meta.6);

    // Chunk the full text (800 chars per chunk, 100 overlap, max 40 chunks)
    let mut chunks = chunker::chunk_text(&text, 800, 100);
    if chunks.len() > 40 {
        chunks.truncate(40);
    }
    let chunk_count = chunks.len() as i32;

    // Batch embed all chunks in one API call
    let chunk_vectors: Vec<String> = embedding::embed_batch(&chunks, &cfg).await?
        .into_iter()
        .map(|v| serde_json::to_string(&v).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    // Generate document-level vector from title + abstract
    let doc_embed_text = {
        let t = title.clone().unwrap_or_else(|| filename.clone());
        let a = abstract_text.clone().unwrap_or_else(|| text.chars().take(2000).collect::<String>());
        format!("{}\n{}", t, a)
    };
    let doc_vector = embedding::embed_text(&doc_embed_text, &cfg).await?;
    let doc_vector_json = serde_json::to_string(&doc_vector).map_err(|e| e.to_string())?;

    let conn = db.lock_conn();
    let doc = Document {
        id: doc_id.clone(),
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
        full_text: Some(text),
        chunk_count,
        status: "ready".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    conn.execute(
        "INSERT INTO document (id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            doc.id, doc.filename, doc.file_path,
            doc.title, doc.authors, doc.year, doc.journal, doc.doi,
            doc.abstract_, doc.domain, doc.subdomain, doc.keywords,
            doc.methodology, doc.dataset_, doc.claims, doc.full_text,
            doc.chunk_count, doc.status, doc.created_at,
        ],
    ).map_err(|e| e.to_string())?;

    // Link document to the default KB (always)
    conn.execute(
        "INSERT OR IGNORE INTO kb_document (kb_id, document_id) VALUES ('default', ?1)",
        rusqlite::params![doc_id],
    ).map_err(|e| e.to_string())?;

    // If uploaded to a specific KB, also link there AND ensure KB is linked to projects
    if let Some(ref kid) = kb_id {
        if kid != "default" {
            conn.execute(
                "INSERT OR IGNORE INTO kb_document (kb_id, document_id) VALUES (?1, ?2)",
                rusqlite::params![kid, doc_id],
            ).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR IGNORE INTO project_kb (project_id, kb_id) SELECT id, ?1 FROM project",
                rusqlite::params![kid],
            ).map_err(|e| e.to_string())?;
        }
    }

    // Also ensure default project links to default KB
    conn.execute(
        "INSERT OR IGNORE INTO project_kb (project_id, kb_id) VALUES ('default', 'default')",
        [],
    ).map_err(|e| e.to_string())?;

    // Store doc-level vector
    conn.execute(
        "CREATE TABLE IF NOT EXISTS doc_vector (doc_id TEXT PRIMARY KEY, vector TEXT NOT NULL, FOREIGN KEY(doc_id) REFERENCES document(id))",
        [],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO doc_vector (doc_id, vector) VALUES (?1, ?2)",
        rusqlite::params![doc_id, doc_vector_json],
    ).map_err(|e| e.to_string())?;

    // Store chunk-level vectors
    for (i, (chunk_text, chunk_vector_json)) in chunks.iter().zip(chunk_vectors.iter()).enumerate() {
        let chunk_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO doc_chunk (id, document_id, chunk_index, heading, role, text, vector) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![chunk_id, doc_id, i as i32, None::<String>, None::<String>, chunk_text, chunk_vector_json],
        ).map_err(|e| e.to_string())?;
    }

    Ok(doc)
}

/// Fallback metadata extraction without LLM: uses regex on the first 3000 chars
fn extract_metadata_regex(text: &str) -> (
    Option<String>, Option<serde_json::Value>, Option<i32>,
    Option<String>, Option<String>, Option<serde_json::Value>, Option<String>,
) {
    use regex::Regex;
    let head = &text[..text.len().min(3000)];
    eprintln!("[metadata_regex] first 500 chars: {}", head.chars().take(500).collect::<String>());

    let title = head.lines()
        .find(|l| {
            let t = l.trim();
            t.len() > 10
                && !t.contains('@') && !t.contains("http")
                && !t.starts_with("Abstract") && !t.starts_with("Keywords")
                && !t.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_uppercase())
        })
        .map(|l| l.trim().to_string())
        .filter(|t| {
            let words: Vec<&str> = t.split_whitespace().collect();
            if words.is_empty() { return false; }
            let first = words[0];
            if first.chars().next().map(|c| c.is_lowercase()).unwrap_or(false) { return false; }
            if ["of", "in", "to", "for", "with", "and", "the", "is", "are", "was"].contains(&first.to_lowercase().as_str()) { return false; }
            true
        });
    eprintln!("[metadata_regex] extracted title: {:?}", title);

    let author_re = Regex::new(r"(?m)^([A-Z][a-záéíóúñ]+(?:-[A-Z][a-záéíóúñ]+)?(?:,?\s+[A-Z]\.)+)").unwrap();
    let author_names: Vec<String> = author_re.captures_iter(head)
        .map(|c| c.get(1).unwrap().as_str().trim().to_string())
        .take(5)
        .collect();
    let authors: Option<serde_json::Value> = if author_names.is_empty() { None } else {
        Some(serde_json::json!(author_names.iter().map(|name| {
            let parts: Vec<&str> = name.split_whitespace().collect();
            let last = parts.last().map(|s| s.trim_end_matches(',')).unwrap_or("");
            let firsts: Vec<&str> = parts.iter().take(parts.len().saturating_sub(1)).map(|s| s.trim_end_matches(',')).collect();
            serde_json::json!({"name": name, "firstName": firsts.join(" "), "lastName": last})
        }).collect::<Vec<_>>()))
    };

    let year_re = Regex::new(r"\b(20[0-2]\d)\b").unwrap();
    let year = year_re.captures(head)
        .and_then(|c| c.get(1).unwrap().as_str().parse::<i32>().ok());

    let abstract_re = Regex::new(r"(?i)abstract[:\-\s]*\n?(.{50,500})").unwrap();
    let abstract_text = abstract_re.captures(head)
        .map(|c| c.get(1).unwrap().as_str().trim().to_string());

    (title, authors, year, None, None, None, abstract_text)
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

/// Extract paper title from filename pattern like "Author - Year - Title.pdf"
fn extract_title_from_filename(filename: &str) -> Option<String> {
    let stem = filename.strip_suffix(".pdf").unwrap_or(filename);
    let parts: Vec<&str> = stem.splitn(3, " - ").collect();
    if parts.len() >= 3 {
        let candidate = parts[2].trim();
        if candidate.len() > 5 && !candidate.chars().all(|c| c.is_ascii_digit()) {
            return Some(candidate.to_string());
        }
    }
    if stem.len() > 10 && !stem.contains(',') && !stem.contains("et al") && !stem.contains('_') {
        return Some(stem.to_string());
    }
    None
}
