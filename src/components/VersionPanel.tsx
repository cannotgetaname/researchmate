import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Version {
  hash: string;
  short_hash: string;
  message: string;
  time: string;
}

interface BranchInfo {
  name: string;
  is_head: boolean;
}

interface VersionPanelProps {
  projectId: string;
  onRestore: (content: string) => void;
  onBackToLatest: () => void;
}

const sectionH: React.CSSProperties = {
  fontSize: "13px", fontWeight: 600, color: "var(--color-ink)",
  cursor: "pointer", padding: "var(--space-sm) 0",
  borderBottom: "1px solid var(--color-hairline)", marginBottom: "var(--space-sm)",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};

const pill: React.CSSProperties = {
  fontSize: "10px", fontWeight: 600, padding: "1px 6px",
  borderRadius: "var(--radius-pill)", display: "inline-block",
};

export default function VersionPanel({ projectId, onRestore, onBackToLatest }: VersionPanelProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranch, setActiveBranch] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [viewingHash, setViewingHash] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [editTagHash, setEditTagHash] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [diffA, setDiffA] = useState<string | null>(null);
  const [diffB, setDiffB] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const loadVersions = async () => {
    try {
      const list = await invoke<Version[]>("list_versions", { projectId });
      setVersions(list);
    } catch { setVersions([]); }
  };

  const loadBranches = async () => {
    try {
      const list = await invoke<BranchInfo[]>("list_branches", { projectId });
      setBranches(list);
      const head = list.find(b => b.is_head);
      if (head) setActiveBranch(head.name);
    } catch {}
  };

  const loadTags = async () => {
    try {
      const map = await invoke<Record<string, string>>("get_version_tags", { projectId });
      setTags(map);
    } catch { setTags({}); }
  };

  useEffect(() => {
    invoke("git_init", { projectId }).then(() => {
      loadVersions(); loadBranches(); loadTags();
    });
  }, [projectId]);



  const handleSaveVersion = async () => {
    if (!msg.trim()) return;
    setSaving(true);
    try {
      await invoke("save_version", { projectId, message: msg.trim() });
      setMsg("");
      await loadVersions();
    } catch (e) { alert(`保存版本失败：${e}`); }
    setSaving(false);
  };

  const handleRestore = async (hash: string) => {
    try {
      const oldContent = await invoke<string>("get_version", { projectId, hash });
      onRestore(oldContent);
      setViewingHash(hash);
      await loadVersions();
    } catch (e) { alert(`读取版本失败：${e}`); }
  };

  const handleDelete = async (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("删除此版本？")) return;
    try {
      await invoke("delete_version", { projectId, hash });
      if (viewingHash === hash) setViewingHash(null);
      await loadVersions();
    } catch (err) { alert(`删除失败：${err}`); }
  };

  const handleExportVersion = async (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const content = await invoke<string>("get_version", { projectId, hash });
      const path = await invoke<string>("export_document", { content, format: "docx", projectId });
      alert(`已导出：${path}`);
    } catch (err) { alert(`导出失败：${err}`); }
  };

  // ── Tags ──
  const handleSetTag = async () => {
    if (!editTagHash || !tagInput.trim()) return;
    try {
      await invoke("set_version_tag", { projectId, hash: editTagHash, tag: tagInput.trim() });
      setEditTagHash(null);
      setTagInput("");
      await loadTags();
    } catch (e) { alert(`设置标签失败：${e}`); }
  };

  const handleRemoveTag = async (hash: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_version_tag", { projectId, hash });
      await loadTags();
    } catch (e) { alert(`移除标签失败：${e}`); }
  };

  // ── Diff ──
  const handleDiffSelect = useCallback(async (hash: string) => {
    if (!diffA) {
      setDiffA(hash);
    } else if (hash === diffA) {
      setDiffA(null); setDiffText(null);
    } else {
      setDiffB(hash);
      try {
        const text = await invoke<string>("diff_versions", { projectId, hashA: diffA, hashB: hash });
        setDiffText(text);
      } catch (e) { alert(`Diff 失败：${e}`); }
    }
  }, [diffA, projectId]);

  const clearDiff = () => { setDiffA(null); setDiffB(null); setDiffText(null); };

  // ── Branch ──
  const handleSwitchBranch = async (name: string) => {
    try {
      const content = await invoke<string>("switch_branch", { projectId, name });
      onRestore(content);
      setActiveBranch(name);
      setViewingHash(null);
      await loadVersions(); await loadTags();
    } catch (e) { alert(`切换分支失败：${e}`); }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      const content = await invoke<string>("create_branch", { projectId, name: newBranchName.trim() });
      onRestore(content);
      setNewBranchName("");
      setShowNewBranch(false);
      await loadBranches(); await loadVersions();
      setActiveBranch(newBranchName.trim());
    } catch (e) { alert(`创建分支失败：${e}`); }
  };

  const handleDeleteBranch = async (name: string) => {
    if (!confirm(`删除分支 ${name}？`)) return;
    try {
      await invoke("delete_branch", { projectId, name });
      await loadBranches();
    } catch (e) { alert(`删除分支失败：${e}`); }
  };

  return (
    <div style={{ padding: "var(--space-base)", display: "flex", flexDirection: "column", height: "100%" }}>
      <div onClick={() => setExpanded((p) => !p)} style={sectionH}>
        <span>版本管理</span>
        <span>{expanded ? "▲" : "▶"}</span>
      </div>

      {expanded && (
        <>
          {/* ── Branch selector ── */}
          <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)", alignItems: "center" }}>
            <select value={activeBranch} onChange={(e) => handleSwitchBranch(e.target.value)}
              style={{
                flex: 1, height: "30px", padding: "0 var(--space-sm)",
                border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-ui)", fontSize: "12px",
                backgroundColor: "var(--color-surface-card)", cursor: "pointer", outline: "none",
              }}>
              {branches.map(b => (
                <option key={b.name} value={b.name}>{b.name}{b.is_head ? " *" : ""}</option>
              ))}
            </select>
            <button onClick={() => setShowNewBranch(true)}
              style={{ height: "30px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", backgroundColor: "transparent", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              +分支
            </button>
            {activeBranch !== "main" && activeBranch !== "master" && (
              <button onClick={() => handleDeleteBranch(activeBranch)}
                style={{ height: "30px", padding: "0 8px", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "transparent", color: "var(--color-error)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                删除
              </button>
            )}
          </div>

          {/* New branch dialog */}
          {showNewBranch && (
            <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
              <input type="text" value={newBranchName} placeholder="分支名称"
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
                autoFocus
                style={{ flex: 1, height: "28px", padding: "0 var(--space-sm)", border: "1px solid var(--color-primary)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "12px", outline: "none" }} />
              <button onClick={handleCreateBranch}
                style={{ height: "28px", padding: "0 10px", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-primary)", color: "#fff", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                确认
              </button>
              <button onClick={() => { setShowNewBranch(false); setNewBranchName(""); }}
                style={{ height: "28px", padding: "0 8px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", backgroundColor: "transparent", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                取消
              </button>
            </div>
          )}

          {/* Viewing history banner */}
          {viewingHash && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "var(--space-xs) var(--space-sm)", marginBottom: "var(--space-sm)",
              backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-hairline)", fontSize: "12px",
            }}>
              <span style={{ color: "var(--color-muted)" }}>
                正在查看 <span style={{ fontFamily: "var(--font-code)", color: "var(--color-primary)" }}>{viewingHash.slice(0, 7)}</span>
              </span>
              <button onClick={() => { setViewingHash(null); onBackToLatest(); }}
                style={{ background: "none", border: "1px solid var(--color-primary)", borderRadius: "var(--radius-sm)", padding: "2px 10px", color: "var(--color-primary)", fontSize: "11px", fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                回到最新
              </button>
            </div>
          )}

          {/* Diff bar */}
          {diffA && (
            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-xs)",
              padding: "4px var(--space-sm)", marginBottom: "var(--space-sm)",
              backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-hairline)", fontSize: "11px",
            }}>
              <span style={{ fontFamily: "var(--font-code)", color: "var(--color-ink)" }}>{diffA.slice(0, 7)}</span>
              <span style={{ color: "var(--color-muted)" }}>{diffB ? "vs" : "→ 点另一个版本对比"}</span>
              {diffB && <span style={{ fontFamily: "var(--font-code)", color: "var(--color-ink)" }}>{diffB.slice(0, 7)}</span>}
              <div style={{ flex: 1 }} />
              <button onClick={clearDiff}
                style={{ background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: "14px", padding: "0 4px" }}>
                ×
              </button>
            </div>
          )}

          {/* Diff result */}
          {diffText && (
            <div style={{
              maxHeight: "200px", overflowY: "auto", marginBottom: "var(--space-sm)",
              padding: "var(--space-sm)", backgroundColor: "#fafafa",
              border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-code)", fontSize: "11px", lineHeight: 1.6,
            }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                <code>{diffText}</code>
              </pre>
            </div>
          )}

          {/* Save new version */}
          <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
            <input type="text" value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveVersion()}
              placeholder="版本说明..."
              style={{ flex: 1, height: "32px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "12px", outline: "none" }} />
            <button onClick={handleSaveVersion} disabled={saving || !msg.trim()}
              style={{ height: "32px", padding: "0 var(--space-sm)", border: "none", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "12px", fontWeight: 500, cursor: "pointer", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", opacity: saving || !msg.trim() ? 0.5 : 1 }}>
              {saving ? "..." : "保存"}
            </button>
          </div>

          {/* Version list */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {versions.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-lg)", fontSize: "12px" }}>暂无版本</div>
            ) : (
              versions.map((v) => (
                <div key={v.hash}
                  style={{
                    padding: "var(--space-sm)", marginBottom: "var(--space-xs)",
                    border: `1px solid ${v.hash === viewingHash ? "var(--color-primary)" : diffA === v.hash ? "var(--color-ink)" : "var(--color-hairline)"}`,
                    borderRadius: "var(--radius-md)",
                    backgroundColor: v.hash === viewingHash ? "var(--color-canvas-soft)" : "var(--color-surface-card)",
                    cursor: "pointer", position: "relative",
                  }}
                >
                  {/* Click for restore, right-click for diff */}
                  <div onClick={() => handleRestore(v.hash)} onContextMenu={(e) => { e.preventDefault(); handleDiffSelect(v.hash); }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", paddingRight: "200px" }}>
                      {/* Tag pill */}
                      {tags[v.hash] && (
                        <span style={{ ...pill, backgroundColor: "var(--color-timeline-read)", color: "var(--color-ink)", cursor: "pointer" }}
                          onClick={(e) => { e.stopPropagation(); handleRemoveTag(v.hash, e); }}
                          title="点击移除标签">
                          {tags[v.hash]}
                        </span>
                      )}
                      <span style={{ fontSize: "12px", fontWeight: 600, color: v.message.startsWith("[自动]") ? "var(--color-muted)" : "var(--color-ink)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.message || "(无说明)"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px" }}>
                      <span style={{ fontSize: "11px", color: "var(--color-muted-soft)", fontFamily: "var(--font-code)" }}>{v.short_hash}</span>
                      <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>{v.time}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ position: "absolute", top: "4px", right: "4px", display: "flex", gap: "4px" }}>
                    {/* Tag */}
                    <button onClick={(e) => { e.stopPropagation(); setEditTagHash(v.hash); setTagInput(tags[v.hash] || ""); }}
                      style={{ background: "none", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", color: "var(--color-muted)", fontSize: "12px", cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-ui)", lineHeight: 1 }}
                      title="设置标签">🏷 标签</button>
                    {/* Export */}
                    <button onClick={(e) => handleExportVersion(v.hash, e)}
                      style={{ background: "none", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", color: "var(--color-muted)", fontSize: "12px", cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-ui)", lineHeight: 1 }}
                      title="导出 DOCX">📥 导出</button>
                    {/* Delete */}
                    <button onClick={(e) => handleDelete(v.hash, e)}
                      style={{ background: "none", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", color: "var(--color-muted)", fontSize: "12px", cursor: "pointer", padding: "2px 8px", fontFamily: "var(--font-ui)", lineHeight: 1 }}
                      title="删除版本">× 删除</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Tag edit inline */}
          {editTagHash && (
            <div style={{
              display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-sm)",
              padding: "var(--space-sm)", border: "1px solid var(--color-primary)",
              borderRadius: "var(--radius-md)", backgroundColor: "var(--color-canvas-soft)",
            }}>
              <input type="text" value={tagInput} placeholder="标签（初稿/投稿版/终版...）"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetTag()}
                autoFocus
                style={{ flex: 1, height: "28px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "12px", outline: "none" }} />
              <button onClick={handleSetTag}
                style={{ height: "28px", padding: "0 10px", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-primary)", color: "#fff", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                确定
              </button>
              <button onClick={() => setEditTagHash(null)}
                style={{ height: "28px", padding: "0 8px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", backgroundColor: "transparent", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                取消
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
