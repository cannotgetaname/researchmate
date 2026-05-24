import { useState, useEffect } from "react";
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
const sectionH: React.CSSProperties = {
  fontSize: "13px", fontWeight: 600, color: "var(--color-ink)",
  cursor: "pointer", padding: "var(--space-sm) 0",
  borderBottom: "1px solid var(--color-hairline)", marginBottom: "var(--space-sm)",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};

export default function DocumentPanel({ projectId }: { projectId: string }) {
  const [kbDocs, setKbDocs] = useState<DocInfo[]>([]);
  const [kbs, setKbs] = useState<KBInfo[]>([]);
  const [activeKbId, setActiveKbId] = useState("default");
  const [searchKbIds, setSearchKbIds] = useState<string[]>([]);
  const [showNewKb, setShowNewKb] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState<"kb" | "docs" | null>("docs");
  const [structureDoc, setStructureDoc] = useState<DocInfo | null>(null);
  const [structureNodes, setStructureNodes] = useState<{id:string;parent_id:string|null;tag:string;heading:string;role:string|null;summary:string|null;ordering:number}[] | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [citations, setCitations] = useState<{id:string;key:string;title:string|null;raw:string|null}[] | null>(null);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [citationsError, setCitationsError] = useState<string | null>(null);

  const handleExtractCitationsDoi = async (doc: DocInfo) => {
    setStructureDoc(doc);
    setStructureNodes(null);
    setCitations(null);
    setCitationsError(null);
    setCitationsLoading(true);
    try {
      const entries = await invoke<{id:string;key:string;title:string|null;raw:string|null}[]>("extract_citations_doi", { documentId: doc.id });
      setCitations(entries);
    } catch (e) {
      setCitationsError(String(e));
    }
    setCitationsLoading(false);
  };

  const handleExtractCitationsAi = async (doc: DocInfo) => {
    setStructureDoc(doc);
    setStructureNodes(null);
    setCitations(null);
    setCitationsError(null);
    setCitationsLoading(true);
    try {
      const entries = await invoke<{id:string;key:string;title:string|null;raw:string|null}[]>("extract_citations_ai", { documentId: doc.id });
      setCitations(entries);
    } catch (e) {
      setCitationsError(String(e));
    }
    setCitationsLoading(false);
  };

  // ── Load KB docs (always by active KB) ──
  const loadKbDocs = async () => {
    try {
      let result = await invoke("get_documents", { projectId, kbIds: [activeKbId] }) as DocInfo[];
      result.sort((a, b) => (a.title ?? a.filename).localeCompare(b.title ?? b.filename, "zh"));
      setKbDocs(result);
    } catch {}
  };
  const loadKbs = async () => {
    try {
      const list = await invoke("list_knowledge_bases") as KBInfo[];
      setKbs(list);
      if (!list.find(k => k.id === activeKbId)) setActiveKbId(list[0]?.id ?? "default");
    } catch {}
  };
  useEffect(() => { loadKbDocs(); loadKbs(); }, []);
  useEffect(() => { setSearchKbIds([activeKbId]); }, [activeKbId]);
  useEffect(() => { loadKbDocs(); }, [activeKbId, projectId]);

  const [deleteKbTarget, setDeleteKbTarget] = useState<{id: string, name: string} | null>(null);
  const [deleteKbConfirm, setDeleteKbConfirm] = useState("");

  const handleDeleteKb = async (id: string, name: string) => {
    if (deleteKbTarget?.id === id) {
      if (deleteKbConfirm !== name) return;
      try {
        await invoke("delete_knowledge_base", { kbId: id });
        setDeleteKbTarget(null); setDeleteKbConfirm("");
        await loadKbs();
        if (activeKbId === id) setActiveKbId("default");
      } catch (err) { alert(`删除失败：${err}`); }
    } else {
      setDeleteKbTarget({ id, name }); setDeleteKbConfirm("");
    }
  };

  const handleAnalyzeStructureAi = async (doc: DocInfo) => {
    setStructureDoc(doc);
    setStructureNodes(null);
    setCitations(null);
    setStructureError(null);
    setStructureLoading(true);
    try {
      const nodes = await invoke<{id:string;parent_id:string|null;tag:string;heading:string;role:string|null;summary:string|null;ordering:number}[]>("extract_paper_structure_ai", { documentId: doc.id });
      setStructureNodes(nodes);
    } catch (e) {
      setStructureError(String(e));
    }
    setStructureLoading(false);
  };

  const handleExtractCitations = async (doc: DocInfo) => {
    setStructureDoc(doc);
    setStructureNodes(null);
    setCitations(null);
    setCitationsError(null);
    setCitationsLoading(true);
    try {
      const entries = await invoke<{id:string;key:string;title:string|null;raw:string|null}[]>("extract_citations", { documentId: doc.id });
      setCitations(entries);
    } catch (e) {
      setCitationsError(String(e));
    }
    setCitationsLoading(false);
  };

  const toggleSearchKb = (id: string) => {
    setSearchKbIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((k) => k !== id);
        return next.length === 0 ? [activeKbId] : next;
      }
      return [...prev, id];
    });
  };

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    try {
      const id = await invoke<string>("create_knowledge_base", { name: newKbName.trim() });
      setNewKbName(""); setShowNewKb(false);
      await loadKbs();
      setActiveKbId(id);
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
        await invoke("upload_document", { filePath: files[i], projectId, kbId: activeKbId });
        log[i] = `[${i + 1}/${files.length}] ${name} — ✓ 完成`;
      } catch (e) {
        log[i] = `[${i + 1}/${files.length}] ${name} — ✗ 失败：${e}`;
      }
      setUploadLog([...log]);
    }
    setUploading(false);
    await loadKbDocs(); await loadKbs();
    setTimeout(() => { setUploadLog([]); setExpanded("docs"); }, 5000);
  };

  const handleAnalyzeStructure = async (doc: DocInfo, force?: boolean) => {
    setStructureDoc(doc);
    setStructureNodes(null);
    setStructureError(null);
    setStructureLoading(true);
    try {
      const nodes = await invoke<{id:string;parent_id:string|null;tag:string;heading:string;role:string|null;summary:string|null;ordering:number}[]>("extract_paper_structure", { documentId: doc.id, projectId, force: force ?? false });
      setStructureNodes(nodes);
    } catch (e) {
      setStructureError(String(e));
    }
    setStructureLoading(false);
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await invoke("delete_document", { docId: id });
      setKbDocs((prev) => prev.filter((d) => d.id !== id));
      setResults((prev) => prev?.filter((r) => r.document.id !== id) ?? null);
      await loadKbs();
    } catch {}
  };

  const handleSearch = async () => {
    const q = query.trim(); if (!q || searching) return;
    setSearching(true);
    try { setResults(await invoke("search_knowledge", { query: q, projectId, kbIds: searchKbIds }) as SearchResult[]); } catch {}
    setSearching(false);
  };

  const handleAsk = async () => {
    const q = question.trim(); if (!q || asking) return;
    setAsking(true); setAnswer(""); setReasoning("");
    let currentStage = "thinking";

    const unlisten1 = await listen<{ delta: string }>("polish-stream", (event) => {
      if (currentStage === "thinking") {
        setReasoning((prev) => prev + event.payload.delta);
      } else {
        setAnswer((prev) => prev + event.payload.delta);
      }
    });
    const unlisten2 = await listen<{ stage: string }>("polish-stage", (event) => {
      if (event.payload.stage === "editing") currentStage = "editing";
    });
    try {
      await invoke<string>("ask_knowledge", { question: q, projectId, kbIds: searchKbIds });
    } catch (e) { setAnswer((prev) => prev + `\n\n> 错误：${e}`); }
    setAsking(false); unlisten1(); unlisten2(); setQuestion("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-base)" }}>
      {/* ── Knowledge Base Section ── */}
      <div onClick={() => setExpanded(expanded === "kb" ? null : "kb")} style={sectionH}>
        <span>知识库管理 · {kbs.find(k => k.id === activeKbId)?.name ?? ""}</span>
        <span>{expanded === "kb" ? "▲" : "▶"}</span>
      </div>
      {expanded === "kb" && (
        <div style={{ marginBottom: "var(--space-sm)" }}>
          {/* KB select + new */}
          <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
            <select value={activeKbId} onChange={(e) => setActiveKbId(e.target.value)}
              style={{ flex: 1, height: "36px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)",
                borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "13px",
                backgroundColor: "var(--color-surface-card)", cursor: "pointer", outline: "none" }}>
              {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name} ({kb.doc_count}篇)</option>)}
            </select>
            <button onClick={() => setShowNewKb(true)} style={{ ...btnS, backgroundColor: "var(--color-canvas-soft)", color: "var(--color-ink)", border: "1px solid var(--color-hairline)" }}>+ 新建</button>
          </div>
          {/* KB list with doc counts + delete */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}>
            {kbs.map((kb) => (
              <div key={kb.id} onClick={() => { setActiveKbId(kb.id); setDeleteKbTarget(null); }}
                style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", cursor: "pointer",
                  padding: "4px 10px", borderRadius: "var(--radius-pill)",
                  border: `1px solid ${activeKbId === kb.id ? "var(--color-primary)" : "var(--color-hairline)"}`,
                  backgroundColor: activeKbId === kb.id ? "var(--color-canvas-soft)" : "transparent",
                  color: activeKbId === kb.id ? "var(--color-primary)" : "var(--color-muted)",
                  fontWeight: activeKbId === kb.id ? 600 : 400 }}>
                {kb.name} ({kb.doc_count})
                {kb.id !== "default" && (
                  <span onClick={(e) => { e.stopPropagation(); handleDeleteKb(kb.id, kb.name); }}
                    style={{ color: "var(--color-muted-soft)", fontSize: "12px", lineHeight: 1, padding: "0 2px", opacity: 0.5 }}
                    title="删除知识库">×</span>
                )}
              </div>
            ))}
          </div>

          {/* Delete KB confirmation */}
          {deleteKbTarget && (
            <div style={{ marginTop: "var(--space-sm)", padding: "var(--space-sm)", border: "1px solid var(--color-error)", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-surface-card)" }}>
              <div style={{ fontSize: "12px", color: "var(--color-error)", marginBottom: "var(--space-xs)" }}>
                删除 <b>{deleteKbTarget.name}</b>？文献保留在总知识库中，不会丢失。请输入知识库名称确认：
              </div>
              <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                <input type="text" value={deleteKbConfirm} placeholder={deleteKbTarget.name}
                  onChange={(e) => setDeleteKbConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDeleteKb(deleteKbTarget.id, deleteKbTarget.name)}
                  autoFocus
                  style={{ flex: 1, height: "32px", fontSize: "12px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", outline: "none", fontFamily: "var(--font-ui)" }} />
                <button onClick={() => handleDeleteKb(deleteKbTarget.id, deleteKbTarget.name)}
                  style={{ height: "32px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-error)", color: "#fff", fontSize: "12px", cursor: deleteKbConfirm !== deleteKbTarget.name ? "not-allowed" : "pointer", opacity: deleteKbConfirm !== deleteKbTarget.name ? 0.5 : 1 }}>
                  确认删除
                </button>
                <button onClick={() => { setDeleteKbTarget(null); setDeleteKbConfirm(""); }}
                  style={{ height: "32px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "12px", cursor: "pointer" }}>取消</button>
              </div>
            </div>
          )}

          <button onClick={handleUpload} disabled={uploading}
            style={{ ...btnS, backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", width: "100%", marginTop: "var(--space-sm)", opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "上传中..." : "+ 上传 PDF 到当前知识库"}
          </button>

          {/* Upload log */}
          {uploadLog.length > 0 && (
            <div style={{ fontSize: "11px", marginTop: "var(--space-sm)", maxHeight: "100px", overflowY: "auto",
              backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-sm)",
              padding: "var(--space-xs) var(--space-sm)", fontFamily: "var(--font-code)", lineHeight: 1.8 }}>
              {uploadLog.map((line, i) => (
                <div key={i} style={{ color: line.includes("失败") ? "var(--color-error)" : line.includes("✓") ? "var(--color-success)" : "var(--color-muted)" }}>{line}</div>
              ))}
              <div onClick={() => setUploadLog([])} style={{ textAlign: "right", color: "var(--color-muted-soft)", cursor: "pointer", marginTop: "2px" }}>清除</div>
            </div>
          )}

          {/* ── Document list (moved from search section) ── */}
          <div style={{ marginTop: "var(--space-sm)", maxHeight: uploadLog.length > 0 ? "120px" : "300px", overflowY: "auto", minHeight: 0 }}>
            {kbDocs.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--color-muted)", padding: "var(--space-lg) 0", fontSize: "13px" }}>当前知识库暂无文献</div>
            ) : (
              kbDocs.map((doc) => (
                <div key={doc.id} style={{ padding: "var(--space-sm)", marginBottom: "var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-surface-card)" }}
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
                    <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                      <button onClick={() => handleAnalyzeStructure(doc)} title="查看结构"
                        style={{ background: "none", border: "none", color: "var(--color-muted-soft)", cursor: "pointer", fontSize: "13px", padding: "0 4px", lineHeight: 1 }}>📊</button>
                      <button onClick={() => handleExtractCitations(doc)} title="提取引用"
                        style={{ background: "none", border: "none", color: "var(--color-muted-soft)", cursor: "pointer", fontSize: "13px", padding: "0 4px", lineHeight: 1 }}>📎</button>
                      <button onClick={() => handleDeleteDoc(doc.id)} title="删除文献"
                        style={{ background: "none", border: "none", color: "var(--color-muted-soft)", cursor: "pointer", fontSize: "16px", padding: "0 4px", lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Search & Q&A Section ── */}
      <div onClick={() => setExpanded(expanded === "docs" ? null : "docs")} style={sectionH}>
        <span>检索与问答</span>
        <span>{expanded === "docs" ? "▲" : "▶"}</span>
      </div>
      {expanded === "docs" && (
        <>
          {/* Search scope: KB pills (multi-select) */}
          {kbs.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
              {kbs.map((kb) => (
                <div key={kb.id} onClick={() => toggleSearchKb(kb.id)}
                  style={{ fontSize: "11px", cursor: "pointer", padding: "2px 8px", borderRadius: "var(--radius-pill)",
                    border: `1px solid ${searchKbIds.includes(kb.id) ? "var(--color-primary)" : "var(--color-hairline)"}`,
                    backgroundColor: searchKbIds.includes(kb.id) ? "var(--color-canvas-soft)" : "transparent",
                    color: searchKbIds.includes(kb.id) ? "var(--color-primary)" : "var(--color-muted)" }}>
                  {kb.name}
                </div>
              ))}
            </div>
          )}

          {/* Search */}
          <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="搜索文献..." style={inputS} />
            <button onClick={handleSearch} disabled={searching || !query.trim()}
              style={{ ...btnS, backgroundColor: "var(--color-ink)", color: "var(--color-canvas)", opacity: searching ? 0.6 : 1 }}>
              {searching ? "..." : "搜索"}
            </button>
          </div>

          {/* Search results */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {results !== null ? (results.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xl)", fontSize: "13px" }}>无匹配结果</div>
            ) : (
              results.map((r) => (
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
              ))
            )) : (
              <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-base)", fontSize: "13px" }}>
                输入关键词搜索文献，或直接向知识库提问
              </div>
            )}
          </div>

          {/* Q&A */}
          <div style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
            {(answer || reasoning) && (
              <div style={{ marginBottom: "var(--space-sm)", padding: "var(--space-sm) var(--space-base)", backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-md)", border: "1px solid var(--color-hairline)", maxHeight: "300px", overflowY: "auto" }}>
                {reasoning && (
                  <details style={{ marginBottom: "var(--space-sm)" }}>
                    <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--color-muted)" }}>
                      思考过程
                    </summary>
                    <div style={{ marginTop: "var(--space-xs)", padding: "var(--space-sm)", backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-md)", fontSize: "12px", color: "var(--color-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {reasoning}
                    </div>
                  </details>
                )}
                <div className="markdown-body" style={{ fontSize: "13px" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-xs)" }}>
              <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                placeholder="向知识库提问..." disabled={asking} style={inputS} />
              <button onClick={handleAsk} disabled={asking || !question.trim()}
                style={{ ...btnS, backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", opacity: asking ? 0.6 : 1 }}>
                {asking ? "..." : "提问"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Paper Detail Modal (Structure + Citations) */}
      {structureDoc && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(2px)" }}
          onClick={() => { setStructureDoc(null); setStructureNodes(null); setCitations(null); setStructureError(null); setCitationsError(null); }}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", width: "clamp(420px, 50vw, 640px)", maxHeight: "78vh", display: "flex", flexDirection: "column", border: "1px solid var(--color-hairline)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)", flexShrink: 0 }}>
              <h3 style={{ fontSize: "15px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {structureDoc.title ?? structureDoc.filename}
              </h3>
              <button onClick={() => { setStructureDoc(null); setStructureNodes(null); setCitations(null); setStructureError(null); setCitationsError(null); }}
                style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: "18px", cursor: "pointer", lineHeight: 1, flexShrink: 0, marginLeft: "8px" }}>×</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-base)", borderBottom: "1px solid var(--color-hairline)", flexShrink: 0 }}>
              {[
                ["📊", "结构", () => handleAnalyzeStructure(structureDoc!)],
                ["📎", "引用", () => handleExtractCitations(structureDoc!)],
              ].map(([icon, label, action]) => {
                const isActive = (label === "结构" && structureNodes !== null) || (label === "引用" && citations !== null);
                return (
                  <div key={label as string} onClick={action as () => void}
                    style={{
                      padding: "6px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                      borderBottom: `2px solid ${isActive ? "var(--color-primary)" : "transparent"}`,
                      color: isActive ? "var(--color-ink)" : "var(--color-muted)",
                      transition: "all 0.15s",
                    }}>
                    {icon as string} {label as string}
                  </div>
                );
              })}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {structureLoading || citationsLoading ? (
                <div style={{ textAlign: "center", padding: "var(--space-xxl)", color: "var(--color-muted)" }}>
                  <span className="timeline-pill thinking">分析中</span>
                </div>
              ) : structureError ? (
                <div style={{ textAlign: "center", padding: "var(--space-xxl)" }}>
                  <div style={{ color: "var(--color-error)", fontSize: "13px", marginBottom: "8px" }}>分析失败</div>
                  <div style={{ color: "var(--color-muted)", fontSize: "11px", fontFamily: "var(--font-code)", whiteSpace: "pre-wrap", marginBottom: "12px" }}>{structureError}</div>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                    <button onClick={() => handleAnalyzeStructure(structureDoc!, true)}
                      style={{ height: "28px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                      🔄 正则重试
                    </button>
                    <button onClick={() => handleAnalyzeStructureAi(structureDoc!)}
                      style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                      🤖 AI 分析
                    </button>
                  </div>
                </div>
              ) : citationsError ? (
                <div style={{ textAlign: "center", padding: "var(--space-xxl)" }}>
                  <div style={{ color: "var(--color-error)", fontSize: "13px", marginBottom: "8px" }}>提取失败</div>
                  <div style={{ color: "var(--color-muted)", fontSize: "11px", fontFamily: "var(--font-code)", whiteSpace: "pre-wrap", marginBottom: "12px" }}>{citationsError}</div>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                    <button onClick={() => handleExtractCitations(structureDoc!)}
                      style={{ height: "28px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                      🔄 正则重试
                    </button>
                    <button onClick={() => handleExtractCitationsDoi(structureDoc!)}
                      style={{ height: "28px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                      📡 DOI 查询
                    </button>
                    <button onClick={() => handleExtractCitationsAi(structureDoc!)}
                      style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                      🤖 AI 提取
                    </button>
                  </div>
                </div>
              ) : structureNodes ? (
                structureNodes.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "var(--space-xxl)" }}>
                    <div style={{ color: "var(--color-muted)", fontSize: "13px", marginBottom: "8px" }}>未识别到章节结构</div>
                    <div style={{ color: "var(--color-muted-soft)", fontSize: "11px", marginBottom: "12px" }}>正则匹配无法解析此论文格式</div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button onClick={() => handleAnalyzeStructure(structureDoc!, true)}
                        style={{ height: "28px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        🔄 正则重试
                      </button>
                      <button onClick={() => handleAnalyzeStructureAi(structureDoc!)}
                        style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        🤖 AI 分析
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <StructureTree nodes={structureNodes} />
                    <div style={{ marginTop: "var(--space-base)", display: "flex", gap: "8px" }}>
                      <button onClick={() => handleAnalyzeStructure(structureDoc!, true)}
                        style={{ height: "28px", padding: "0 10px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        🔄 正则重分析
                      </button>
                      <button onClick={() => handleAnalyzeStructureAi(structureDoc!)}
                        style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        🤖 AI 分析
                      </button>
                    </div>
                  </div>
                )
              ) : citations ? (
                citations.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "var(--space-xxl)" }}>
                    <div style={{ color: "var(--color-muted)", fontSize: "13px", marginBottom: "8px" }}>未找到参考文献</div>
                    <div style={{ color: "var(--color-muted-soft)", fontSize: "11px", marginBottom: "12px" }}>正则匹配无法识别此论文的引用格式</div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
                      <button onClick={() => handleExtractCitationsDoi(structureDoc!)}
                        style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-success)", color: "#fff", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        📡 DOI 查询
                      </button>
                      <button onClick={() => handleExtractCitationsAi(structureDoc!)}
                        style={{ height: "28px", padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "11px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        🤖 AI 提取
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)", gap: "4px" }}>
                      <div style={{ fontSize: "12px", color: "var(--color-muted)", padding: "4px 8px", background: "var(--color-canvas-soft)", borderRadius: "var(--radius-sm)" }}>
                        📚 找到 {citations.length} 条引用
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button onClick={() => handleExtractCitationsDoi(structureDoc!)}
                          style={{ height: "24px", padding: "0 8px", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", background: "var(--color-canvas-soft)", color: "var(--color-muted)", fontSize: "10px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                          📡 DOI
                        </button>
                        <button onClick={() => handleExtractCitationsAi(structureDoc!)}
                          style={{ height: "24px", padding: "0 8px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "10px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                          🤖 AI
                        </button>
                      </div>
                    </div>
                    {citations.map((c, i) => (
                      <div key={c.id} style={{ padding: "8px 0", borderBottom: i < citations.length - 1 ? "1px solid var(--color-hairline-soft)" : "none", fontSize: "12px", lineHeight: 1.65 }}>
                        <div style={{ fontWeight: 700, color: "var(--color-primary)", marginBottom: "1px", fontSize: "11px" }}>
                          [{i + 1}] {c.key}
                        </div>
                        {c.title && <div style={{ color: "var(--color-body)", marginBottom: "2px" }}>{c.title}</div>}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div style={{ textAlign: "center", padding: "var(--space-xxl)", color: "var(--color-muted)" }}>
                  <div style={{ fontSize: "13px", marginBottom: "4px" }}>点击上方标签页开始分析</div>
                  <div style={{ fontSize: "11px", color: "var(--color-muted-soft)" }}>📊 章节结构 · 📎 参考文献</div>
                </div>
              )}
            </div>
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
              <button onClick={handleCreateKb} style={{ height: "36px", padding: "0 18px", border: "none", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface StructureNode {
  id: string; parent_id: string | null; tag: string;
  heading: string; role: string | null; summary: string | null; ordering: number;
}

function StructureTree({ nodes }: { nodes: StructureNode[] }) {
  const roleColor: Record<string, string> = {
    background: "#9fbbe0", literature: "#c0a8dd", method: "#9b59b6",
    experiment: "#dfa88f", result: "#17a2b8", discussion: "#3c9d6e",
    conclusion: "#d4a017", appendix: "#807d72",
    claim: "#4a90d9", evidence: "#3c9d6e", hypothesis: "#d4a017", gap: "#e07b39",
  };
  const roleLabel: Record<string, string> = {
    background: "背景", literature: "相关工作", method: "方法",
    experiment: "实验", result: "结果", discussion: "讨论",
    conclusion: "结论", appendix: "附录",
  };

  // Group by parent
  const childrenMap: Record<string, StructureNode[]> = {};
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    if (!childrenMap[key]) childrenMap[key] = [];
    childrenMap[key].push(n);
  }

  const rootChildren = childrenMap["__root__"] || [];

  return (
    <div style={{ fontSize: "13px", lineHeight: 1.8 }}>
      {rootChildren.map((node) => (
        <TreeNode key={node.id} node={node} childrenMap={childrenMap} roleColor={roleColor} roleLabel={roleLabel} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({ node, childrenMap, roleColor, roleLabel, depth }: {
  node: StructureNode; childrenMap: Record<string, StructureNode[]>; roleColor: Record<string, string>; roleLabel: Record<string, string>; depth: number;
}) {
  const [open, setOpen] = useState(true);
  const childNodes = childrenMap[node.id] || [];
  const hasChildren = childNodes.length > 0;
  const indent = depth * 20;

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: "4px",
        padding: "2px 0", marginLeft: indent,
        cursor: hasChildren ? "pointer" : "default",
        color: "var(--color-ink)",
      }} onClick={() => hasChildren && setOpen(!open)}>
        {hasChildren && <span style={{ fontSize: "10px", width: "12px", flexShrink: 0, color: "var(--color-muted)" }}>{open ? "▼" : "▶"}</span>}
        {!hasChildren && <span style={{ width: "12px", flexShrink: 0 }} />}
        <span style={{
          fontWeight: depth === 0 ? 600 : 400,
          fontSize: depth === 0 ? "13px" : depth === 1 ? "12px" : "11px",
        }} title={node.summary ?? undefined}>
          {node.heading}
        </span>
        {node.role && (
          <span style={{
            fontSize: "9px", fontWeight: 600, padding: "0 5px", borderRadius: "var(--radius-pill)",
            backgroundColor: (roleColor[node.role] || "#999") + "22",
            color: roleColor[node.role] || "#999",
          }}>
            {roleLabel[node.role] || node.role}
          </span>
        )}
        {node.summary && (
          <span style={{ fontSize: "10px", color: "var(--color-muted-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.summary}
          </span>
        )}
      </div>
      {open && hasChildren && childNodes.map((child) => (
        <TreeNode key={child.id} node={child} childrenMap={childrenMap} roleColor={roleColor} roleLabel={roleLabel} depth={depth + 1} />
      ))}
    </div>
  );
}