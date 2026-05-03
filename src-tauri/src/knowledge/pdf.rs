use std::path::Path;

/// Extract all text from a PDF file
pub fn extract_pdf_text(path: &Path) -> Result<String, String> {
    pdf_extract::extract_text(path)
        .map_err(|e| format!("PDF 解析失败：{}", e))
}
