use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;
use crate::config::AppConfig;
use crate::knowledge::{pdf, embedding, chunker};
use crate::db::models::{DocChunk, SearchQuery, SearchHit};

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
        full_text: Some(text),
        chunk_count,
        status: "ready".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    conn.execute(
        "INSERT INTO document (id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
        rusqlite::params![
            doc.id, doc.project_id, doc.filename, doc.file_path,
            doc.title, doc.authors, doc.year, doc.journal, doc.doi,
            doc.abstract_, doc.domain, doc.subdomain, doc.keywords,
            doc.methodology, doc.dataset_, doc.claims, doc.full_text,
            doc.chunk_count, doc.status, doc.created_at,
        ],
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
        "SELECT id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at FROM document WHERE project_id = ?1 AND status = 'ready'"
    ).map_err(|e| e.to_string())?;

    let docs: Vec<Document> = docs_stmt.query_map(rusqlite::params![project_id], doc_from_row)
        .map_err(|e| e.to_string())?
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
        "SELECT id, project_id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at FROM document WHERE project_id = ?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let docs = stmt.query_map(rusqlite::params![project_id], doc_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(docs)
}

/// RAG with multi-dimension search: auto-detects intent and routes to the right strategy
#[command]
pub async fn ask_knowledge(
    question: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use crate::llm::LlmEngine;
    use crate::commands::writing::StreamChunk;
    use tauri::Emitter;

    let cfg = { config.read().unwrap().clone() };

    // Step 1: LLM parses question into search dimensions
    let sq = parse_search_intent(&question, &cfg).await?;
    let query_vec = if sq.semantic {
        Some(embedding::embed_text(&question, &cfg).await?)
    } else {
        None
    };

    // Step 2: Execute search strategy based on dimensions
    let hits = {
        let qv = query_vec.as_ref();
        execute_search(&db, &project_id, &sq, qv)?
    };

    if hits.is_empty() {
        return Ok("知识库中没有找到相关文献，请先上传 PDF 或调整检索条件。".to_string());
    }

    // Step 3: Build context from search hits
    let context = build_context(&hits, &sq);

    let system_prompt = format!(
        r#"你是学术研究助手，根据用户知识库中的文献回答问题。

检索维度：{:?}

规则：
1. 只基于提供的文献内容回答，不要编造
2. 引用具体文献时标注：**【文献标题】**，如果搜索到了多篇文献请尽量对比
3. 如果文献不足以回答，如实说明
4. 回答尽量结构化

{}
问题：{}"#,
        describe_query(&sq), context, question
    );

    let model = cfg.model_for("literature");
    let engine = LlmEngine::new(&cfg, model);

    let handle = app_handle.clone();
    let result = engine.chat_stream(&system_prompt, &[], "", move |delta| {
        let _ = handle.emit("polish-stream", StreamChunk { delta });
    }).await?;

    Ok(result)
}

/// Use LLM to parse the user question into structured search dimensions
async fn parse_search_intent(question: &str, config: &AppConfig) -> Result<SearchQuery, String> {
    use crate::llm::LlmEngine;

    let model = config.model_for("literature");
    let engine = LlmEngine::new(config, model);

    let prompt = format!(
        r#"分析以下用户问题，提取检索维度。只返回JSON，不要其他文字：

{{
  "doc_id": "单一篇论文ID（用户明确说'这篇/这篇文章'时，填null以外的值）——但这里你不知道具体ID，请始终填null",
  "journal": "期刊名称（如Nature/CVPR/IEEE TPAMI）或null",
  "domain": "研究领域（如计算机视觉/NLP/材料科学）或null",
  "methodology": "具体方法（如Transformer/强化学习/实验）或null",
  "author": "作者名或null",
  "semantic": true（需要语义搜索时）或 false（仅需元数据过滤时）
}}

用户问题：{}"#,
        question
    );

    // For intent parsing, we don't need streaming - just collect the response
    let mut response = String::new();
    let _ = engine.chat_stream(&prompt, &[], "", |delta| {
        // non-streaming context, but we still need the callback
    }).await.map(|r| { response = r; })?;

    let json_str = response.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    let q: SearchQuery = serde_json::from_str(json_str)
        .unwrap_or(SearchQuery {
            question: question.to_string(),
            doc_id: None, journal: None, domain: None,
            methodology: None, author: None, semantic: true,
        });

    // Force semantic=true if no metadata filters provided
    let has_filter = q.journal.is_some() || q.domain.is_some()
        || q.methodology.is_some() || q.author.is_some() || q.doc_id.is_some();
    Ok(SearchQuery { semantic: !has_filter || q.semantic, ..q })
}

/// Execute the right search strategy based on parsed dimensions
fn execute_search(
    db: &Database, project_id: &str, sq: &SearchQuery,
    query_vec: Option<&Vec<f32>>,
) -> Result<Vec<SearchHit>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Build SQL with dynamic WHERE clauses
    let mut sql = String::from(
        "SELECT c.id, c.document_id, d.title, d.authors, d.journal, d.domain, d.methodology, c.heading, c.role, c.text, c.vector
         FROM doc_chunk c JOIN document d ON c.document_id = d.id
         WHERE d.project_id = ?1 AND d.status = 'ready'"
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];

    if let Some(ref did) = sq.doc_id {
        sql.push_str(" AND c.document_id = ?2");
        params.push(Box::new(did.clone()));
    }
    if let Some(ref j) = sq.journal {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND d.journal LIKE ?{}", idx));
        params.push(Box::new(format!("%{}%", j)));
    }
    if let Some(ref dom) = sq.domain {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND (d.domain LIKE ?{} OR d.keywords LIKE ?{})", idx, idx));
        params.push(Box::new(format!("%{}%", dom)));
    }
    if let Some(ref meth) = sq.methodology {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND (d.methodology LIKE ?{} OR c.text LIKE ?{})", idx, idx));
        params.push(Box::new(format!("%{}%", meth)));
    }
    if let Some(ref auth) = sq.author {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND d.authors LIKE ?{}", idx));
        params.push(Box::new(format!("%{}%", auth)));
    }

    // Fetch enough candidates for diverse document coverage, then truncate after scoring
    let limit = if sq.doc_id.is_some() { 50 } else { 30 };
    sql.push_str(&format!(" LIMIT {}", limit * 5));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    struct RawHit {
        chunk_id: String, document_id: String, title: Option<String>,
        authors: Option<String>, journal: Option<String>, domain: Option<String>,
        methodology: Option<String>, heading: Option<String>, role: Option<String>,
        text: String, vector_json: String,
    }

    let raw_hits: Vec<RawHit> = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(RawHit {
            chunk_id: row.get(0)?, document_id: row.get(1)?, title: row.get(2)?,
            authors: row.get(3)?, journal: row.get(4)?, domain: row.get(5)?,
            methodology: row.get(6)?, heading: row.get(7)?, role: row.get(8)?,
            text: row.get(9)?, vector_json: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    drop(stmt);
    drop(conn);

    // Score and sort
    let mut hits: Vec<SearchHit> = raw_hits.into_iter().map(|r| {
        let score = if let Some(qv) = query_vec {
            let v: Vec<f32> = serde_json::from_str(&r.vector_json).unwrap_or_default();
            cosine_similarity(qv, &v)
        } else {
            1.0 // no semantic scoring needed, all metadata matches
        };
        SearchHit {
            chunk_id: r.chunk_id, document_id: r.document_id,
            title: r.title, authors: r.authors, journal: r.journal,
            domain: r.domain, methodology: r.methodology,
            heading: r.heading, role: r.role, text: r.text, score,
        }
    }).collect();

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Ensure document diversity: take top per-doc first, then fill with remaining
    let mut diverse: Vec<SearchHit> = Vec::new();
    let mut seen_docs = std::collections::HashSet::new();
    for h in &hits {
        if !seen_docs.contains(&h.document_id) {
            diverse.push(h.clone());
            seen_docs.insert(h.document_id.clone());
        }
    }
    // Fill remaining with best scoring hits from any doc
    for h in &hits {
        if diverse.len() >= limit { break; }
        if !diverse.iter().any(|d| d.chunk_id == h.chunk_id) {
            diverse.push(h.clone());
        }
    }
    diverse.truncate(limit);

    Ok(diverse)
}

fn build_context(hits: &[SearchHit], sq: &SearchQuery) -> String {
    if sq.doc_id.is_some() && !hits.is_empty() {
        let title = hits[0].title.as_deref().unwrap_or("未知");
        let mut ctx = format!("**论文：{}**（完整内容）\n\n", title);
        for (i, h) in hits.iter().enumerate() {
            ctx.push_str(&format!(
                "{}\n\n", h.text
            ));
        }
        return ctx;
    }

    let mut ctx = String::from("以下是你知识库中与问题最相关的文献片段：\n\n");
    let mut seen_docs = std::collections::HashSet::new();
    for h in hits {
        let title = h.title.as_deref().unwrap_or("未知");
        let doc_key = &h.document_id;
        if !seen_docs.contains(doc_key) {
            seen_docs.insert(doc_key);
            ctx.push_str(&format!("## {}\n", title));
            if let Some(ref j) = h.journal { ctx.push_str(&format!("期刊: {}\n", j)); }
            if let Some(ref d) = h.domain { ctx.push_str(&format!("领域: {}\n", d)); }
        }
        if let Some(ref heading) = h.heading { ctx.push_str(&format!("**{}**\n", heading)); }
        ctx.push_str(&format!("{}\n\n", h.text));
    }
    ctx
}

fn describe_query(sq: &SearchQuery) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if sq.doc_id.is_some() { parts.push("单篇全文检索"); }
    if sq.journal.is_some() { parts.push("期刊过滤"); }
    if sq.domain.is_some() { parts.push("领域过滤"); }
    if sq.methodology.is_some() { parts.push("方法过滤"); }
    if sq.author.is_some() { parts.push("作者过滤"); }
    if sq.semantic { parts.push("语义排序"); }
    if parts.is_empty() { parts.push("通用检索"); }
    parts.join(" + ")
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

fn doc_from_row(row: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?, project_id: row.get(1)?, filename: row.get(2)?,
        file_path: row.get(3)?, title: row.get(4)?, authors: row.get(5)?,
        year: row.get(6)?, journal: row.get(7)?, doi: row.get(8)?,
        abstract_: row.get(9)?, domain: row.get(10)?, subdomain: row.get(11)?,
        keywords: row.get(12)?, methodology: row.get(13)?, dataset_: row.get(14)?,
        claims: row.get(15)?, full_text: row.get(16)?, chunk_count: row.get(17)?,
        status: row.get(18)?, created_at: row.get(19)?,
    })
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
