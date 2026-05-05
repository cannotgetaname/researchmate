use std::sync::{Arc, RwLock};
use std::path::PathBuf;
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;
use crate::config::AppConfig;
use crate::knowledge::{pdf, embedding, chunker};
use crate::db::models::{SearchQuery, SearchHit};

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

    // Link document to the default KB (always) and also to any project-linked KBs
    conn.execute(
        "INSERT OR IGNORE INTO kb_document (kb_id, document_id) VALUES ('default', ?1)",
        rusqlite::params![doc_id],
    ).map_err(|e| e.to_string())?;

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
        format!("SELECT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'", DOC_COLS).as_str()
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
    kb_id: Option<String>,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Document>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut sql = format!("SELECT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1", DOC_COLS);
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id)];
    if let Some(ref kid) = kb_id {
        sql.push_str(" AND kd.kb_id = ?2");
        params.push(Box::new(kid.clone()));
    }
    sql.push_str(" ORDER BY d.created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let docs = stmt.query_map(param_refs.as_slice(), doc_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    Ok(docs)
}

/// RAG with multi-dimension search: auto-detects intent and routes to the right strategy
#[command]
pub async fn ask_knowledge(
    question: String,
    project_id: String,
    kb_ids: Option<Vec<String>>,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use crate::llm::LlmEngine;
    use crate::commands::writing::StreamChunk;
    use tauri::Emitter;

    let cfg = { config.read().unwrap().clone() };

    // Step 1: LLM parses question into search dimensions
    let mut sq = parse_search_intent(&question, &cfg).await?;
    if let Some(ids) = kb_ids {
        if !ids.is_empty() {
            sq.kb_ids = ids;
        }
    }

    // Strategy routing
    match sq.strategy.as_str() {
        "count" => {
            return answer_count(&db, &project_id, &sq, &cfg, &question, &app_handle).await;
        }
        "list" => {
            return answer_list(&db, &project_id, &sq, &cfg, &question, &app_handle).await;
        }
        _ => {} // semantic / single / compare — use two-phase search
    }

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

/// Use LLM to parse the user question into a search strategy
async fn parse_search_intent(question: &str, config: &AppConfig) -> Result<SearchQuery, String> {
    use crate::llm::LlmEngine;

    let model = config.model_for("literature");
    let engine = LlmEngine::new(config, model);

    let prompt = format!(
        r#"你是检索策略分析器。分析用户问题，决定检索维度。只返回JSON：

规则：
- doc_id: 永远填 null（你不知道具体的ID）
- journal: 用户提到了具体期刊/会议名？提取出来，否则null。如"Nature"、"CVPR"、"IEEE TPAMI"
- domain: 用户提到的研究领域？如"计算机视觉"、"材料科学"、"神经形态计算"。要泛化，不要提取太窄的关键词
- methodology: 用户提到了具体方法/技术？如"Transformer"、"强化学习"、"深度学习"
- author: 用户提到了作者名？否则null
- strategy: 检索策略：
  - "count": 用户在问"有几篇/有多少文献"
  - "list": 用户在问"有哪些/列出"（要先定文档范围）
  - "single": 用户在问一篇特定论文的内容（如"这篇论文用了什么方法"）
  - "compare": 用户在对比多篇论文（如"A和B有什么不同"）
  - "semantic": 通用的语义搜索（默认）
- max_docs: 最多涉及多少篇文献（count/list 可以到100，单篇讨论=1，对比讨论=3-5）

用户问题：{}"#,
        question
    );

    let response = engine.chat_stream(&prompt, &[], "", |_| {}).await?;
    let json_str = response.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();

    let parsed: serde_json::Value = serde_json::from_str(json_str).unwrap_or_default();

    let strategy = parsed["strategy"].as_str().unwrap_or("semantic").to_string();
    let max_docs = parsed["max_docs"].as_u64().unwrap_or(20) as usize;

    Ok(SearchQuery {
        question: question.to_string(),
        doc_id: None,
        journal: parsed["journal"].as_str().map(String::from),
        domain: parsed["domain"].as_str().map(String::from),
        methodology: parsed["methodology"].as_str().map(String::from),
        author: parsed["author"].as_str().map(String::from),
        kb_ids: vec![],
        semantic: strategy != "count" && strategy != "list",
        strategy,
        max_docs,
    })
}

/// Two-phase search: (1) find candidate documents via metadata + doc_vector,
/// then (2) semantic chunk search within those documents only.
fn execute_search(
    db: &Database, project_id: &str, sq: &SearchQuery,
    query_vec: Option<&Vec<f32>>,
) -> Result<Vec<SearchHit>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // ── Phase 1: Find candidate document IDs ──
    let candidate_doc_ids = {
        let mut doc_sql = String::from(
            "SELECT d.id FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'"
        );
        let mut doc_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];

        if let Some(ref did) = sq.doc_id {
            doc_sql.push_str(" AND id = ?2");
            doc_params.push(Box::new(did.clone()));
        }
        if let Some(ref j) = sq.journal {
            let idx = doc_params.len() + 1;
            doc_sql.push_str(&format!(" AND journal LIKE ?{}", idx));
            doc_params.push(Box::new(format!("%{}%", j)));
        }
        if let Some(ref dom) = sq.domain {
            let idx = doc_params.len() + 1;
            doc_sql.push_str(&format!(" AND (domain LIKE ?{} OR keywords LIKE ?{})", idx, idx));
            doc_params.push(Box::new(format!("%{}%", dom)));
        }
        if let Some(ref auth) = sq.author {
            let idx = doc_params.len() + 1;
            doc_sql.push_str(&format!(" AND authors LIKE ?{}", idx));
            doc_params.push(Box::new(format!("%{}%", auth)));
        }

        // Filter by selected KBs
        if !sq.kb_ids.is_empty() {
            let placeholders: Vec<String> = sq.kb_ids.iter().enumerate()
                .map(|(i, _)| format!("?{}", doc_params.len() + i + 1)).collect();
            doc_sql.push_str(&format!(" AND kd.kb_id IN ({})", placeholders.join(",")));
            for kb_id in &sq.kb_ids {
                doc_params.push(Box::new(kb_id.clone()));
            }
        }

        // If semantic, rank by doc_vector similarity first
        if let Some(qv) = query_vec {
            if sq.doc_id.is_none() && sq.journal.is_none() && sq.domain.is_none() && sq.author.is_none() && sq.kb_ids.is_empty() {
                // Pure semantic: get ALL docs, rank by vector similarity, take top 20
                doc_sql.push_str(" LIMIT 100");
            }
        }
        if sq.doc_id.is_some() || !doc_sql.contains("LIMIT") {
            doc_sql.push_str(" LIMIT 100");
        }

        let mut doc_stmt = conn.prepare(&doc_sql).map_err(|e| e.to_string())?;
        let doc_param_refs: Vec<&dyn rusqlite::types::ToSql> = doc_params.iter().map(|p| p.as_ref()).collect();

        let doc_ids: Vec<String> = doc_stmt.query_map(doc_param_refs.as_slice(), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        // If semantic, rank docs by vector similarity and take top 20
        if let Some(qv) = query_vec {
            if sq.doc_id.is_none() && sq.journal.is_none() && sq.domain.is_none() && sq.author.is_none() {
                let mut scored_docs: Vec<(String, f32)> = Vec::new();
                for did in doc_ids {
                    let vector_json: String = conn.query_row(
                        "SELECT vector FROM doc_vector WHERE doc_id = ?1",
                        rusqlite::params![did], |row| row.get(0),
                    ).unwrap_or_default();
                    let vector: Vec<f32> = serde_json::from_str(&vector_json).unwrap_or_default();
                    if !vector.is_empty() {
                        let score = cosine_similarity(qv, &vector);
                        scored_docs.push((did, score));
                    }
                }
                scored_docs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                scored_docs.truncate(sq.max_docs);
                scored_docs.into_iter().map(|(id, _)| id).collect()
            } else {
                doc_ids
            }
        } else {
            doc_ids
        }
    };

    if candidate_doc_ids.is_empty() {
        return Ok(vec![]);
    }

    // ── Phase 2: Chunk search within candidate documents ──
    let limit = if sq.doc_id.is_some() { 50 } else { 30 };
    let placeholders: Vec<String> = candidate_doc_ids.iter().enumerate()
        .map(|(i, _)| format!("?{}", i + 2)).collect();
    let ph_str = placeholders.join(",");

    let mut chunk_sql = format!(
        "SELECT c.id, c.document_id, d.title, d.authors, d.journal, d.domain, d.methodology, c.heading, c.role, c.text, c.vector
         FROM doc_chunk c JOIN document d ON c.document_id = d.id
         JOIN kb_document kd ON d.id = kd.document_id JOIN project_kb pk ON kd.kb_id = pk.kb_id
         WHERE pk.project_id = ?1 AND c.document_id IN ({})",
        ph_str
    );
    chunk_sql.push_str(&format!(" LIMIT {}", limit * 5));

    let mut chunk_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];
    for did in &candidate_doc_ids {
        chunk_params.push(Box::new(did.clone()));
    }

    let mut chunk_stmt = conn.prepare(&chunk_sql).map_err(|e| e.to_string())?;
    let chunk_param_refs: Vec<&dyn rusqlite::types::ToSql> = chunk_params.iter().map(|p| p.as_ref()).collect();

    struct RawHit {
        chunk_id: String, document_id: String, title: Option<String>,
        authors: Option<String>, journal: Option<String>, domain: Option<String>,
        methodology: Option<String>, heading: Option<String>, role: Option<String>,
        text: String, vector_json: String,
    }

    let raw_hits: Vec<RawHit> = chunk_stmt.query_map(chunk_param_refs.as_slice(), |row| {
        Ok(RawHit {
            chunk_id: row.get(0)?, document_id: row.get(1)?, title: row.get(2)?,
            authors: row.get(3)?, journal: row.get(4)?, domain: row.get(5)?,
            methodology: row.get(6)?, heading: row.get(7)?, role: row.get(8)?,
            text: row.get(9)?, vector_json: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    drop(chunk_stmt);
    drop(conn);

    // Score and sort
    let mut hits: Vec<SearchHit> = raw_hits.into_iter().map(|r| {
        let score = if let Some(qv) = query_vec {
            let v: Vec<f32> = serde_json::from_str(&r.vector_json).unwrap_or_default();
            cosine_similarity(qv, &v)
        } else {
            1.0
        };
        SearchHit {
            chunk_id: r.chunk_id, document_id: r.document_id,
            title: r.title, authors: r.authors, journal: r.journal,
            domain: r.domain, methodology: r.methodology,
            heading: r.heading, role: r.role, text: r.text, score,
        }
    }).collect();

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Document diversity: at least 1 chunk per doc, then fill by score
    let mut diverse: Vec<SearchHit> = Vec::new();
    let mut seen_docs = std::collections::HashSet::new();
    for h in &hits {
        if !seen_docs.contains(&h.document_id) {
            diverse.push(h.clone());
            seen_docs.insert(h.document_id.clone());
        }
    }
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
    // Deduplicate document entries by title
    let mut seen_titles: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut deduped_hits: Vec<&SearchHit> = Vec::new();
    for h in hits {
        let key = h.title.clone().unwrap_or_else(|| "未知".to_string());
        let cnt = seen_titles.entry(key).or_insert(0);
        *cnt += 1;
        if *cnt <= 1 {
            deduped_hits.push(h);
        }
    }
    let hits = deduped_hits;
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

/// Answer a "count" question by querying document metadata directly
async fn answer_count(
    db: &Database, project_id: &str, sq: &SearchQuery,
    _cfg: &AppConfig, _question: &str, _app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let count = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let (mut sql, params) = build_doc_filter_sql(project_id, sq);
        // Replace full column list with COUNT(*)
        sql = format!("SELECT COUNT(*) FROM document WHERE {}",
            sql.split("WHERE").nth(1).unwrap_or("1=1"));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, param_refs.as_slice(), |row| row.get::<_, i64>(0))
            .unwrap_or(0)
    };

    // Deduplicate by title
    let unique_count = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let (mut sql, params) = build_doc_filter_sql(project_id, sq);
        sql = format!("SELECT COUNT(DISTINCT COALESCE(title, filename)) FROM ({})", sql);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, param_refs.as_slice(), |row| row.get::<_, i64>(0)).unwrap_or(count)
    };

    let dedup_note = if unique_count < count {
        format!("（去重后 {} 篇，原始 {} 条记录）", unique_count, count)
    } else {
        String::new()
    };
    let ctx = format!("知识库中共有 {} 篇文献{}（符合条件：{}）", unique_count, dedup_note, describe_query(sq));
    Ok(ctx)
}

/// Answer a "list" question by querying documents and listing them
async fn answer_list(
    db: &Database, project_id: &str, sq: &SearchQuery,
    _cfg: &AppConfig, _question: &str, _app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let mut listing = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let (mut sql, params) = build_doc_filter_sql(project_id, sq);
        sql.push_str(" LIMIT 100");
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let docs: Vec<Document> = stmt.query_map(param_refs.as_slice(), doc_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        // Deduplicate by title, count occurrences
        let mut seen: std::collections::HashMap<String, (usize, &Document)> = std::collections::HashMap::new();
        let mut order: Vec<String> = Vec::new();
        for doc in &docs {
            let key = doc.title.clone().unwrap_or_else(|| doc.filename.clone());
            if let Some((count, _)) = seen.get_mut(&key) {
                *count += 1;
            } else {
                order.push(key.clone());
                seen.insert(key, (1, doc));
            }
        }

        let mut listing = String::new();
        if order.len() < docs.len() {
            listing.push_str(&format!("共 {} 篇文献（去重后 {} 篇，原始 {} 条记录）：\n\n", order.len(), order.len(), docs.len()));
        } else {
            listing.push_str(&format!("文献列表（{} 篇）：\n\n", docs.len()));
        }
        for (i, key) in order.iter().enumerate() {
            let (cnt, doc) = &seen[key];
            let title = doc.title.as_deref().unwrap_or(&doc.filename);
            let journal = doc.journal.as_deref().unwrap_or("");
            let year = doc.year.map(|y| y.to_string()).unwrap_or_default();
            if *cnt > 1 {
                listing.push_str(&format!("{}. {} ({}, {}) [×{} 份]\n", i + 1, title, journal, year, cnt));
            } else {
                listing.push_str(&format!("{}. {} ({}, {})\n", i + 1, title, journal, year));
            }
        }
        listing
    };

    // List queries don't need LLM — just return the list directly
    if listing.lines().count() <= 1 {
        listing.push_str("（无匹配文献）");
    }
    Ok(listing)
}

/// Build WHERE clause for document filtering (reusable across count/list/search)
fn get_or_create_default_kb(conn: &rusqlite::Connection) -> String {
    let kb_id: Result<String, _> = conn.query_row(
        "SELECT id FROM knowledge_base LIMIT 1", [], |row| row.get(0),
    );
    kb_id.unwrap_or_else(|_| "default".to_string())
}

fn build_doc_filter_sql(project_id: &str, sq: &SearchQuery) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut sql = format!(
        "SELECT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'",
        DOC_COLS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];

    if let Some(ref j) = sq.journal {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND journal LIKE ?{}", idx));
        params.push(Box::new(format!("%{}%", j)));
    }
    if let Some(ref dom) = sq.domain {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND (domain LIKE ?{} OR keywords LIKE ?{})", idx, idx));
        params.push(Box::new(format!("%{}%", dom)));
    }
    if let Some(ref auth) = sq.author {
        let idx = params.len() + 1;
        sql.push_str(&format!(" AND authors LIKE ?{}", idx));
        params.push(Box::new(format!("%{}%", auth)));
    }
    (sql, params)
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

/// Add existing document to a project
#[command]
pub async fn add_doc_to_project(
    doc_id: String,
    project_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM project_document WHERE project_id = ?1 AND document_id = ?2",
        rusqlite::params![project_id, doc_id],
    ).map_err(|e| e.to_string())?;
    Ok("已移除".to_string())
}

/// List all knowledge bases
#[command]
pub async fn list_knowledge_bases(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO knowledge_base (id, name, description, created_at) VALUES (?1,?2,?3,?4)",
        rusqlite::params![id, name, None::<String>, chrono::Utc::now().to_rfc3339()],
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM project_kb WHERE project_id = ?1 AND kb_id = ?2",
        rusqlite::params![project_id, kb_id],
    ).map_err(|e| e.to_string())?;
    Ok("已取消关联".to_string())
}

/// Get all documents in the global pool (not tied to a project)
#[command]
pub async fn get_all_documents(
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Document>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM doc_vector WHERE doc_id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM document WHERE id = ?1", rusqlite::params![doc_id])
        .map_err(|e| e.to_string())?;
    Ok("已删除".to_string())
}

const DOC_COLS: &str = "id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at";

fn doc_from_row(row: &rusqlite::Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?, filename: row.get(1)?, file_path: row.get(2)?,
        title: row.get(3)?, authors: row.get(4)?, year: row.get(5)?,
        journal: row.get(6)?, doi: row.get(7)?, abstract_: row.get(8)?,
        domain: row.get(9)?, subdomain: row.get(10)?,
        keywords: row.get(11)?, methodology: row.get(12)?, dataset_: row.get(13)?,
        claims: row.get(14)?, full_text: row.get(15)?, chunk_count: row.get(16)?,
        status: row.get(17)?, created_at: row.get(18)?,
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
