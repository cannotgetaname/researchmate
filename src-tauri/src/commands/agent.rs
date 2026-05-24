use std::sync::{Arc, RwLock};
use tauri::{command, State};

use crate::db::Database;
use crate::config::AppConfig;
use crate::llm::LlmEngine;
use crate::commands::literature::search;
use crate::knowledge;

/// Tool-calling agent: lets the AI search the knowledge base.
/// Returns the final assistant response after tool calls are resolved.

#[derive(serde::Serialize, Clone)]
pub struct ToolEvent {
    #[serde(rename = "type")]
    pub event_type: String,  // "tool_start" | "tool_result"
    pub name: String,
    pub args: Option<serde_json::Value>,
    pub result: Option<String>,
}

#[command]
pub async fn chat_with_tools(
    project_id: String,
    _session_id: String,
    user_message: String,
    kb_ids: Option<Vec<String>>,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;
    let cfg = { config.read().unwrap().clone() };
    let model = cfg.model_for("literature").to_string();
    let engine = LlmEngine::new(&cfg, &model);

    let system_prompt = r#"你是一个学术研究助手，可以使用以下工具：

**search_knowledge** — 搜索知识库文献。策略选择：
- 用户问"有几篇/多少" → strategy=count
- 用户问"有哪些/列出" → strategy=list
- 用户问某篇论文的具体内容 → strategy=single（返回全文，仔细阅读后直接回答）
- 用户问对比多篇 → strategy=compare
- 通用搜索 → strategy=semantic

**review_text** — 审阅用户提供的文本。自动判断审阅维度（逻辑/方法/表述/引用/全面）。

**summarize_text** — 总结用户提供的文本。风格选择：简短/详细/要点列表。

核心规则：
1. 工具返回的文献片段就是全部信息来源，不要编造
2. single 策略返回完整论文后，直接回答，不要再搜索
3. 引用文献时标注**【文献标题】**
4. 回答尽量结构化，审阅意见分点列出"#;

    let tools: Vec<(String, String, serde_json::Value)> = vec![
        (
            "search_knowledge".into(),
            "搜索知识库中的文献，返回匹配的文献片段。支持按主题、期刊、领域、作者、方法过滤。支持计数、列表、语义、单篇详查、对比等策略。当用户询问文献相关问题、需要查找论文、统计数量、对比文献时使用。".into(),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索查询，自然语言描述"},
                    "strategy": {"type": "string", "enum": ["semantic", "count", "list", "single", "compare"], "description": "检索策略"},
                    "journal": {"type": "string", "description": "按期刊过滤"},
                    "domain": {"type": "string", "description": "按领域过滤"},
                    "author": {"type": "string", "description": "按作者过滤"},
                    "methodology": {"type": "string", "description": "按方法过滤"}
                },
                "required": ["query"]
            }),
        ),
        (
            "review_text".into(),
            "对用户提供的文本进行学术审阅，指出论证逻辑问题、方法缺陷、表述不清晰之处、遗漏引用等。返回结构化审阅意见。当用户要求审阅、批判、评价一段文字时使用。".into(),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "需要审阅的文本内容"},
                    "aspect": {"type": "string", "enum": ["logic", "method", "clarity", "citation", "all"], "description": "审阅维度: logic=逻辑, method=方法, clarity=表述, citation=引用, all=全面"}
                },
                "required": ["text"]
            }),
        ),
        (
            "summarize_text".into(),
            "对用户提供的长文本进行精炼总结，提取核心观点、方法、结论。当用户要求总结、概括、提取要点时使用。".into(),
            serde_json::json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "需要总结的文本"},
                    "style": {"type": "string", "enum": ["brief", "detailed", "bullet"], "description": "总结风格: brief=简短, detailed=详细, bullet=要点列表"}
                },
                "required": ["text"]
            }),
        ),
    ];

    let db_clone = db.inner().clone();
    let kb_ids_clone = kb_ids.clone();
    let handle = app_handle.clone();
    let handle2 = app_handle.clone();

    eprintln!("[agent] starting chat_with_tools, query={}", user_message);
    let result = engine
        .chat_with_tools(
            &system_prompt,
            &[],
            &user_message,
            tools,
            move |name, args| -> Result<String, String> {
                eprintln!("[agent] tool called: {} args={}", name, args);
                let _ = handle.emit("tool-stream", ToolEvent {
                    event_type: "tool_start".into(),
                    name: name.to_string(),
                    args: Some(args.clone()),
                    result: None,
                });

                let r = if name == "search_knowledge" {
                    execute_kb_search(&db_clone, &project_id, &args, &kb_ids_clone, &cfg)
                } else if name == "review_text" {
                    let text = args["text"].as_str().unwrap_or("");
                    if text.is_empty() { Err("文本不能为空".into()) }
                    else { Ok(format!("文本已收到（{}字）。请在下一轮回答中对文本进行全面学术审阅，指出论证逻辑、方法、表述、引用等方面的问题。", text.chars().count())) }
                } else if name == "summarize_text" {
                    let text = args["text"].as_str().unwrap_or("");
                    let style = args["style"].as_str().unwrap_or("brief");
                    if text.is_empty() { Err("文本不能为空".into()) }
                    else { Ok(format!("文本已收到（{}字）。请在下一轮回答中给出{}总结。", text.chars().count(),
                        match style { "detailed" => "详细", "bullet" => "要点列表式", _ => "简短" })) }
                } else {
                    Err(format!("未知工具: {}", name))
                };

                let _ = handle.emit("tool-stream", ToolEvent {
                    event_type: "tool_result".into(),
                    name: name.to_string(),
                    args: None,
                    result: Some(r.as_ref().map(|s| {
                        // Truncate long results for the UI badge
                        if s.len() > 200 { format!("{}...", &s[..200]) } else { s.clone() }
                    }).unwrap_or_else(|e| e.clone())),
                });

                eprintln!("[agent] tool result len={}", r.as_ref().map(|s| s.len()).unwrap_or(0));
                r
            },
            move |reasoning| {
                let _ = handle2.emit("polish-stream", crate::commands::writing::StreamChunk { delta: reasoning });
            },
        )
        .await?;

    eprintln!("[agent] done, result len={}", result.len());
    Ok(result)
}

/// Execute knowledge base search using the literature pipeline.
/// Parses tool args (query + optional filters/strategy) and routes like ask_knowledge.
fn execute_kb_search(
    db: &Arc<Database>,
    project_id: &str,
    args: &serde_json::Value,
    kb_ids: &Option<Vec<String>>,
    cfg: &AppConfig,
) -> Result<String, String> {
    let query = args["query"].as_str().unwrap_or("").to_string();
    if query.is_empty() {
        return Ok("查询不能为空".into());
    }

    // Extract optional filters from tool args
    let strategy = args["strategy"].as_str().unwrap_or("semantic").to_string();
    let journal = args["journal"].as_str().map(String::from);
    let domain = args["domain"].as_str().map(String::from);
    let author = args["author"].as_str().map(String::from);
    let methodology = args["methodology"].as_str().map(String::from);

    let mut sq = crate::db::models::SearchQuery {
        question: query.clone(),
        semantic: strategy != "count" && strategy != "list",
        strategy,
        max_docs: 10,
        journal,
        domain,
        author,
        methodology,
        ..Default::default()
    };
    if let Some(ids) = kb_ids {
        sq.kb_ids = ids.clone();
    }

    // Strategy routing (same as ask_knowledge)
    match sq.strategy.as_str() {
        "count" => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut sql = format!(
                "SELECT COUNT(DISTINCT COALESCE(d.title, d.filename)) FROM document d
                 INNER JOIN kb_document kd ON d.id = kd.document_id
                 INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id
                 WHERE pk.project_id = ?1 AND d.status = 'ready'"
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];
            if !sq.kb_ids.is_empty() {
                let ph: Vec<String> = sq.kb_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
                sql.push_str(&format!(" AND kd.kb_id IN ({})", ph.join(",")));
                for id in &sq.kb_ids { params.push(Box::new(id.clone())); }
            }
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let count: i64 = conn.query_row(&sql, param_refs.as_slice(), |row| row.get(0)).unwrap_or(0);
            return Ok(format!("知识库中共有 {} 篇文献。", count));
        }
        "list" => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut sql = String::from(
                "SELECT d.title, d.filename, d.authors, d.year, d.journal FROM document d
                 INNER JOIN kb_document kd ON d.id = kd.document_id
                 INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id
                 WHERE pk.project_id = ?1 AND d.status = 'ready'"
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(project_id.to_string())];
            if !sq.kb_ids.is_empty() {
                let ph: Vec<String> = sq.kb_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
                sql.push_str(&format!(" AND kd.kb_id IN ({})", ph.join(",")));
                for id in &sq.kb_ids { params.push(Box::new(id.clone())); }
            }
            sql.push_str(" LIMIT 30");
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt.query_map(param_refs.as_slice(), |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i32>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            }).map_err(|e| e.to_string())?;
            let mut results = String::from("文献列表：\n");
            for (i, row) in rows.enumerate() {
                let (title, filename, _authors, year, journal) = row.map_err(|e| e.to_string())?;
                results.push_str(&format!("{}. {} ({}, {})\n", i + 1,
                    title.as_deref().unwrap_or(&filename),
                    journal.as_deref().unwrap_or(""),
                    year.map(|y| y.to_string()).unwrap_or_default(),
                ));
            }
            return Ok(if results.lines().count() <= 1 { "无匹配文献".into() } else { results });
        }
        _ => {} // semantic / single / compare — use two-phase search
    }

    // Semantic embedding
    let query_vec = knowledge::embedding::embed_text_sync(&query, cfg)?;

    // Execute two-phase search
    let hits = search::execute_search(db, project_id, &sq, Some(&query_vec))?;

    if hits.is_empty() {
        return Ok("知识库中没有找到相关文献".into());
    }

    // Build context from hits, with strategy-specific instructions
    let context = search::build_context(&hits, &sq);
    match sq.strategy.as_str() {
        "single" => Ok(format!("【已返回论文完整全文，请基于此内容直接回答用户问题，不要再调用任何工具。】\n\n{}", context)),
        "count" | "list" => Ok(format!("【直接使用以下结果回答用户，不要再次搜索。】\n\n{}", context)),
        _ => Ok(context),
    }
}

/// Set which KBs are associated with a session
#[command]
pub async fn set_session_kbs(
    session_id: String,
    kb_ids: Vec<String>,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM session_kb WHERE session_id = ?1", rusqlite::params![session_id])
        .map_err(|e| e.to_string())?;
    for kb_id in &kb_ids {
        conn.execute(
            "INSERT OR IGNORE INTO session_kb (session_id, kb_id) VALUES (?1, ?2)",
            rusqlite::params![session_id, kb_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok("已更新会话知识库".to_string())
}

/// Get KBs associated with a session
#[command]
pub async fn get_session_kbs(
    session_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT kb_id FROM session_kb WHERE session_id = ?1")
        .map_err(|e| e.to_string())?;
    let kb_ids = stmt.query_map(rusqlite::params![session_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(kb_ids)
}
