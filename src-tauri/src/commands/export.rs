use std::process::Command;
use tauri::State;
use std::path::PathBuf;

/// Resolve pandoc path: system PATH → local bin → auto-download
fn pandoc_path(app_dir: &PathBuf) -> PathBuf {
    let sys_name = if cfg!(target_os = "windows") { "pandoc.exe" } else { "pandoc" };

    // 1. Next to the executable (for manual placement by users)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let next_to_exe = dir.join(sys_name);
            if next_to_exe.exists() {
                return next_to_exe;
            }
        }
    }

    // 2. System PATH
    if let Ok(p) = which::which(sys_name) {
        return p;
    }

    // 3. Local .researchmate/bin/ (auto-download target)
    let bin_dir = app_dir.join("bin");
    let local = bin_dir.join(sys_name);
    if local.exists() {
        return local;
    }

    // 4. Try auto-download (best effort)
    if let Ok(path) = download_pandoc(app_dir) {
        return path;
    }

    // 5. Fallback — will produce a clear "pandoc not found" error downstream
    PathBuf::from(sys_name)
}

/// Download Pandoc binary if not present. Tries multiple mirrors (GitHub → ghproxy → manual).
fn download_pandoc(app_dir: &PathBuf) -> Result<PathBuf, String> {
    let bin_dir = app_dir.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let sys_name = if cfg!(target_os = "windows") { "pandoc.exe" } else { "pandoc" };
    let target = bin_dir.join(sys_name);

    let (path_suffix, archive_name) = if cfg!(target_os = "windows") {
        ("pandoc-3.6.4-windows-x86_64.zip", "pandoc.zip")
    } else {
        ("pandoc-3.6.4-linux-amd64.tar.gz", "pandoc.tar.gz")
    };

    // Try multiple download sources in order
    let urls: Vec<String> = vec![
        format!("https://github.com/jgm/pandoc/releases/download/3.6.4/{}", path_suffix),
        format!("https://ghproxy.com/https://github.com/jgm/pandoc/releases/download/3.6.4/{}", path_suffix),
        format!("https://mirror.ghproxy.com/https://github.com/jgm/pandoc/releases/download/3.6.4/{}", path_suffix),
    ];

    let archive = bin_dir.join(archive_name);
    let mut downloaded = false;

    for url in &urls {
        eprintln!("[pandoc] trying {}", url);
        match minreq::get(url).send() {
            Ok(resp) => {
                if let Err(e) = std::fs::write(&archive, resp.as_bytes()) {
                    eprintln!("[pandoc] write failed: {}", e);
                    continue;
                }
                downloaded = true;
                break;
            }
            Err(e) => {
                eprintln!("[pandoc] download failed: {}", e);
            }
        }
    }

    if !downloaded {
        return Err(format!(
            "无法下载 Pandoc。请手动下载并放到 {} 目录下：\n\n\
             1. 下载 {}\n\
             2. 解压后将 pandoc{} 复制到 {}\n\
             3. 重启 ResearchMate",
            bin_dir.display(),
            urls[0],
            if cfg!(target_os = "windows") { ".exe" } else { "" },
            target.display(),
        ));
    }

    // Extract
    let extract_ok = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(["-Command", &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force; Copy-Item '{}' '{}'",
                archive.display(), bin_dir.display(),
                bin_dir.join("pandoc-3.6.4/pandoc.exe").display(),
                target.display(),
            )])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        Command::new("tar")
            .args(["-xzf", archive.to_str().unwrap(), "-C", bin_dir.to_str().unwrap()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };

    if extract_ok {
        // On Linux, copy from the extracted subdirectory
        if !cfg!(target_os = "windows") {
            let src = bin_dir.join("pandoc-3.6.4/bin/pandoc");
            std::fs::copy(&src, &target).ok();
        }
    }

    // Clean up archive
    std::fs::remove_file(&archive).ok();

    if !extract_ok {
        if archive.exists() {
            return Err("解压 Pandoc 失败，请检查磁盘空间或手动下载 Pandoc。".into());
        }
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&target) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&target, perms).ok();
        }
    }

    if target.exists() {
        Ok(target)
    } else {
        Err("下载完成但找不到 Pandoc 二进制".into())
    }
}

/// Export markdown content to DOCX or PDF via Pandoc
#[tauri::command]
pub async fn export_document(
    app_handle: tauri::AppHandle,
    content: String,
    format: String,
    output_dir: State<'_, PathBuf>,
    project_id: String,
    output_path: Option<String>,
) -> Result<String, String> {
    let pandoc = pandoc_path(&output_dir);
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
        "docx" => { cmd.arg("--to=docx"); }
        "pdf" => {
            cmd.arg("--to=pdf");
            // Use xelatex if available (for CJK); fall back to default otherwise
            if which::which("xelatex").is_ok() {
                cmd.arg("--pdf-engine=xelatex");
            }
        }
        "html" => {
            cmd.arg("--to=html5");
            cmd.arg("--embed-resources");
        }
        _ => return Err(format!("不支持的导出格式：{}", format)),
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "未找到 Pandoc。首次运行时会自动下载（需要网络连接），请稍后重试。".to_string()
        } else {
            format!("Pandoc 执行失败：{}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 错误：{}", stderr));
    }

    std::fs::remove_file(&md_path).ok();
    Ok(output_path.to_string_lossy().to_string())
}

/// Preview markdown as HTML via Pandoc
#[tauri::command]
pub async fn preview_html(
    _app_handle: tauri::AppHandle,
    content: String,
    output_dir: State<'_, PathBuf>,
) -> Result<String, String> {
    let pandoc = pandoc_path(&output_dir);

    let mut cmd = Command::new(&pandoc);
    cmd.arg("--from=markdown+auto_identifiers+tex_math_dollars")
       .arg("--to=html5")
       .arg("--standalone")
       .arg("--embed-resources")
       .arg("--mathjax")
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

/// Generate advanced reference.docx via Python script (python-docx)
#[tauri::command]
pub async fn generate_template_advanced(
    _app_handle: tauri::AppHandle,
    output_dir: State<'_, PathBuf>,
    config: Option<serde_json::Value>,
) -> Result<String, String> {
    // Find the script: CWD (dev mode) → exe parent → CARGO_MANIFEST_DIR
    let candidates = [
        std::env::current_dir().unwrap_or_default().join("scripts/generate_template.py"),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("scripts/generate_template.py"))).unwrap_or_default(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts/generate_template.py"),
    ];
    let script = candidates.iter().find(|p| p.exists()).cloned()
        .unwrap_or_else(|| candidates[0].clone());
    let template_path = output_dir.join("template.docx");
    let config_str = config.map(|c| c.to_string()).unwrap_or_else(|| "{}".to_string());

    let output = Command::new("python3")
        .arg(&script)
        .arg(template_path.to_str().unwrap())
        .arg(&config_str)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "未找到 python3。请安装 Python 3 后重试。\n\nUbuntu/Debian: sudo apt install python3 python3-pip\nWindows: https://python.org/downloads/\n\n然后运行: pip install python-docx".to_string()
            } else {
                format!("执行失败：{}", e)
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let msg = format!("{}{}", stdout, stderr);
        if msg.contains("警告: 未安装 python-docx") {
            return Ok(format!("已生成基础模板（Python 环境下未安装 python-docx）:\n{}\n\n安装 python-docx 以启用高级自定义:\npip install python-docx", template_path.display()));
        }
        return Err(msg);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(stdout)
}

/// Generate default reference.docx template via Pandoc
#[tauri::command]
pub async fn generate_template(
    _app_handle: tauri::AppHandle,
    output_dir: State<'_, PathBuf>,
) -> Result<String, String> {
    let pandoc = pandoc_path(&output_dir);
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
