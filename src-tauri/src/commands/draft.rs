use std::path::PathBuf;
use tauri::State;

/// Save draft markdown to disk
#[tauri::command]
pub async fn save_draft(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    content: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;
    let path = project_dir.join("draft.md");
    std::fs::write(&path, &content).map_err(|e| format!("保存草稿失败：{}", e))?;
    Ok("已保存".to_string())
}

/// Load draft markdown from disk
#[tauri::command]
pub async fn load_draft(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<String, String> {
    let path = output_dir.join("projects").join(&project_id).join("draft.md");
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| format!("读取草稿失败：{}", e))
    } else {
        Ok(String::new())
    }
}
