import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DocInfo {
  id: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  journal: string | null;
  domain: string | null;
  filename: string;
  status: string;
  created_at: string;
}

interface SearchResult {
  document: DocInfo;
  score: number;
  snippet: string;
}

interface KBInfo { id: string; name: string; doc_count: number; }

export default function DocumentPanel({ projectId }: { projectId: string }) {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [kbs, setKbs] = useState<KBInfo[]>([]);
  const [selectedKbs, setSelectedKbs] = useState<string[]>([]);
  const [showKbSelector, setShowKbSelector] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocs = async () => {
    try {
      const result = await invoke("get_documents", { projectId: projectId }) as DocInfo[];
      setDocs(result);
    } catch (e) {
      setStatus(`加载文献列表失败：${e}`);
    }
  };

  useEffect(() => { loadDocs(); loadKbs(); }, []);

  const loadKbs = async () => {
    try {
      const list = await invoke("list_knowledge_bases") as KBInfo[];
      setKbs(list);
      if (list.length > 0 && selectedKbs.length === 0) {
        setSelectedKbs(list.map((k) => k.id));
      }
    } catch {}
  };

  const toggleKb = (id: string) => {
    setSelectedKbs((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  };

  const handleUpload = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;

    const files = Array.isArray(selected) ? selected : [selected];
    setUploading(true);
    setUploadLog([]);

    const log: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const name = files[i].split("/").pop()!;
      log.push(`[${i + 1}/${files.length}] ${name} — 处理中...`);
      setUploadLog([...log]);
      try {
        await invoke("upload_document", { filePath: files[i], projectId: projectId });
        log[i] = `[${i + 1}/${files.length}] ${name} — ✓ 完成（${i + 1}/${files.length}）`;
      } catch (e) {
        log[i] = `[${i + 1}/${files.length}] ${name} — ✗ 失败：${e}`;
      }
      setUploadLog([...log]);
    }

    setUploading(false);
    await loadDocs();
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_document", { docId: id });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setResults((prev) => prev?.filter((r) => r.document.id !== id) ?? null);
      setStatus("已删除");
    } catch (e) {
      setStatus(`删除失败：${e}`);
    }
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setStatus("");
    try {
      const r = await invoke("search_knowledge", { query: q, projectId: projectId }) as SearchResult[];
      setResults(r);
      if (r.length === 0) setStatus("未找到相关文献");
    } catch (e) {
      setStatus(`搜索失败：${e}`);
    }
    setSearching(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || asking || docs.length === 0) return;
    setAsking(true);
    setAnswer("");

    let streamed = false;
    const unlisten = await listen<{ delta: string }>("polish-stream", (event) => {
      streamed = true;
      setAnswer((prev) => prev + event.payload.delta);
    });

    try {
      const result = await invoke<string>("ask_knowledge", { question: q, projectId, kbIds: selectedKbs });
      if (!streamed) {
        // count/list queries return directly without streaming
        setAnswer(result);
      }
    } catch (e) {
      setAnswer((prev) => prev + `\n\n> 错误：${e}`);
    }

    setAsking(false);
    unlisten();
    setQuestion("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--space-base)" }}>
      {/* Upload */}
      <button
        onClick={handleUpload} disabled={uploading}
        style={{
          height: "36px", padding: "0 var(--space-base)", marginBottom: "var(--space-sm)",
          border: "none", borderRadius: "var(--radius-md)",
          backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)",
          fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500,
          cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.6 : 1,
          width: "100%",
        }}
      >
        {uploading ? "上传中..." : "+ 上传 PDF 文献"}
      </button>

      {/* Search */}
      <div style={{ display: "flex", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
        <input
          ref={inputRef} type="text" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="搜索文献（按 Enter 检索）..."
          disabled={docs.length === 0}
          style={{
            flex: 1, height: "36px", padding: "0 var(--space-sm)",
            border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-ui)", fontSize: "13px", outline: "none",
          }}
        />
        <button
          onClick={handleSearch} disabled={searching || !query.trim()}
          style={{
            height: "36px", padding: "0 var(--space-base)",
            border: "none", borderRadius: "var(--radius-md)",
            backgroundColor: "var(--color-ink)", color: "var(--color-canvas)",
            fontFamily: "var(--font-ui)", fontSize: "13px", fontWeight: 500,
            cursor: "pointer", opacity: searching ? 0.6 : 1,
          }}
        >
          {searching ? "..." : "搜索"}
        </button>
      </div>

      {(uploadLog.length > 0 || status) && (
        <div style={{ fontSize: "11px", color: "var(--color-muted)", marginBottom: "var(--space-sm)", maxHeight: "120px", overflowY: "auto", backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-sm)", padding: "var(--space-xs) var(--space-sm)", fontFamily: "var(--font-code)", lineHeight: 1.8 }}>
          {uploadLog.map((line, i) => (
            <div key={i} style={{ color: line.includes("失败") ? "var(--color-error)" : line.includes("✓") ? "var(--color-success)" : "var(--color-muted)" }}>{line}</div>
          ))}
          {/* KB selector */}
      <div style={{ marginBottom: "var(--space-sm)", position: "relative" }}>
        <div
          onClick={() => setShowKbSelector(!showKbSelector)}
          style={{
            fontSize: "12px", color: "var(--color-muted)", cursor: "pointer",
            padding: "4px var(--space-sm)", border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-sm)", display: "flex", justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            知识库：{selectedKbs.length === kbs.length ? "全部" : selectedKbs.length === 0 ? "无" : `${selectedKbs.length} 个已选`}
          </span>
          <span>{showKbSelector ? "▲" : "▼"}</span>
        </div>
        {showKbSelector && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
            backgroundColor: "var(--color-surface-card)", border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-sm)", padding: "var(--space-xs)", marginTop: "2px",
            maxHeight: "160px", overflowY: "auto",
          }}>
            {kbs.map((kb) => (
              <label key={kb.id} style={{
                display: "flex", alignItems: "center", gap: "var(--space-xs)",
                padding: "4px var(--space-sm)", fontSize: "12px", cursor: "pointer",
                color: "var(--color-ink)",
              }}>
                <input type="checkbox" checked={selectedKbs.includes(kb.id)} onChange={() => toggleKb(kb.id)} />
                {kb.name} ({kb.doc_count}篇)
              </label>
            ))}
          </div>
        )}
      </div>

      {status && !uploadLog.length && <div>{status}</div>}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Search results */}
        {results !== null ? (
          results.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xl)", fontSize: "13px" }}>
              无匹配结果
            </div>
          ) : (
            results.map((r) => (
              <div
                key={r.document.id}
                style={{
                  padding: "var(--space-sm)", marginBottom: "var(--space-sm)",
                  border: "1px solid var(--color-hairline)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-surface-card)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 600, fontSize: "14px", color: "var(--color-ink)",
                      marginBottom: "var(--space-xxs)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.document.title ?? r.document.filename}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "var(--space-xxs)" }}>
                      {r.document.authors && (() => {
                        try { return JSON.parse(r.document.authors).slice(0, 2).map((x: {name: string}) => x.name).join(", "); }
                        catch { return r.document.authors; }
                      })()}
                      {r.document.year && ` (${r.document.year})`}
                      {r.document.journal && ` — ${r.document.journal}`}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--color-muted)", lineHeight: 1.5 }}>
                      {r.snippet}
                    </div>
                  </div>
                  <span style={{
                    fontSize: "11px", fontWeight: 600, flexShrink: 0, marginLeft: "var(--space-sm)",
                    padding: "2px 8px", borderRadius: "var(--radius-pill)",
                    backgroundColor: r.score > 0.5 ? "var(--color-canvas-soft)" : "var(--color-hairline-soft)",
                    color: r.score > 0.5 ? "var(--color-success)" : "var(--color-muted)",
                  }}>
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))
          )
        ) : docs.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xxl)", fontSize: "13px" }}>
            还没有上传文献
          </div>
        ) : (
          docs.map((doc) => (
            <div
              key={doc.id}
              style={{
                padding: "var(--space-sm)", marginBottom: "var(--space-sm)",
                border: "1px solid var(--color-hairline)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--color-surface-card)",
                cursor: projectId, transition: "border-color 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline-strong)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--color-hairline)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-ink)", marginBottom: "var(--space-xxs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {doc.title ?? doc.filename}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                    {doc.authors && (() => {
                      try { return JSON.parse(doc.authors).slice(0, 2).map((x: {name: string}) => x.name).join(", "); }
                      catch { return doc.authors; }
                    })()}
                    {doc.year && ` (${doc.year})`}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-xxs)", fontSize: "11px", color: "var(--color-muted-soft)" }}>
                    {doc.journal && <span>{doc.journal}</span>}
                    {doc.domain && <span style={{ padding: "0 6px", borderRadius: "var(--radius-pill)", backgroundColor: "var(--color-canvas-soft)" }}>{doc.domain}</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(doc.id)} style={{ background: "none", border: "none", color: "var(--color-muted-soft)", cursor: "pointer", fontSize: "16px", padding: "0 4px", lineHeight: 1, flexShrink: 0 }} title="删除">
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Q&A Section */}
      {docs.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
          {/* Answer display */}
          {answer && (
            <div style={{
              marginBottom: "var(--space-sm)", padding: "var(--space-sm) var(--space-base)",
              backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-hairline)", maxHeight: "200px", overflowY: "auto",
            }}>
              <div className="markdown-body" style={{ fontSize: "13px" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Question input */}
          <div style={{ display: "flex", gap: "var(--space-xs)" }}>
            <input
              type="text" value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder="向知识库提问，如：这篇论文用的什么方法？"
              disabled={asking}
              style={{
                flex: 1, height: "36px", padding: "0 var(--space-sm)",
                border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-ui)", fontSize: "13px", outline: "none",
              }}
            />
            <button
              onClick={handleAsk} disabled={asking || !question.trim()}
              style={{
                height: "36px", padding: "0 var(--space-base)",
                border: "none", borderRadius: "var(--radius-md)",
                backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)",
                fontFamily: "var(--font-ui)", fontSize: "13px", fontWeight: 500,
                cursor: asking ? "not-allowed" : "pointer", opacity: asking ? 0.6 : 1,
              }}
            >
              {asking ? "..." : "提问"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
