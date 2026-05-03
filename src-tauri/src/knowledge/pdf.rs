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
import sys
try:
    import opendataloader_pdf
    opendataloader_pdf.convert(
        input_path=["{}"],
        format="text",
        to_stdout=True,
    )
except Exception as e:
    print(f"ERROR: {{e}}", file=sys.stderr)
    sys.exit(1)
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

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        return Err("OpenDataLoader 返回空内容".to_string());
    }
    Ok(text)
}
