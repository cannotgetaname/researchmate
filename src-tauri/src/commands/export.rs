use std::process::Command;
use tauri::State;
use std::path::PathBuf;

/// Resolve pandoc binary path: sidecar in production, PATH in development
fn pandoc_path(_app_handle: &tauri::AppHandle) -> PathBuf {
    // Production: sidecar next to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = if cfg!(target_os = "windows") {
                dir.join("pandoc.exe")
            } else {
                dir.join("pandoc")
            };
            if sidecar.exists() {
                return sidecar;
            }
        }
    }
    // Development / fallback: system PATH
    PathBuf::from("pandoc")
}

/// Export markdown content to DOCX or PDF via Pandoc
#[tauri::command]
pub async fn export_document(
    app_handle: tauri::AppHandle,
    content: String,
    format: String,       // "docx" or "pdf" or "html"
    output_dir: State<'_, PathBuf>,
    project_id: String,
    output_path: Option<String>,  // user-chosen path, or None for default
) -> Result<String, String> {
    let pandoc = pandoc_path(&app_handle);
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let target = if let Some(p) = output_path {
        PathBuf::from(p)
    } else {
        let export_dir = output_dir
            .join("projects")
            .join(&project_id)
            .join("exports");
        std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;
        export_dir.join(format!("export_{}.{}", timestamp, &format))
    };

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let export_dir = target.parent().unwrap_or(&target).to_path_buf();
    let output_path = target;

    // Write markdown to temp file
    let md_path = export_dir.join(format!("_draft_{}.md", timestamp));
    std::fs::write(&md_path, &content).map_err(|e| format!("写入草稿失败：{}", e))?;

    // Build pandoc command
    let mut cmd = Command::new(&pandoc);
    cmd.arg(&md_path)
       .arg("-o").arg(&output_path)
       .arg("--from=markdown+auto_identifiers+tex_math_dollars")
       .arg("--standalone");

    // Reference template (if present)
    let template_path = output_dir.join("template.docx");
    if template_path.exists() {
        cmd.arg("--reference-doc").arg(&template_path);
    }

    match format.as_str() {
        "docx" => {
            cmd.arg("--to=docx");
        }
        "pdf" => {
            cmd.arg("--to=pdf");
            cmd.arg("--pdf-engine=xelatex");
        }
        "html" => {
            cmd.arg("--to=html5");
            cmd.arg("--embed-resources");
        }
        _ => return Err(format!("不支持的导出格式：{}", format)),
    }

    let output = cmd.output().map_err(|e| format!("Pandoc 执行失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 错误：{}", stderr));
    }

    // Clean up temp markdown
    std::fs::remove_file(&md_path).ok();

    Ok(output_path.to_string_lossy().to_string())
}

/// Preview markdown as HTML via Pandoc (returns HTML string for iframe)
#[tauri::command]
pub async fn preview_html(
    app_handle: tauri::AppHandle,
    content: String,
) -> Result<String, String> {
    let pandoc = pandoc_path(&app_handle);

    let mut cmd = Command::new(&pandoc);
    cmd.arg("--from=markdown+auto_identifiers+tex_math_dollars")
       .arg("--to=html5")
       .arg("--standalone")
       .arg("--embed-resources")
       .arg("--mathjax")           // LaTeX math rendering in HTML
       .arg("--quiet")
       .stdin(std::process::Stdio::piped())
       .stdout(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Pandoc 启动失败：{}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        use std::io::Write;
        stdin.write_all(content.as_bytes()).map_err(|e| format!("写入 Pandoc stdin 失败：{}", e))?;
    }

    let output = child.wait_with_output().map_err(|e| format!("Pandoc 等待失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 错误：{}", stderr));
    }

    let html = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(html)
}

/// Generate default reference.docx template via Pandoc
#[tauri::command]
pub async fn generate_template(
    app_handle: tauri::AppHandle,
    output_dir: State<'_, PathBuf>,
) -> Result<String, String> {
    let pandoc = pandoc_path(&app_handle);
    let template_path = output_dir.join("template.docx");

    let output = Command::new(&pandoc)
        .arg("--print-default-data-file")
        .arg("reference.docx")
        .output()
        .map_err(|e| format!("生成模板失败：{}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 错误：{}", stderr));
    }

    std::fs::write(&template_path, &output.stdout).map_err(|e| format!("写入模板失败：{}", e))?;

    Ok(template_path.to_string_lossy().to_string())
}
