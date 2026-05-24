use std::sync::{Arc, RwLock};
use std::collections::HashMap;
use tauri::{command, State};

use crate::db::Database;
use crate::config::AppConfig;
use crate::knowledge::embedding;

use super::cosine_similarity;
use crate::llm::LlmEngine;

/// Extract citation entries from document's References section using regex.
/// Offline, no API call. Stores results in citation table.
#[command]
pub async fn extract_citations(
    document_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock_conn();

    // Check cache
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM citation WHERE document_id = ?1",
        rusqlite::params![document_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if count > 0 {
        let mut stmt = conn.prepare(
            "SELECT id, key, title, raw FROM citation WHERE document_id = ?1"
        ).map_err(|e| e.to_string())?;
        let entries: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![document_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "key": row.get::<_, String>(1)?,
                "title": row.get::<_, Option<String>>(2)?,
                "raw": row.get::<_, Option<String>>(3)?,
            }))
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        return Ok(entries);
    }

    // Load full text
    let mut chunk_stmt = conn.prepare(
        "SELECT text FROM doc_chunk WHERE document_id = ?1 ORDER BY chunk_index"
    ).map_err(|e| e.to_string())?;
    let texts: Vec<String> = chunk_stmt.query_map(rusqlite::params![document_id], |row| {
        row.get::<_, String>(0)
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    drop(chunk_stmt);

    if texts.is_empty() {
        return Err("该文档没有可分析的文本内容".into());
    }

    let full_text = texts.join("\n");

    use regex::Regex;
    eprintln!("[citation] full_text len={}", full_text.len());

    // Locate References section — try multiple strategies
    let ref_start = {
        // Strategy 1: standard heading on its own line
        let re1 = Regex::new(r"(?mi)^\s*(?:R\s*E\s*F\s*E\s*R\s*E\s*N\s*C\s*E\s*S?|References?|Bibliography|BIBLIOGRAPHY|参考文献)\s*$").unwrap();
        if let Some(m) = re1.find(&full_text) {
            eprintln!("[citation] found heading at pos {}: '{}'", m.start(), &full_text[m.start()..m.end()]);
            m.end()
        } else {
            // Strategy 2: looser match — heading anywhere, followed by [1] pattern
            let re2 = Regex::new(r"(?mi)(?:REFERENCES?|References?|Bibliography|参考文献)\b").unwrap();
            if let Some(m) = re2.find(&full_text) {
                eprintln!("[citation] found loose heading at pos {}: '{}'", m.start(), &full_text[m.start()..m.end()]);
                m.end()
            } else {
                // Strategy 3: find [1] reference pattern anywhere in the text
                let re3 = Regex::new(r"(?m)^\s*\[1\]\s").unwrap();
                if let Some(m) = re3.find(&full_text) {
                    eprintln!("[citation] found [1] pattern at pos {}", m.start());
                    m.start()
                } else {
                    eprintln!("[citation] no reference section found");
                    0
                }
            }
        }
    };

    if ref_start == 0 {
        return Ok(vec![]);
    }

    let ref_text = full_text[ref_start..].to_string();
    drop(conn);
    let db_inner = db.inner().clone();
    extract_citations_from_text(document_id, &db_inner, &ref_text)
}

/// Parse citation entries from reference text (shared by main and fallback paths)
fn extract_citations_from_text(
    document_id: String,
    db: &Database,
    ref_text: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let preview: String = ref_text.chars().take(300).collect();
    eprintln!("[citation] ref_text len={}, first 300: {}", ref_text.len(), preview);

    let conn = db.lock_conn();
    use regex::Regex;

    let cite_split = Regex::new(r"(?m)^\s*\[\d+\]\s*").unwrap();
    let entries: Vec<&str> = if cite_split.is_match(ref_text) {
        cite_split.split(ref_text).filter(|s| s.trim().len() > 10).collect()
    } else {
        ref_text.split("\n\n").filter(|s| s.trim().len() > 10).collect()
    };
    eprintln!("[citation] split into {} entries", entries.len());

    let author_year = Regex::new(r"([A-Z][a-z]+(?:\s+(?:et\s+al\.?|and\s+[A-Z][a-z]+))?)\s*[\[\(]?(\d{4})[\]\)]?").unwrap();
    let quoted_title = Regex::new(r#"[""]([^""]{10,200})[""]"#).unwrap();
    let dot_title = Regex::new(r"(?:\d{4}[\]\)]?[\.\s,]+|[A-Z][a-z]+,\s*[A-Z]\.?\s*[\[\(]?\d{4}[\]\)]?\s*[\.\,]\s*)([A-Z][^\.]{15,200})\.\s").unwrap();

    let mut results: Vec<serde_json::Value> = Vec::new();
    let mut seen_titles: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in entries {
        let raw = entry.trim().chars().take(500).collect::<String>();
        if raw.len() < 20 { continue; }
        let key = if let Some(cap) = author_year.captures(&raw) {
            format!("{} {}", cap.get(1).unwrap().as_str().trim(), cap.get(2).unwrap().as_str())
        } else { raw.chars().take(30).collect::<String>() };
        let title = if let Some(cap) = quoted_title.captures(&raw) {
            Some(cap.get(1).unwrap().as_str().to_string())
        } else if let Some(cap) = dot_title.captures(&raw) {
            Some(cap.get(1).unwrap().as_str().to_string())
        } else { None };

        let title_key = title.clone().unwrap_or_else(|| raw.clone());
        if seen_titles.contains(&title_key) { continue; }
        seen_titles.insert(title_key);

        let id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT OR IGNORE INTO citation (id, document_id, key, title, raw) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![id, document_id, key, title, raw]).map_err(|e| e.to_string())?;
        results.push(serde_json::json!({ "id": id, "key": key, "title": title, "raw": raw }));
    }
    eprintln!("[citation] stored {} unique citations", results.len());
    drop(conn);
    Ok(results)
}

/// Check a text snippet for citation suggestions — search doc-level + chunk-level vectors
#[command]
pub async fn check_citations(
    text: String,
    project_id: String,
    kb_ids: Option<Vec<String>>,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Vec<serde_json::Value>, String> {
    let cfg = { config.read().unwrap().clone() };
    let query_vec = embedding::embed_text_sync(&text, &cfg)?;

    let conn = db.lock_conn();

    // Phase 1: doc-level similarity
    let mut doc_sql = String::from(
        "SELECT DISTINCT d.id, d.title, d.filename, d.authors, d.year, d.journal, d.abstract, dv.vector
         FROM document d
         INNER JOIN doc_vector dv ON d.id = dv.doc_id
         INNER JOIN kb_document kd ON d.id = kd.document_id
         INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id
         WHERE pk.project_id = ?1 AND d.status = 'ready'"
    );
    let mut doc_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];
    if let Some(ref ids) = kb_ids {
        if !ids.is_empty() {
            let ph: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
            doc_sql.push_str(&format!(" AND kd.kb_id IN ({})", ph.join(",")));
            for id in ids { doc_params.push(Box::new(id.clone())); }
        }
    }
    let doc_param_refs: Vec<&dyn rusqlite::types::ToSql> = doc_params.iter().map(|p| p.as_ref()).collect();
    let mut doc_stmt = conn.prepare(&doc_sql).map_err(|e| e.to_string())?;

    let mut doc_scores: HashMap<String, (f32, serde_json::Value)> = HashMap::new();
    let rows = doc_stmt.query_map(doc_param_refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<i32>>(4)?, row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?, row.get::<_, Option<String>>(7)?,
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        let (id, title, filename, authors, year, _journal, abstract_, vector_json) = row.map_err(|e| e.to_string())?;
        let vector: Vec<f32> = serde_json::from_str(&vector_json.unwrap_or_default()).unwrap_or_default();
        if vector.is_empty() { continue; }
        let score = cosine_similarity(&query_vec, &vector);
        if score > 0.15 {
            let first_author = authors.as_deref().unwrap_or("").split(',').next().unwrap_or("").trim().to_string();
            let key = if let Some(y) = year {
                format!("{} {}", first_author, y)
            } else {
                first_author
            };
            let entry = serde_json::json!({
                "document_id": id,
                "title": title.unwrap_or_else(|| filename.clone()),
                "key": key,
                "relevance": score,
                "snippet": abstract_.unwrap_or_default().chars().take(250).collect::<String>(),
                "matched_text": filename,
            });
            doc_scores.insert(id, (score, entry));
        }
    }
    drop(doc_stmt);

    // Phase 2: chunk-level similarity
    let mut chunk_sql = String::from(
        "SELECT c.document_id, d.title, d.filename, d.authors, d.year, d.journal, c.text, c.vector
         FROM doc_chunk c JOIN document d ON c.document_id = d.id
         JOIN kb_document kd ON d.id = kd.document_id
         JOIN project_kb pk ON kd.kb_id = pk.kb_id
         WHERE pk.project_id = ?1 AND d.status = 'ready'"
    );
    let mut chunk_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.clone())];
    if let Some(ref ids) = kb_ids {
        if !ids.is_empty() {
            let ph: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
            chunk_sql.push_str(&format!(" AND kd.kb_id IN ({})", ph.join(",")));
            for id in ids { chunk_params.push(Box::new(id.clone())); }
        }
    }
    chunk_sql.push_str(" LIMIT 200");
    let mut chunk_stmt = conn.prepare(&chunk_sql).map_err(|e| e.to_string())?;
    let chunk_param_refs: Vec<&dyn rusqlite::types::ToSql> = chunk_params.iter().map(|p| p.as_ref()).collect();

    let rows = chunk_stmt.query_map(chunk_param_refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<i32>>(4)?, row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?, row.get::<_, Option<String>>(7)?,
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        let (doc_id, title, filename, authors, year, _journal, chunk_text, vector_json) = row.map_err(|e| e.to_string())?;
        let vector: Vec<f32> = serde_json::from_str(&vector_json.unwrap_or_default()).unwrap_or_default();
        if vector.is_empty() { continue; }
        let score = cosine_similarity(&query_vec, &vector);
        if score > 0.2 {
            let first_author = authors.as_deref().unwrap_or("").split(',').next().unwrap_or("").trim().to_string();
            let key = if let Some(y) = year {
                format!("{} {}", first_author, y)
            } else {
                first_author
            };
            let entry = serde_json::json!({
                "document_id": doc_id,
                "title": title.unwrap_or_else(|| filename.clone()),
                "key": key,
                "relevance": score,
                "snippet": chunk_text.chars().take(300).collect::<String>(),
                "matched_text": chunk_text.chars().take(200).collect::<String>(),
            });
            match doc_scores.get(&doc_id) {
                Some((existing_score, _)) if score > *existing_score => {
                    doc_scores.insert(doc_id.clone(), (score, entry));
                }
                None => {
                    doc_scores.insert(doc_id.clone(), (score, entry));
                }
                _ => {}
            }
        }
    }
    drop(chunk_stmt);
    drop(conn);

    let mut results: Vec<serde_json::Value> = doc_scores.into_values()
        .map(|(_, entry)| entry)
        .collect();
    results.sort_by(|a, b| b["relevance"].as_f64().unwrap_or(0.0).partial_cmp(&a["relevance"].as_f64().unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(5);

    Ok(results)
}

/// Extract citation entries using LLM — handles non-standard reference formats.
/// Sends only the tail portion of the paper (where references usually are).
#[command]
pub async fn extract_citations_ai(
    document_id: String,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Vec<serde_json::Value>, String> {
    eprintln!("[citation_ai] called: doc={document_id}");

    // Load full text from chunks
    let full_text = {
        let conn = db.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT text FROM doc_chunk WHERE document_id = ?1 ORDER BY chunk_index"
        ).map_err(|e| e.to_string())?;
        let texts: Vec<String> = stmt.query_map(rusqlite::params![document_id], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        if texts.is_empty() {
            return Err("该文档没有可分析的文本内容".into());
        }
        texts.join("\n")
    };

    // Use only the last 8000 chars (covers References section for most papers)
    let tail_start = if full_text.len() > 8000 { full_text.len() - 8000 } else { 0 };
    let text_snippet: String = full_text[tail_start..].to_string();
    eprintln!("[citation_ai] full_text len={}, using tail={} chars", full_text.len(), text_snippet.len());

    let cfg = { config.read().unwrap().clone() };
    if cfg.deepseek_api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    let model = cfg.model_for("literature").to_string();
    let engine = LlmEngine::new(&cfg, &model);

    let prompt = format!(
        r#"从以下论文尾部文本中提取所有参考文献条目。返回纯JSON：

{{
  "citations": [
    {{"key": "Smith 2020", "title": "Paper Title", "raw": "原始引用文本截断至200字"}}
  ]
}}

key 格式: "第一作者姓 年份"（如 "Smith 2020"），中文作者用"张 2020"
title: 论文标题
raw: 原始引用文本，截取前200字
识别不到某字段填null

文本：
{}"#,
        text_snippet
    );

    eprintln!("[citation_ai] calling LLM (non-streaming)...");
    let response = engine.chat_complete(&prompt, &text_snippet).await?;

    let json_str = response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    eprintln!("[citation_ai] response len={}", json_str.len());

    let parsed: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("LLM 返回格式异常：{}\n原始响应：{}", e, &json_str[..json_str.len().min(500)]))?;

    let citations = parsed["citations"].as_array()
        .ok_or_else(|| format!("LLM 未返回 citations 数组：{}", &json_str[..json_str.len().min(300)]))?;

    if citations.is_empty() {
        return Err("LLM 未识别到任何参考文献".into());
    }

    // Store to DB (merge with existing)
    let conn = db.lock_conn();
    let mut results: Vec<serde_json::Value> = Vec::new();

    for cit in citations {
        let key = cit["key"].as_str().unwrap_or("Unknown").to_string();
        let title = cit["title"].as_str().map(String::from);
        let raw = cit["raw"].as_str().map(|s| s.chars().take(500).collect::<String>());
        let id = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT OR IGNORE INTO citation (id, document_id, key, title, raw) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![id, document_id, key, title, raw],
        ).map_err(|e| e.to_string())?;

        results.push(serde_json::json!({ "id": id, "key": key, "title": title, "raw": raw }));
    }

    eprintln!("[citation_ai] stored {} citations", results.len());
    Ok(results)
}

/// Extract DOI from paper text using the standard DOI regex pattern.
fn extract_doi(text: &str) -> Option<String> {
    use regex::Regex;
    let re = Regex::new(r"(?i)\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b").unwrap();
    re.captures(text)
        .map(|c| c.get(1).unwrap().as_str().to_string())
        // Clean trailing punctuation that's not part of DOI
        .map(|s| s.trim_end_matches(|c: char| c == '.' || c == ',' || c == ';').to_string())
}

/// Query CrossRef API for cited references by DOI.
/// Returns list of {key, title, raw} objects, or empty if references unavailable.
fn lookup_crossref_references(doi: &str) -> Result<Vec<serde_json::Value>, String> {
    let url = format!("https://api.crossref.org/works/{}", doi);
    eprintln!("[crossref] querying {}", url);

    let resp = minreq::get(&url)
        .with_header("User-Agent", "ResearchMate/0.3 (mailto:researchmate@local)")
        .send()
        .map_err(|e| format!("CrossRef 请求失败：{}", e))?;

    let body = resp.as_str().map_err(|e| format!("CrossRef 响应异常：{}", e))?;
    let data: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("CrossRef JSON 解析失败：{}", e))?;

    if data["status"] != "ok" {
        return Err("CrossRef 查询失败".into());
    }

    let msg = &data["message"];
    let refs = msg["reference"].as_array();

    let ref_list = match refs {
        Some(list) if !list.is_empty() => list,
        _ => {
            eprintln!("[crossref] no references deposited for this DOI");
            return Ok(vec![]);
        }
    };

    let mut results = Vec::new();
    for r in ref_list.iter().take(200) {
        let author = r["author"].as_str().unwrap_or("");
        let year = r["year"].as_str().unwrap_or("");
        let yr: String = year.chars().take(4).collect();
        let key = if !author.is_empty() && !yr.is_empty() {
            format!("{} {}", author, yr)
        } else if !author.is_empty() {
            author.to_string()
        } else {
            yr
        };
        let title = r["article-title"].as_str()
            .or_else(|| r["volume-title"].as_str())
            .or_else(|| r["unstructured"].as_str())
            .map(String::from);
        let raw = r["unstructured"].as_str()
            .or_else(|| r["article-title"].as_str())
            .map(|s| s.chars().take(500).collect::<String>());

        results.push(serde_json::json!({
            "key": key,
            "title": title,
            "raw": raw,
        }));
    }
    eprintln!("[crossref] got {} references", results.len());
    Ok(results)
}

/// Extract citations via DOI → CrossRef lookup. Much more reliable than regex
/// for papers that have a DOI and deposited references.
#[command]
pub async fn extract_citations_doi(
    document_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    eprintln!("[citation_doi] called: doc={document_id}");

    // Load full text
    let full_text = {
        let conn = db.lock_conn();
        let mut stmt = conn.prepare(
            "SELECT text FROM doc_chunk WHERE document_id = ?1 ORDER BY chunk_index"
        ).map_err(|e| e.to_string())?;
        let texts: Vec<String> = stmt.query_map(rusqlite::params![document_id], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        if texts.is_empty() {
            return Err("该文档没有可分析的文本内容".into());
        }
        texts.join("\n")
    };

    // Try to find DOI — search full text (DOI can appear anywhere in IEEE papers)
    let doi = extract_doi(&full_text)
        .or_else(|| {
            // Also try looking for "doi:" or "DOI:" prefix specifically
            use regex::Regex;
            let re = Regex::new(r"(?i)doi:?\s*(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)").unwrap();
            re.captures(&full_text).map(|c| c.get(1).unwrap().as_str().to_string())
        })
        .ok_or_else(|| format!("未能从论文中提取到 DOI（全文 {} 字符）。请确认 PDF 中包含 DOI 信息。", full_text.len()))?;
    eprintln!("[citation_doi] found DOI: {doi}");

    // Query CrossRef
    let refs = lookup_crossref_references(&doi)?;

    if refs.is_empty() {
        return Err("CrossRef 中该论文未提交参考文献数据。请尝试 🤖 AI 提取。".into());
    }

    // Store to DB
    let conn = db.lock_conn();
    conn.execute("DELETE FROM citation WHERE document_id = ?1", rusqlite::params![document_id])
        .map_err(|e| e.to_string())?;

    let mut results: Vec<serde_json::Value> = Vec::new();
    for cit in &refs {
        let id = uuid::Uuid::new_v4().to_string();
        let key = cit["key"].as_str().unwrap_or("Unknown").to_string();
        let title = cit["title"].as_str().map(String::from);
        let raw = cit["raw"].as_str().map(String::from);

        conn.execute(
            "INSERT INTO citation (id, document_id, key, title, raw) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![id, document_id, key, title, raw],
        ).map_err(|e| e.to_string())?;

        results.push(serde_json::json!({ "id": id, "key": key, "title": title, "raw": raw }));
    }

    eprintln!("[citation_doi] stored {} citations", results.len());
    Ok(results)
}
