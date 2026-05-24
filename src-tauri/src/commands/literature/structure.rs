use std::sync::{Arc, RwLock};
use tauri::{command, State};

use crate::db::Database;
use crate::config::AppConfig;

/// Extract paper section structure from document chunks using regular expressions.
/// Offline, no API call. Stores results in paper_structure table.
/// Set force=true to re-analyze and overwrite existing cache.
#[command]
pub async fn extract_paper_structure(
    document_id: String,
    project_id: String,
    force: Option<bool>,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    eprintln!("[structure] extract_paper_structure called: doc={document_id}, force={force:?}");
    let conn = db.lock_conn();

    if force.unwrap_or(false) {
        conn.execute("DELETE FROM paper_structure WHERE document_id = ?1", rusqlite::params![document_id]).ok();
    }

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM paper_structure WHERE document_id = ?1",
        rusqlite::params![document_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    eprintln!("[structure] cached count: {count}");
    if count > 0 {
        let mut stmt = conn.prepare(
            "SELECT id, parent_id, tag, heading, role, summary, ordering FROM paper_structure WHERE document_id = ?1 ORDER BY ordering"
        ).map_err(|e| e.to_string())?;
        let nodes: Vec<serde_json::Value> = stmt.query_map(rusqlite::params![document_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "parent_id": row.get::<_, Option<String>>(1)?,
                "tag": row.get::<_, String>(2)?,
                "heading": row.get::<_, String>(3)?,
                "role": row.get::<_, Option<String>>(4)?,
                "summary": row.get::<_, Option<String>>(5)?,
                "ordering": row.get::<_, i64>(6)?,
            }))
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        return Ok(nodes);
    }

    // Load full text from chunks
    let mut chunk_stmt = conn.prepare(
        "SELECT text FROM doc_chunk WHERE document_id = ?1 ORDER BY chunk_index"
    ).map_err(|e| e.to_string())?;
    let texts: Vec<String> = chunk_stmt.query_map(rusqlite::params![document_id], |row| {
        row.get::<_, String>(0)
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    if texts.is_empty() {
        return Err("该文档没有可分析的文本内容".into());
    }

    let full_text = texts.join("\n");
    let newline_count = full_text.matches('\n').count();
    let preview: String = full_text.chars().take(500).collect();
    eprintln!("[structure] full_text len={}, newlines={}, first 500 chars:\n{}", full_text.len(), newline_count, preview);
    drop(chunk_stmt);
    // Release DB lock before regex processing
    drop(conn);

    use regex::Regex;
    // Numbered headings: "1. Introduction" / "2.1 Method" / "1.Introduction" / "1 Introduction"
    // Relaxed to handle PDF extraction artifacts (missing space after dot)
    let numbered = Regex::new(r"^(?m)^\s*(\d+(?:\.\d+)*)\.?\s*(.+)$").unwrap();
    // Roman numeral headings: "I. Introduction" / "IV. Results" / "I.INTRODUCTION"
    let roman = Regex::new(r"^(?m)^\s*(IX|IV|V?I{0,3})\.\s*(.+)$").unwrap();
    // Named sections: match heading at line start, with or without trailing content
    let named = Regex::new(r"^(?mi)^\s*(?:(\d+\.?\s*)?)(Abstract|Introduction|Related\s+Work|Background|Motivation|Method(?:ology|s)?|System\s+(?:Model|Architecture|Design)|Architecture|Experiment(?:al)?\s*(?:Setup|Design|Results)?|Evaluation|Performance\s+Evaluation|Results?(?:\s+and\s+(?:Discussion|Analysis))?|Discussion(?:\s+and\s+Analysis)?|Analysis|Implementation|Case\s+Study|Conclusion|Future\s+Work|Acknowledgment|References?|Bibliography|Appendix|Keywords)\b").unwrap();
    // Chinese headings: "一、引言" / "1.1 方法"
    let chinese = Regex::new(r"^(?m)^[一二三四五六七八九十]+[、．.]\s*(.+)|^(\d+(?:\.\d+)*)\s+[一-鿿]").unwrap();

    struct HeadingMatch {
        full: String, depth: usize, title: String, pos: usize,
    }
    let mut matches: Vec<HeadingMatch> = Vec::new();

    for cap in numbered.captures_iter(&full_text) {
        let full = cap.get(0).unwrap().as_str().to_string();
        let num = cap.get(1).unwrap().as_str();
        let title = cap.get(2).unwrap().as_str().trim().to_string();
        let depth = num.split('.').count();
        matches.push(HeadingMatch { full, depth, title, pos: cap.get(0).unwrap().start() });
    }
    eprintln!("[structure]   numbered: {}", matches.len());

    let before_roman = matches.len();
    for cap in roman.captures_iter(&full_text) {
        let full = cap.get(0).unwrap().as_str().to_string();
        let title = cap.get(2).unwrap().as_str().trim().to_string();
        let depth = 1;
        if title.chars().filter(|c| c.is_uppercase()).count() as f32 / title.len().max(1) as f32 > 0.7 { continue; }
        matches.push(HeadingMatch { full: full.clone(), depth, title: full, pos: cap.get(0).unwrap().start() });
    }
    eprintln!("[structure]   +roman: {} (total: {})", matches.len() - before_roman, matches.len());

    let before_named = matches.len();
    for cap in named.captures_iter(&full_text) {
        let heading = cap.get(0).unwrap().as_str().trim().to_string();
        // Skip journal/volume headers (all-caps, long lines)
        if heading.len() > 30 && heading.chars().all(|c| c.is_uppercase() || c.is_ascii_whitespace() || c == ',' || c == '.') { continue; }
        // Skip if this heading is already covered by a previous match
        if matches.iter().any(|m| m.title.contains(&heading) || heading.contains(&m.title)) { continue; }
        matches.push(HeadingMatch { full: heading.clone(), depth: 1, title: heading, pos: cap.get(0).unwrap().start() });
    }
    eprintln!("[structure]   +named: {} (total: {})", matches.len() - before_named, matches.len());

    let before_chinese = matches.len();
    for cap in chinese.captures_iter(&full_text) {
        let full = cap.get(0).unwrap().as_str().trim().to_string();
        if matches.iter().any(|m| m.full.contains(&full)) { continue; }
        let depth = if full.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            full.split('.').count()
        } else { 1 };
        matches.push(HeadingMatch { full: full.clone(), depth, title: full, pos: cap.get(0).unwrap().start() });
    }
    eprintln!("[structure]   +chinese: {} (total: {})", matches.len() - before_chinese, matches.len());

    matches.sort_by_key(|m| m.pos);
    eprintln!("[structure] found {} heading matches total", matches.len());
    for m in &matches {
        eprintln!("[structure]   depth={} title={}", m.depth, m.title);
    }

    // Re-acquire DB lock for writing results
    let conn = db.lock_conn();
    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut order = 0i64;
    let mut depth_stack: Vec<String> = Vec::new();
    for m in &matches {
        while depth_stack.len() > m.depth { depth_stack.pop(); }
        while depth_stack.len() < m.depth - 1 { depth_stack.push(String::new()); }
        let parent_id = if m.depth > 1 { depth_stack.last().cloned() } else { None };
        let id = uuid::Uuid::new_v4().to_string();
        let tag = match m.depth {
            0 | 1 => "section",
            2 => "subsection",
            _ => "subsubsection",
        };

        conn.execute(
            "INSERT INTO paper_structure (id, document_id, parent_id, tag, heading, ordering) VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, document_id, parent_id, tag, m.title, order],
        ).map_err(|e| e.to_string())?;

        nodes.push(serde_json::json!({
            "id": id, "parent_id": parent_id, "tag": tag,
            "heading": m.title, "role": null, "summary": null, "ordering": order,
        }));

        if depth_stack.len() >= m.depth {
            depth_stack.truncate(m.depth - 1);
        }
        depth_stack.push(id.clone());
        order += 1;
    }

    Ok(nodes)
}

/// Extract paper section structure using LLM — handles arbitrary heading formats.
/// Also annotates each node with academic role and a brief summary.
#[command]
pub async fn extract_paper_structure_ai(
    document_id: String,
    db: State<'_, Arc<Database>>,
    config: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<Vec<serde_json::Value>, String> {
    eprintln!("[structure_ai] called: doc={document_id}");

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

    // Use first 12K chars for the prompt (covers most paper structure)
    let text_snippet: String = full_text.chars().take(12000).collect();
    eprintln!("[structure_ai] text len={}, snippet={}", full_text.len(), text_snippet.len());

    let cfg = { config.read().unwrap().clone() };
    if cfg.deepseek_api_key.is_empty() {
        return Err("请先在设置中配置 API Key".into());
    }

    let model = cfg.model_for("literature").to_string();
    let engine = crate::llm::LlmEngine::new(&cfg, &model);

    let prompt = format!(
        r#"分析以下学术论文，提取所有章节标题，构建层级结构树，并标注每节的学术角色。

返回纯JSON（不要markdown代码块）：
{{
  "sections": [
    {{
      "heading": "Introduction",
      "depth": 1,
      "role": "background",
      "summary": "介绍研究背景、问题动机和主要贡献"
    }},
    {{
      "heading": "Related Work",
      "depth": 1,
      "role": "literature",
      "summary": "综述已有方法及其局限性"
    }}
  ]
}}

depth: 1=主章节, 2=子节, 3=子子节
role 从以下选择: background, literature, method, experiment, result, discussion, conclusion, appendix
summary: 用一句话概括该节内容（中文，15字以内）

论文文本：
{}"#,
        text_snippet
    );

    eprintln!("[structure_ai] calling LLM (non-streaming)...");
    let response = engine.chat_complete(&prompt, &text_snippet).await?;

    let json_str = response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    eprintln!("[structure_ai] response len={}, first 300: {}", json_str.len(), json_str.chars().take(300).collect::<String>());

    let parsed: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("LLM 返回格式异常：{}\n原始响应：{}", e, &json_str[..json_str.len().min(500)]))?;

    let sections = parsed["sections"].as_array()
        .ok_or_else(|| format!("LLM 未返回 sections 数组：{}", &json_str[..json_str.len().min(300)]))?;

    if sections.is_empty() {
        return Err("LLM 未识别到任何章节".into());
    }

    // Store to DB
    let conn = db.lock_conn();
    conn.execute("DELETE FROM paper_structure WHERE document_id = ?1", rusqlite::params![document_id])
        .map_err(|e| e.to_string())?;

    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut depth_stack: Vec<String> = Vec::new();

    for (i, sec) in sections.iter().enumerate() {
        let heading = sec["heading"].as_str().unwrap_or("未命名").to_string();
        let depth = sec["depth"].as_u64().unwrap_or(1) as usize;
        let role = sec["role"].as_str().map(String::from);
        let summary = sec["summary"].as_str().map(String::from);

        while depth_stack.len() > depth { depth_stack.pop(); }
        while depth_stack.len() < depth - 1 { depth_stack.push(String::new()); }

        let parent_id = if depth > 1 { depth_stack.last().cloned() } else { None };
        let id = uuid::Uuid::new_v4().to_string();
        let tag = match depth {
            0 | 1 => "section",
            2 => "subsection",
            _ => "subsubsection",
        };

        conn.execute(
            "INSERT INTO paper_structure (id, document_id, parent_id, tag, heading, role, summary, ordering) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![id, document_id, parent_id, tag, heading, role, summary, i as i64],
        ).map_err(|e| e.to_string())?;

        nodes.push(serde_json::json!({
            "id": id, "parent_id": parent_id, "tag": tag,
            "heading": heading, "role": role, "summary": summary, "ordering": i,
        }));

        if depth_stack.len() >= depth {
            depth_stack.truncate(depth - 1);
        }
        depth_stack.push(id.clone());
    }

    eprintln!("[structure_ai] stored {} sections", nodes.len());
    Ok(nodes)
}
