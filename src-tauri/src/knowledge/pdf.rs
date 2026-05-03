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
    let temp_dir = std::env::temp_dir().join("researchmate_odl");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时目录: {}", e))?;

    let path_str = path.to_string_lossy();
    let temp_str = temp_dir.to_string_lossy();

    let script = format!(
        r#"
import opendataloader_pdf, sys, os
try:
    os.makedirs("{1}", exist_ok=True)
    opendataloader_pdf.convert(
        input_path=["{0}"],
        output_dir="{1}",
        format="text",
        quiet=True,
    )
    # Find the output file
    for f in os.listdir("{1}"):
        if f.endswith('.txt'):
            with open(os.path.join("{1}", f), 'r', encoding='utf-8') as fh:
                print(fh.read())
            break
except Exception as e:
    print(f"ERROR: {{e}}", file=sys.stderr)
    sys.exit(1)
"#,
        path_str,
        temp_str,
    );

    let output = std::process::Command::new(&config.python_path)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Python 调用失败: {} (路径: {})", e, config.python_path))?;

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("OpenDataLoader 失败: {}", stderr));
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        return Err("OpenDataLoader 返回空内容，请确认 Java 11+ 已安装".to_string());
    }
    Ok(text)
}
