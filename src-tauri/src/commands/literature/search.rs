use std::sync::{Arc, RwLock};
use std::collections::HashMap;
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::Document;
use crate::db::models::{SearchQuery, SearchHit};
use crate::config::AppConfig;
use crate::knowledge::embedding;

use super::{SearchResult, DOC_COLS, cosine_similarity, doc_from_row};

/// Semantic search across uploaded documents, optionally filtered by knowledge base IDs
#[command]
pub async fn search_knowledge(
    query: String,
    project_id: String,
    kb_ids: Option<Vec<String>>,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Vec<SearchResult>, String> {
    eprintln!("[search] query={query}");
    let cfg = { config.read().unwrap().clone() };
    eprintln!("[search] provider={}", cfg.embedding_provider);
    let query_vec = embedding::embed_text(&query, &cfg).await?;

    let conn = db.lock_conn();

    let mut doc_sql = format!(
        "SELECT DISTINCT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'",
        DOC_COLS
    );
    let mut doc_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];

    if let Some(ref ids) = kb_ids {
        if !ids.is_empty() {
            let placeholders: Vec<String> = ids.iter().enumerate()
                .map(|(i, _)| format!("?{}", i + 2)).collect();
            doc_sql.push_str(&format!(" AND kd.kb_id IN ({})", placeholders.join(",")));
            for id in ids {
                doc_params.push(Box::new(id.clone()));
            }
        }
    }

    let mut docs_stmt = conn.prepare(doc_sql.as_str()).map_err(|e| e.to_string())?;
    let doc_param_refs: Vec<&dyn rusqlite::types::ToSql> = doc_params.iter().map(|p| p.as_ref()).collect();

    let docs: Vec<Document> = docs_stmt.query_map(doc_param_refs.as_slice(), doc_from_row)
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

/// Two-phase search: (1) find candidate documents via metadata + doc_vector,
/// then (2) semantic chunk search within those documents only.
pub(crate) fn execute_search(
    db: &Database, project_id: &str, sq: &SearchQuery,
    query_vec: Option<&Vec<f32>>,
) -> Result<Vec<SearchHit>, String> {
    let conn = db.lock_conn();

    let candidate_doc_ids = {
        let mut doc_sql = String::from(
            "SELECT DISTINCT d.id FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'"
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

        if !sq.kb_ids.is_empty() {
            let placeholders: Vec<String> = sq.kb_ids.iter().enumerate()
                .map(|(i, _)| format!("?{}", doc_params.len() + i + 1)).collect();
            doc_sql.push_str(&format!(" AND kd.kb_id IN ({})", placeholders.join(",")));
            for kb_id in &sq.kb_ids {
                doc_params.push(Box::new(kb_id.clone()));
            }
        }

        if let Some(qv) = query_vec {
            if sq.doc_id.is_none() && sq.journal.is_none() && sq.domain.is_none() && sq.author.is_none() && sq.kb_ids.is_empty() {
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

    eprintln!("[search] candidate_doc_ids count={}", candidate_doc_ids.len());
    if candidate_doc_ids.is_empty() {
        return Ok(vec![]);
    }

    struct RawHit {
        chunk_id: String, document_id: String, title: Option<String>,
        authors: Option<String>, journal: Option<String>, domain: Option<String>,
        methodology: Option<String>, heading: Option<String>, role: Option<String>,
        text: String, vector_json: String,
    }

    // ── Single-paper strategy: return ALL chunks from the target document in order ──
    if sq.strategy == "single" {
        let top_doc_id = &candidate_doc_ids[0];
        let chunk_sql = format!(
            "SELECT c.id, c.document_id, d.title, d.authors, d.journal, d.domain, d.methodology, c.heading, c.role, c.text, c.vector
             FROM doc_chunk c JOIN document d ON c.document_id = d.id
             WHERE c.document_id = ?1 ORDER BY c.chunk_index ASC LIMIT 100"
        );
        let mut chunk_stmt = conn.prepare(&chunk_sql).map_err(|e| e.to_string())?;
        let raw_hits: Vec<RawHit> = chunk_stmt.query_map(rusqlite::params![top_doc_id], |row| {
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

        let hits: Vec<SearchHit> = raw_hits.into_iter().map(|r| SearchHit {
            chunk_id: r.chunk_id, document_id: r.document_id,
            title: r.title, authors: r.authors, journal: r.journal,
            domain: r.domain, methodology: r.methodology,
            heading: r.heading, role: r.role, text: r.text, score: 1.0,
        }).collect();
        return Ok(hits);
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

/// BM25 search: loads all chunks from DB, tokenizes, scores against query.
pub(crate) fn search_bm25(db: &Database, project_id: &str, sq: &SearchQuery) -> Result<Vec<SearchHit>, String> {
    use crate::knowledge::bm25;
    let conn = db.lock_conn();

    let mut sql = String::from(
        "SELECT c.id, c.document_id, d.title, d.authors, d.journal, d.domain, d.methodology, c.heading, c.role, c.text
         FROM doc_chunk c JOIN document d ON c.document_id = d.id
         JOIN kb_document kd ON d.id = kd.document_id
         JOIN project_kb pk ON kd.kb_id = pk.kb_id
         WHERE pk.project_id = ?1 AND d.status = 'ready'"
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];
    if !sq.kb_ids.is_empty() {
        let ph: Vec<String> = sq.kb_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
        sql.push_str(&format!(" AND kd.kb_id IN ({})", ph.join(",")));
        for id in &sq.kb_ids { params.push(Box::new(id.clone())); }
    }
    sql.push_str(" LIMIT 200");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    struct ChunkData {
        chunk_id: String, document_id: String, title: Option<String>,
        authors: Option<String>, journal: Option<String>, domain: Option<String>,
        methodology: Option<String>, heading: Option<String>, role: Option<String>,
        text: String,
    }

    let chunks: Vec<ChunkData> = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(ChunkData {
            chunk_id: row.get(0)?, document_id: row.get(1)?, title: row.get(2)?,
            authors: row.get(3)?, journal: row.get(4)?, domain: row.get(5)?,
            methodology: row.get(6)?, heading: row.get(7)?, role: row.get(8)?,
            text: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    drop(stmt);
    drop(conn);

    if chunks.is_empty() {
        return Ok(vec![]);
    }

    let query_tokens = bm25::tokenize(&sq.question);
    let freqs: Vec<HashMap<String, usize>> = chunks.iter()
        .map(|c| bm25::token_freqs(&c.text))
        .collect();
    let idf = bm25::build_idf(&freqs);

    let total_len: usize = chunks.iter().map(|c| c.text.len()).sum();
    let avg_len = total_len as f32 / chunks.len() as f32;

    let mut scored: Vec<(usize, f32)> = chunks.iter().enumerate().map(|(i, c)| {
        let doc_freqs = &freqs[i];
        let doc_len = c.text.len();
        let score = bm25::bm25_score(&query_tokens, doc_freqs, doc_len, avg_len, &idf);
        (i, score)
    }).collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(sq.max_docs);

    let mut hits: Vec<SearchHit> = Vec::new();
    for (idx, score) in scored {
        let c = &chunks[idx];
        hits.push(SearchHit {
            chunk_id: c.chunk_id.clone(), document_id: c.document_id.clone(),
            title: c.title.clone(), authors: c.authors.clone(),
            journal: c.journal.clone(), domain: c.domain.clone(),
            methodology: c.methodology.clone(), heading: c.heading.clone(),
            role: c.role.clone(), text: c.text.clone(), score,
        });
    }

    Ok(hits)
}

pub(crate) fn build_context(hits: &[SearchHit], sq: &SearchQuery) -> String {
    if sq.doc_id.is_some() || sq.strategy == "single" {
        if hits.is_empty() { return String::new(); }
        let title = hits[0].title.as_deref().unwrap_or("未知");
        let mut ctx = format!("以下提供的是论文**{}**的**全文内容**（共{}个段落），不是摘要。请基于全文内容全面回答用户问题。\n\n", title, hits.len());
        for h in hits.iter() {
            ctx.push_str(&format!("{}\n\n", h.text));
        }
        return ctx;
    }

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
    if hits.is_empty() { return String::new(); }

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
