use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;

/// Initialize a git repository in the project directory (idempotent)
#[tauri::command]
pub async fn git_init(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    std::fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

    let repo = match git2::Repository::open(&project_dir) {
        Ok(r) => {
            // Already initialized
            drop(r);
            return Ok("版本管理已就绪".to_string());
        }
        Err(_) => git2::Repository::init(&project_dir).map_err(|e| e.to_string())?,
    };

    // Set user config for commits
    let mut cfg = repo.config().map_err(|e| e.to_string())?;
    cfg.set_str("user.name", "ResearchMate").ok();
    cfg.set_str("user.email", "researchmate@local").ok();

    // Create .gitignore
    std::fs::write(project_dir.join(".gitignore"), "exports/\n").ok();

    Ok("版本管理已初始化".to_string())
}

/// Save a version: stage draft.md and commit
#[tauri::command]
pub async fn save_version(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    message: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let _draft_path = project_dir.join("draft.md");

    let repo = git2::Repository::open(&project_dir).map_err(|e| format!("仓库未初始化：{}", e))?;

    // Stage draft.md
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(std::path::Path::new("draft.md")).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    // Get or create parent commit
    let parent_commit = match repo.head() {
        Ok(head) => head.peel_to_commit().ok(),
        Err(_) => None,
    };

    let parents: Vec<&git2::Commit<'_>> = parent_commit.iter().collect();
    let sig = git2::Signature::now("ResearchMate", "researchmate@local")
        .map_err(|e| e.to_string())?;

    let commit_id = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &parents,
        )
        .map_err(|e| e.to_string())?;

    let _commit = repo.find_commit(commit_id).map_err(|e| e.to_string())?;
    let short_hash = &commit_id.to_string()[..7];

    Ok(format!("已保存版本 {}", short_hash))
}

/// List recent versions
#[tauri::command]
pub async fn list_versions(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = match git2::Repository::open(&project_dir) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let mut versions = Vec::new();
    for oid in revwalk.take(30) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let time = commit.time().seconds();
        let dt = chrono::DateTime::from_timestamp(time, 0)
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();

        versions.push(serde_json::json!({
            "hash": oid.to_string(),
            "short_hash": &oid.to_string()[..7],
            "message": commit.message().unwrap_or("").to_string(),
            "time": dt,
        }));
    }

    Ok(versions)
}

/// Get draft content at a specific version (read-only)
#[tauri::command]
pub async fn get_version(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    hash: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let oid = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let entry = tree
        .get_path(std::path::Path::new("draft.md"))
        .map_err(|_| "该版本中没有草稿文件".to_string())?;

    let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

/// Delete a version by dropping its commit from git history
#[tauri::command]
pub async fn delete_version(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    hash: String,
) -> Result<String, String> {
    use std::process::Command;

    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let oid = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;

    let (parent_oid_str, is_head) = {
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        if commit.parent_count() == 0 {
            return Err("不能删除初始版本".to_string());
        }
        let parent_oid = commit.parent(0).map_err(|e| e.to_string())?.id().to_string();
        let is_head = repo.head()
            .ok()
            .and_then(|h| h.target())
            .map(|t| t == oid)
            .unwrap_or(false);
        drop(commit);
        (parent_oid, is_head)
    };

    drop(repo); // Release git2 lock before running external git

    if is_head {
        // HEAD commit: simple reset
        let output = Command::new("git")
            .args(["-C", project_dir.to_str().unwrap()])
            .args(["reset", "--hard", &parent_oid_str])
            .output()
            .map_err(|e| format!("git 执行失败：{}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git 错误：{}", stderr));
        }
    } else {
        // Non-HEAD: rebase to drop the commit
        let output = Command::new("git")
            .args(["-C", project_dir.to_str().unwrap()])
            .args(["rebase", "--onto", &parent_oid_str, &hash])
            .output()
            .map_err(|e| format!("git 执行失败（需要系统安装 Git）：{}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Try to abort a failed rebase
            let _ = Command::new("git")
                .args(["-C", project_dir.to_str().unwrap()])
                .args(["rebase", "--abort"])
                .output();
            return Err(format!("删除失败：{}", stderr));
        }
    }

    Ok("已删除版本".to_string())
}

// ── Branch management ──

/// List all branches
#[tauri::command]
pub async fn list_branches(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = match git2::Repository::open(&project_dir) {
        Ok(r) => r,
        Err(_) => return Ok(vec![]),
    };

    let mut branches = Vec::new();
    for branch in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?.unwrap_or("unknown").to_string();
        let is_head = branch.is_head();
        branches.push(serde_json::json!({
            "name": name,
            "is_head": is_head,
        }));
    }
    Ok(branches)
}

/// Create a new branch from current HEAD and switch to it
#[tauri::command]
pub async fn create_branch(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    name: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let commit = head.peel_to_commit().map_err(|e| e.to_string())?;

    repo.branch(&name, &commit, false)
        .map_err(|e| format!("创建分支失败：{}", e))?;

    // Switch to new branch
    let (object, reference) = repo.revparse_ext(&name).map_err(|e| e.to_string())?;
    repo.checkout_tree(&object, None).map_err(|e| e.to_string())?;

    if let Some(gref) = reference {
        repo.set_head(gref.name().unwrap()).map_err(|e| e.to_string())?;
    } else {
        repo.set_head(&format!("refs/heads/{}", name)).map_err(|e| e.to_string())?;
    }

    // Reload draft from new branch HEAD
    let draft = {
        let head = repo.head().ok();
        match head.and_then(|h| h.peel_to_tree().ok()) {
            Some(tree) => {
                tree.get_path(std::path::Path::new("draft.md"))
                    .ok()
                    .and_then(|e| repo.find_blob(e.id()).ok())
                    .map(|b| String::from_utf8_lossy(b.content()).to_string())
            }
            None => None,
        }
    };

    Ok(draft.unwrap_or_default())
}

/// Switch to an existing branch and return its draft content
#[tauri::command]
pub async fn switch_branch(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    name: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let (object, reference) = repo.revparse_ext(&name).map_err(|e| format!("分支不存在：{}", e))?;
    repo.checkout_tree(&object, None).map_err(|e| e.to_string())?;

    if let Some(gref) = reference {
        repo.set_head(gref.name().unwrap()).map_err(|e| e.to_string())?;
    } else {
        repo.set_head(&format!("refs/heads/{}", name)).map_err(|e| e.to_string())?;
    }

    // Return draft content from new HEAD
    let draft = {
        let head = repo.head().ok();
        match head.and_then(|h| h.peel_to_tree().ok()) {
            Some(tree) => {
                tree.get_path(std::path::Path::new("draft.md"))
                    .ok()
                    .and_then(|e| repo.find_blob(e.id()).ok())
                    .map(|b| String::from_utf8_lossy(b.content()).to_string())
            }
            None => None,
        }
    };

    Ok(draft.unwrap_or_default())
}

/// Delete a branch (cannot delete current branch)
#[tauri::command]
pub async fn delete_branch(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    name: String,
) -> Result<String, String> {
    if name == "main" || name == "master" {
        return Err("不能删除主分支".to_string());
    }
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let mut branch = repo.find_branch(&name, git2::BranchType::Local)
        .map_err(|e| format!("分支不存在：{}", e))?;
    branch.delete().map_err(|e| format!("删除分支失败：{}", e))?;
    Ok(format!("已删除分支 {}", name))
}

// ── Diff ──

/// Get unified diff between two versions (or between a version and current)
#[tauri::command]
pub async fn diff_versions(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    hash_a: String,
    hash_b: Option<String>,  // None = compare with current draft on disk
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let oid_a = git2::Oid::from_str(&hash_a).map_err(|e| e.to_string())?;
    let commit_a = repo.find_commit(oid_a).map_err(|e| e.to_string())?;
    let tree_a = commit_a.tree().map_err(|e| e.to_string())?;

    let blob_a = tree_a
        .get_path(std::path::Path::new("draft.md"))
        .map_err(|_| "版本A中没有草稿文件".to_string())?;
    let content_a = repo.find_blob(blob_a.id()).map_err(|e| e.to_string())?;

    let (content_b, label_b): (String, String) = if let Some(hash) = hash_b {
        let oid_b = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;
        let commit_b = repo.find_commit(oid_b).map_err(|e| e.to_string())?;
        let tree_b = commit_b.tree().map_err(|e| e.to_string())?;
        let blob_b = tree_b
            .get_path(std::path::Path::new("draft.md"))
            .map_err(|_| "版本B中没有草稿文件".to_string())?;
        let b = String::from_utf8_lossy(
            repo.find_blob(blob_b.id()).map_err(|e| e.to_string())?.content()
        ).to_string();
        (b, hash[..7].to_string())
    } else {
        let draft_path = project_dir.join("draft.md");
        (std::fs::read_to_string(&draft_path).unwrap_or_default(), "当前".to_string())
    };

    // Simple line diff
    let text_a = String::from_utf8_lossy(content_a.content()).to_string();
    let lines_a: Vec<&str> = text_a.lines().collect();
    let lines_b: Vec<&str> = content_b.lines().collect();

    let mut result = format!("--- {}\n+++ {}\n\n", &hash_a[..7], label_b);

    // Very basic LCS-based diff for readability
    let mut i = 0usize;
    let mut j = 0usize;
    while i < lines_a.len() || j < lines_b.len() {
        if i < lines_a.len() && j < lines_b.len() && lines_a[i] == lines_b[j] {
            result.push_str(&format!("  {}\n", lines_a[i]));
            i += 1; j += 1;
        } else if j < lines_b.len() && (i >= lines_a.len() || !lines_a[i..].contains(&lines_b[j])) {
            result.push_str(&format!("+ {}\n", lines_b[j]));
            j += 1;
        } else if i < lines_a.len() {
            result.push_str(&format!("- {}\n", lines_a[i]));
            i += 1;
        } else {
            j += 1;
        }

        if result.lines().count() > 500 {
            result.push_str("\n... (diff 过长，已截断)");
            break;
        }
    }

    Ok(result)
}

// ── Version tags (via git notes) ──

/// Set a tag on a version (e.g. "初稿", "投稿版")
#[tauri::command]
pub async fn set_version_tag(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    hash: String,
    tag: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let oid = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;
    let sig = git2::Signature::now("ResearchMate", "researchmate@local")
        .map_err(|e| e.to_string())?;

    // Use git notes to attach tag to commit
    repo.note(&sig, &sig, None, oid, &tag, true)
        .map_err(|e| format!("设置标签失败：{}", e))?;

    Ok("已设置标签".to_string())
}

/// Get all version tags as a map of hash → tag
#[tauri::command]
pub async fn get_version_tags(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<HashMap<String, String>, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = match git2::Repository::open(&project_dir) {
        Ok(r) => r,
        Err(_) => return Ok(HashMap::new()),
    };

    let mut tags_map = HashMap::new();
    // Iterate through git notes
    if let Ok(notes_ref) = repo.find_reference("refs/notes/commits") {
        if let Ok(notes_obj) = notes_ref.peel_to_tree() {
            for entry in notes_obj.iter() {
                if let Some(name) = entry.name() {
                    let hash = name.to_string();
                    if let Ok(blob) = repo.find_blob(entry.id()) {
                        let tag = String::from_utf8_lossy(blob.content()).to_string();
                        tags_map.insert(hash, tag);
                    }
                }
            }
        }
    }
    Ok(tags_map)
}

/// Remove a tag from a version
#[tauri::command]
pub async fn remove_version_tag(
    output_dir: State<'_, PathBuf>,
    project_id: String,
    hash: String,
) -> Result<String, String> {
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = git2::Repository::open(&project_dir).map_err(|e| e.to_string())?;

    let oid = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;
    let sig = git2::Signature::now("ResearchMate", "researchmate@local")
        .map_err(|e| e.to_string())?;

    // Remove note by writing empty note (force=true allows removing)
    repo.note(&sig, &sig, None, oid, "", true)
        .map_err(|e| format!("移除标签失败：{}", e))?;

    Ok("已移除标签".to_string())
}

// ── Auto snapshot ──

/// Trigger an auto-snapshot (called periodically from frontend)
#[tauri::command]
pub async fn auto_snapshot(
    output_dir: State<'_, PathBuf>,
    project_id: String,
) -> Result<String, String> {
    // Only save if there are actual changes
    let project_dir = output_dir.join("projects").join(&project_id);
    let repo = match git2::Repository::open(&project_dir) {
        Ok(r) => r,
        Err(_) => return Ok("跳过（未初始化）".to_string()),
    };

    let draft_path = project_dir.join("draft.md");
    if !draft_path.exists() {
        return Ok("跳过（无草稿）".to_string());
    }

    // Check if draft has changed since last commit
    let changed = {
        let head = repo.head().ok()
            .and_then(|h| h.peel_to_tree().ok());
        match head {
            Some(tree) => {
                match tree.get_path(std::path::Path::new("draft.md")) {
                    Ok(entry) => {
                        let old_blob = repo.find_blob(entry.id()).ok();
                        let new_content = std::fs::read_to_string(&draft_path).unwrap_or_default();
                        match old_blob {
                            Some(blob) => blob.content() != new_content.as_bytes(),
                            None => !new_content.is_empty(),
                        }
                    }
                    Err(_) => true, // draft.md not in git yet
                }
            }
            None => true,
        }
    };

    if !changed {
        return Ok("跳过（无变更）".to_string());
    }

    // Save as version with auto prefix
    let ts = chrono::Utc::now().format("%m-%d %H:%M").to_string();
    let message = format!("[自动] {}", ts);

    // Inline the save logic (reuse save_version logic but without needing State separately)
    let _draft_path = draft_path;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(std::path::Path::new("draft.md")).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit<'_>> = parent_commit.iter().collect();
    let sig = git2::Signature::now("ResearchMate", "researchmate@local")
        .map_err(|e| e.to_string())?;

    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| format!("自动快照失败：{}", e))?;

    Ok("已自动快照".to_string())
}
