use std::sync::{Arc, RwLock};
use tauri::{command, State};

use crate::db::Database;
use crate::db::models::SearchQuery;
use crate::config::AppConfig;
use crate::knowledge::embedding;

use super::{build_doc_filter_sql, describe_query};
use super::search::{execute_search, search_bm25, build_context};

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
    use crate::commands::writing::{StreamChunk, StageEvent};
    use tauri::Emitter;

    eprintln!("[ask] question={question}");
    let cfg = { config.read().unwrap().clone() };
    eprintln!("[ask] provider={} model={}", cfg.embedding_provider, cfg.model_for("literature"));

    let mut sq = parse_search_intent(&question, &cfg).await?;
    eprintln!("[ask] parse_search_intent done, strategy={}", sq.strategy);
    if let Some(ids) = kb_ids {
        if !ids.is_empty() {
            sq.kb_ids = ids;
        }
    }

    match sq.strategy.as_str() {
        "count" => {
            return answer_count(&db, &project_id, &sq, &cfg, &question, &app_handle).await;
        }
        "list" => {
            return answer_list(&db, &project_id, &sq, &cfg, &question, &app_handle).await;
        }
        _ => {}
    }

    let query_vec = if sq.semantic && cfg.embedding_provider != "bm25" {
        Some(embedding::embed_text(&question, &cfg).await?)
    } else {
        None
    };

    eprintln!("[ask] strategy={} semantic={} author={:?} journal={:?} domain={:?}", sq.strategy, sq.semantic, sq.author, sq.journal, sq.domain);
    let hits = if cfg.embedding_provider == "bm25" && sq.semantic {
        search_bm25(&db, &project_id, &sq)?
    } else {
        let qv = query_vec.as_ref();
        execute_search(&db, &project_id, &sq, qv)?
    };

    eprintln!("[ask] hits count={}", hits.len());
    let mut hits = hits;
    if hits.is_empty() && (sq.author.is_some() || sq.journal.is_some() || sq.domain.is_some()) {
        eprintln!("[ask] filter search returned 0, retrying without filters");
        sq.author = None;
        sq.journal = None;
        sq.domain = None;
        hits = if cfg.embedding_provider == "bm25" && sq.semantic {
            search_bm25(&db, &project_id, &sq)?
        } else {
            let qv = query_vec.as_ref();
            execute_search(&db, &project_id, &sq, qv)?
        };
        eprintln!("[ask] fallback hits count={}", hits.len());
    }

    if hits.is_empty() {
        return Ok("知识库中没有找到相关文献，请先上传 PDF 或调整检索条件。".to_string());
    }

    let context = build_context(&hits, &sq);
    eprintln!("[ask] context size: {} chars, first 200: {}", context.len(), context.chars().take(200).collect::<String>());

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
    let handle2 = app_handle.clone();

    let result = engine.chat_stream_thinking(&system_prompt, &[], "", move |delta| {
        let _ = handle.emit("polish-stream", StreamChunk { delta });
    }, move |stage| {
        let _ = handle2.emit("polish-stage", StageEvent { stage: stage.into() });
    }).await?;

    Ok(result)
}

/// Use LLM to parse the user question into a search strategy
pub(crate) async fn parse_search_intent(question: &str, config: &AppConfig) -> Result<SearchQuery, String> {
    use crate::llm::LlmEngine;

    if config.deepseek_api_key.is_empty() {
        eprintln!("[ask] no API key, using heuristic strategy");
        return Ok(heuristic_search_strategy(question));
    }

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

/// Simple heuristic to determine search strategy without LLM call
fn heuristic_search_strategy(question: &str) -> SearchQuery {
    let lower = question.to_lowercase();
    let strategy = if lower.contains("有几篇") || lower.contains("多少") || lower.contains("count") || lower.contains("数量") {
        "count".to_string()
    } else if lower.contains("列出") || lower.contains("有哪些") || lower.contains("list") || lower.contains("所有") {
        "list".to_string()
    } else if lower.contains("对比") || lower.contains("比较") || lower.contains("compare") || lower.contains("不同") {
        "compare".to_string()
    } else if lower.contains("这篇") || lower.contains("这个论文") || lower.contains("详细") || lower.contains("内容") {
        "single".to_string()
    } else {
        "semantic".to_string()
    };

    let semantic = strategy != "count" && strategy != "list";
    SearchQuery {
        question: question.to_string(),
        doc_id: None, journal: None, domain: None,
        methodology: None, author: None, kb_ids: vec![],
        semantic, strategy, max_docs: if semantic { 20 } else { 100 },
    }
}

/// Answer a "count" question by querying document metadata directly
async fn answer_count(
    db: &Database, project_id: &str, sq: &SearchQuery,
    _cfg: &AppConfig, _question: &str, app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let count = {
        let conn = db.lock_conn();
        let (mut sql, params) = build_doc_filter_sql(project_id, sq);
        sql = format!("SELECT COUNT(*) FROM document WHERE {}",
            sql.split("WHERE").nth(1).unwrap_or("1=1"));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, param_refs.as_slice(), |row| row.get::<_, i64>(0))
            .unwrap_or(0)
    };

    let unique_count = {
        let conn = db.lock_conn();
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
    eprintln!("[ask] count result: {ctx}");
    use tauri::Emitter;
    let _ = app_handle.emit("polish-stream", crate::commands::writing::StreamChunk { delta: ctx.clone() });
    Ok(ctx)
}

/// Answer a "list" question by querying documents and listing them
async fn answer_list(
    db: &Database, project_id: &str, sq: &SearchQuery,
    _cfg: &AppConfig, _question: &str, app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    let mut listing = {
        let conn = db.lock_conn();
        let (mut sql, params) = build_doc_filter_sql(project_id, sq);
        sql.push_str(" LIMIT 100");
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let docs: Vec<crate::db::models::Document> = stmt.query_map(param_refs.as_slice(), super::doc_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        let mut seen: std::collections::HashMap<String, (usize, &crate::db::models::Document)> = std::collections::HashMap::new();
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

    if listing.lines().count() <= 1 {
        listing.push_str("（无匹配文献）");
    }
    eprintln!("[ask] list result: {} chars", listing.len());
    use tauri::Emitter;
    let _ = app_handle.emit("polish-stream", crate::commands::writing::StreamChunk { delta: listing.clone() });
    Ok(listing)
}
