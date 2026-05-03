use std::path::Path;

use crate::config::AppConfig;

/// Extract text from PDF. Dispatches to the configured parser.
pub fn extract_pdf_text(path: &Path, config: &AppConfig) -> Result<String, String> {
    match config.pdf_parser.as_str() {
        "opendataloader" => extract_with_opendataloader(path, config),
        _ => extract_native(path),
    }
}

/// Native Rust PDF extraction (simple, always works)
fn extract_native(path: &Path) -> Result<String, String> {
    pdf_extract::extract_text(path)
        .map_err(|e| format!("PDF 解析失败：{}", e))
}

/// Use OpenDataLoader PDF (Python subprocess) for structured extraction
fn extract_with_opendataloader(path: &Path, config: &AppConfig) -> Result<String, String> {
    let script = format!(
        r#"
import json, sys
try:
    import opendataloader_pdf
    result = opendataloader_pdf.convert(
        input_path=["{}"],
        format="json"
    )
    print(json.dumps({{"ok": True, "data": result}}))
except Exception as e:
    print(json.dumps({{"ok": False, "error": str(e)}}))
"#,
        path.to_string_lossy()
    );

    let output = std::process::Command::new(&config.python_path)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Python 调用失败 ({}): {}", config.python_path, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("OpenDataLoader 失败：{}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("OpenDataLoader 输出解析失败：{}", e))?;

    if parsed["ok"].as_bool().unwrap_or(false) {
        // For now, flatten JSON to text; later we parse the structured output
        Ok(parsed["data"].to_string())
    } else {
        let err = parsed["error"].as_str().unwrap_or("未知错误");
        Err(format!("OpenDataLoader: {}", err))
    }
}
