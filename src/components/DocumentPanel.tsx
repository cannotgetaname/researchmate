import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DocInfo {
  id: string; title: string | null; authors: string | null;
  year: number | null; journal: string | null; domain: string | null;
  filename: string; status: string; created_at: string;
}
interface SearchResult { document: DocInfo; score: number; snippet: string; }
interface KBInfo { id: string; name: string; doc_count: number; }

const btnS: React.CSSProperties = {
  height: "36px", padding: "0 var(--space-base)", border: "none",
  borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)",
  fontSize: "13px", fontWeight: 500, cursor: "pointer",
};
const inputS: React.CSSProperties = {
  flex: 1, height: "36px", padding: "0 var(--space-sm)",
  border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-ui)", fontSize: "13px", outline: "none",
};

export default function DocumentPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [kbs, setKbs] = useState<KBInfo[]>([]);
  const [selectedKbs, setSelectedKbs] = useState<string[]>([]);
  const [activeKbId, setActiveKbId] = useState("default");
  const [crossKbSearch, setCrossKbSearch] = useState(false);
  const [showKbSelector, setShowKbSelector] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [showNewKb, setShowNewKb] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  const loadDocs = async () => {
    try { setDocs(await invoke("get_documents", { projectId, kbId: crossKbSearch ? null : activeKbId }) as DocInfo[]); } catch {}
  };
  const loadKbs = async () => {
    try {
      const list = await invoke("list_knowledge_bases") as KBInfo[];
      setKbs(list);
      if (list.length > 0 && selectedKbs.length === 0) setSelectedKbs(list.map((k) => k.id));
      if (!list.find(k => k.id === activeKbId)) { setActiveKbId(list[0]?.id ?? "default"); }
    } catch {}
  };
  useEffect(() => { loadDocs(); loadKbs(); }, []);
  useEffect(() => { loadDocs(); }, [activeKbId, crossKbSearch]);

  const toggleKb = (id: string) => {
    setSelectedKbs((prev) => prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]);
  };
  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    try {
      await invoke("create_knowledge_base", { name: newKbName.trim() });
      setNewKbName(""); setShowNewKb(false);
      await loadKbs();
    } catch (e) { alert(`创建失败：${e}`); }
  };

  const handleUpload = async () => {
    const selected = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    setUploading(true);
    const log: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const name = files[i].split("/").pop()!;
      log.push(`[${i + 1}/${files.length}] ${name} — 处理中...`);
      setUploadLog([...log]);
      try {
        await invoke("upload_document", { filePath: files[i], projectId });
        log[i] = `[${i + 1}/${files.length}] ${name} — ✓ 完成`;
      } catch (e) {
        log[i] = `[${i + 1}/${files.length}] ${name} — ✗ 失败：${e}`;
      }
      setUploadLog([...log]);
    }
    setUploading(false);
    await loadDocs();
    await loadKbs();
    // Auto-clear log after 5 seconds
    setTimeout(() => setUploadLog([]), 5000);
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_document", { docId: id });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setResults((prev) => prev?.filter((r) => r.document.id !== id) ?? null);
    } catch {}
  };

  const handleSearch = async () => {
    const q = query.trim(); if (!q || searching) return;
    setSearching(true);
    try {
      const r = await invoke("search_knowledge", { query: q, projectId }) as SearchResult[];
      setResults(r);
    } catch {}
    setSearching(false);
  };

  const handleAsk = async () => {
    const q = question.trim(); if (!q || asking || docs.length === 0) return;
    setAsking(true); setAnswer("");
    let streamed = false;
    const unlisten = await listen<{ delta: string }>("polish-stream", (event) => {
      streamed = true;
      setAnswer((prev) => prev + event.payload.delta);
    });
    try {
      const result = await invoke<string>("ask_knowledge", { question: q, projectId, kbIds: crossKbSearch ? selectedKbs : [activeKbId] });
      if (!streamed) setAnswer(result);
    } catch (e) {
      setAnswer((prev) => prev + `\n\n> 错误：${e}`);
    }
    setAsking(false); unlisten(); setQuestion("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-base)" }}>
      {/* Upload + KB selector row */}
      <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
        <button onClick={handleUpload} disabled={uploading}
          style={{ ...btnS, backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", flex: 1, opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "上传中..." : "+ 上传 PDF"}
        </button>
        <div style={{ position: "relative", flex: 1 }}>
          <div onClick={() => setShowKbSelector(!showKbSelector)}
            style={{ ...btnS, backgroundColor: "var(--color-surface-card)", color: "var(--color-ink)", border: "1px solid var(--color-hairline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px" }}>
              {kbs.find(k => k.id === activeKbId)?.name ?? "选择知识库"}
            </span>
            <span style={{ marginLeft: "4px" }}>{showKbSelector ? "▲" : "▼"}</span>
          </div>
          {showKbSelector && (
            <>
              <div onClick={() => setShowKbSelector(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, marginTop: 2,
              backgroundColor: "var(--color-surface-card)", border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-sm)", padding: "var(--space-xs)", maxHeight: "200px", overflowY: "auto" }}>
              {kbs.map((kb) => (
                <div key={kb.id} onClick={() => { setActiveKbId(kb.id); setShowKbSelector(false); }}
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", padding: "4px var(--space-sm)", fontSize: "12px", cursor: "pointer", color: activeKbId === kb.id ? "var(--color-primary)" : "var(--color-ink)", fontWeight: activeKbId === kb.id ? 600 : 400 }}>
                  {activeKbId === kb.id ? "●" : "○"} {kb.name} ({kb.doc_count}篇)
                </div>
              ))}
              <div onClick={() => { setShowNewKb(true); setShowKbSelector(false); }}
                style={{ padding: "6px var(--space-sm)", fontSize: "12px", color: "var(--color-primary)", cursor: "pointer", borderTop: "1px solid var(--color-hairline)", marginTop: "4px" }}>
                + 新建知识库
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {/* Upload log (separate, collapsible) */}
      {uploadLog.length > 0 && (
        <div style={{ fontSize: "11px", marginBottom: "var(--space-sm)", maxHeight: "100px", overflowY: "auto",
          backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-sm)",
          padding: "var(--space-xs) var(--space-sm)", fontFamily: "var(--font-code)", lineHeight: 1.8 }}>
          {uploadLog.map((line, i) => (
            <div key={i} style={{ color: line.includes("失败") ? "var(--color-error)" : line.includes("✓") ? "var(--color-success)" : "var(--color-muted)" }}>{line}</div>
          ))}
          <div onClick={() => setUploadLog([])} style={{ textAlign: "right", color: "var(--color-muted-soft)", cursor: "pointer", marginTop: "2px" }}>清除</div>
        </div>
      )}

      {/* Cross-KB toggle */}
      {kbs.length > 1 && (
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", fontSize: "11px", color: "var(--color-muted)", marginBottom: "var(--space-sm)", cursor: "pointer" }}>
          <input type="checkbox" checked={crossKbSearch} onChange={(e) => setCrossKbSearch(e.target.checked)} />
          跨库搜索
        </label>
      )}
      {crossKbSearch && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
          {kbs.map((kb) => (
            <label key={kb.id} style={{ fontSize: "11px", cursor: "pointer", padding: "2px 8px", borderRadius: "var(--radius-pill)", border: `1px solid ${selectedKbs.includes(kb.id) ? "var(--color-primary)" : "var(--color-hairline)"}`, color: selectedKbs.includes(kb.id) ? "var(--color-primary)" : "var(--color-muted)" }}>
              <input type="checkbox" checked={selectedKbs.includes(kb.id)} onChange={() => toggleKb(kb.id)} style={{ display: "none" }} />
              {kb.name}
            </label>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
        <input ref={useRef<HTMLInputElement>(null)} type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜索文献..." disabled={docs.length === 0} style={inputS} />
        <button onClick={handleSearch} disabled={searching || !query.trim()}
          style={{ ...btnS, backgroundColor: "var(--color-ink)", color: "var(--color-canvas)", opacity: searching ? 0.6 : 1 }}>
          {searching ? "..." : "搜索"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {results !== null ? (results.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xl)", fontSize: "13px" }}>无匹配结果</div>
        ) : results.map((r) => (
          <div key={r.document.id} style={{ padding: "var(--space-sm)", marginBottom: "var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-surface-card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.document.title ?? r.document.filename}</div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginTop: "2px" }}>
                  {r.document.authors && (() => { try { return JSON.parse(r.document.authors).slice(0, 2).map((x: {name: string}) => x.name).join(", "); } catch { return r.document.authors; } })()}
                  {r.document.year && ` (${r.document.year})`}{r.document.journal && ` — ${r.document.journal}`}
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", lineHeight: 1.5, marginTop: "4px" }}>{r.snippet}</div>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-pill)", backgroundColor: r.score > 0.5 ? "var(--color-canvas-soft)" : "var(--color-hairline-soft)", color: r.score > 0.5 ? "var(--color-success)" : "var(--color-muted)" }}>{(r.score * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))) : docs.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xxl)", fontSize: "13px" }}>上传 PDF 开始构建你的知识库</div>
        ) : (
          docs.map((doc) => (
            <div key={doc.id} style={{ padding: "var(--space-sm)", marginBottom: "var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-surface-card)", cursor: "default", transition: "border-color 0.1s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline-strong)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline)"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title ?? doc.filename}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    {doc.authors && (() => { try { return JSON.parse(doc.authors).slice(0, 2).map((x: {name: string}) => x.name).join(", "); } catch { return doc.authors; } })()}
                    {doc.year && ` (${doc.year})`}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "2px", fontSize: "11px", color: "var(--color-muted-soft)" }}>
                    {doc.journal && <span>{doc.journal}</span>}
                    {doc.domain && <span style={{ padding: "0 6px", borderRadius: "var(--radius-pill)", backgroundColor: "var(--color-canvas-soft)" }}>{doc.domain}</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(doc.id)} style={{ background: "none", border: "none", color: "var(--color-muted-soft)", cursor: "pointer", fontSize: "16px", padding: "0 4px", lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Q&A */}
      {docs.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
          {answer && (
            <div style={{ marginBottom: "var(--space-sm)", padding: "var(--space-sm) var(--space-base)", backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-hairline)", maxHeight: "300px", overflowY: "auto" }}>
              <div className="markdown-body" style={{ fontSize: "13px" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-xs)" }}>
            <input type="text" value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder="向知识库提问..." disabled={asking} style={inputS} />
            <button onClick={handleAsk} disabled={asking || !question.trim()}
              style={{ ...btnS, backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", opacity: asking ? 0.6 : 1 }}>
              {asking ? "..." : "提问"}
            </button>
          </div>
        </div>
      )}

      {/* New KB Dialog */}
      {showNewKb && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => { setShowNewKb(false); setNewKbName(""); }}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", width: "360px", border: "1px solid var(--color-hairline)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>新建知识库</h3>
            <input type="text" value={newKbName} placeholder="知识库名称" autoFocus
              onChange={(e) => setNewKbName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateKb()}
              style={{ width: "100%", height: "40px", padding: "0 var(--space-base)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "14px", outline: "none", marginBottom: "var(--space-base)" }} />
            <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="topnav-btn" onClick={() => { setShowNewKb(false); setNewKbName(""); }}>取消</button>
              <button onClick={handleCreateKb}
                style={{ height: "36px", padding: "0 18px", border: "none", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
