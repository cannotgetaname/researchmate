use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub module: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub filename: String,
    pub file_path: String,
    pub title: Option<String>,
    pub authors: Option<String>,
    pub year: Option<i32>,
    pub journal: Option<String>,
    pub doi: Option<String>,
    pub abstract_: Option<String>,
    pub domain: Option<String>,
    pub subdomain: Option<String>,
    pub keywords: Option<String>,
    pub methodology: Option<String>,
    pub dataset_: Option<String>,
    pub claims: Option<String>,
    pub chunk_count: i32,
    pub status: String,
    pub created_at: String,
}
