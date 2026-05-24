pub mod upload;
pub mod search;
pub mod rag;
pub mod citation;
pub mod structure;
pub mod kb;
pub mod documents;

// ── Shared types ──
#[derive(serde::Serialize)]
pub struct SearchResult {
    pub document: crate::db::models::Document,
    pub score: f32,
    pub snippet: String,
}

// ── Shared constants ──
pub(crate) const DOC_COLS: &str = "id, filename, file_path, title, authors, year, journal, doi, abstract, domain, subdomain, keywords, methodology, dataset, claims, full_text, chunk_count, status, created_at";

// ── Shared helpers ──

pub(crate) fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
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

pub(crate) fn doc_from_row(row: &rusqlite::Row) -> rusqlite::Result<crate::db::models::Document> {
    use crate::db::models::Document;
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

pub(crate) fn build_doc_filter_sql(
    project_id: &str,
    sq: &crate::db::models::SearchQuery,
) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut sql = format!(
        "SELECT DISTINCT {} FROM document d INNER JOIN kb_document kd ON d.id = kd.document_id INNER JOIN project_kb pk ON kd.kb_id = pk.kb_id WHERE pk.project_id = ?1 AND d.status = 'ready'",
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

    if !sq.kb_ids.is_empty() {
        let placeholders: Vec<String> = sq.kb_ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", params.len() + i + 1)).collect();
        sql.push_str(&format!(" AND kd.kb_id IN ({})", placeholders.join(",")));
        for kb_id in &sq.kb_ids {
            params.push(Box::new(kb_id.clone()));
        }
    }

    (sql, params)
}

pub(crate) fn describe_query(sq: &crate::db::models::SearchQuery) -> String {
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
