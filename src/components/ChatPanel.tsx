import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStreamChat } from "../hooks/useStreamChat";

interface Session {
  id: string;
  project_id: string;
  module: string;
  title: string | null;
  created_at: string;
}

interface CitationSuggestion {
  document_id: string;
  title: string;
  key: string;
  relevance: number;
  snippet: string;
}

interface ChatPanelProps {
  activeModule: string;
  onModuleChange: (module: string) => void;
  fillText: string;
  onFillConsumed: () => void;
  projectId: string;
  onInsertCitation?: (text: string) => void;
}

const MODULES = [
  { key: "write", label: "写作" },
  { key: "data", label: "数据" },
  { key: "lit", label: "文献" },
  { key: "plan", label: "管理" },
  { key: "version", label: "版本" },
];

export default function ChatPanel({
  activeModule, onModuleChange, fillText, onFillConsumed, projectId, onInsertCitation,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [kbs, setKbs] = useState<{id: string; name: string}[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each session has its own chat state
  const { messages, sendMessage, sendKnowledgeQuery, isLoading, aiStage } = useStreamChat();

  const stageClass = aiStage === "editing" ? "editing" : aiStage === "done" ? "done" : "thinking";
  const stageLabel = aiStage === "editing" ? "写作中" : aiStage === "done" ? "完成" : "思考中";

  // Load KBs
  const loadKbs = async () => {
    try {
      const list = await invoke<{id: string; name: string; doc_count: number}[]>("list_knowledge_bases");
      setKbs(list);
    } catch {}
  };
  useEffect(() => { loadKbs(); }, []);

  // Load sessions for this project+module
  const loadSessions = useCallback(async () => {
    if (sessions.length === 0) {
      try {
        const s = await invoke<Session>("create_session", { projectId, module: activeModule });
        setSessions([s]);
        setActiveSessionId(s.id);
      } catch {}
    }
  }, [projectId, activeModule, sessions.length]);

  useEffect(() => { loadSessions(); }, [projectId, activeModule]);

  // Load session KBs when switching sessions
  useEffect(() => {
    if (!activeSessionId) return;
    (async () => {
      try {
        const ids = await invoke<string[]>("get_session_kbs", { sessionId: activeSessionId });
        setSelectedKbIds(ids);
      } catch { setSelectedKbIds([]); }
    })();
  }, [activeSessionId]);

  // Toggle KB selection for this session
  const toggleKb = async (id: string) => {
    const next = selectedKbIds.includes(id)
      ? selectedKbIds.filter((k) => k !== id)
      : [...selectedKbIds, id];
    setSelectedKbIds(next);
    if (activeSessionId) {
      try { await invoke("set_session_kbs", { sessionId: activeSessionId, kbIds: next }); } catch {}
    }
  };

  const handleNewSession = async () => {
    try {
      const s = await invoke<Session>("create_session", { projectId, module: activeModule });
      setSessions((prev) => [...prev, s]);
      setActiveSessionId(s.id);
    } catch (e) { alert(`创建会话失败：${e}`); }
  };

  const handleDeleteSession = async (id: string) => {
    if (sessions.length <= 1) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining[0]?.id ?? null);
    }
  };

  // Citation suggestions (rendered as cards, separate from messages)
  const [citationResults, setCitationResults] = useState<CitationSuggestion[] | null>(null);

  // When editor sends text via right-click, auto-fill the input
  useEffect(() => {
    if (!fillText) return;
    // Detect citation check trigger
    if (fillText.startsWith("__CITE__")) {
      const citeText = fillText.slice(8);
      onFillConsumed();
      handleCitationCheck(citeText);
      return;
    }
    setInput(fillText);
    onFillConsumed();
    inputRef.current?.focus();
  }, [fillText, onFillConsumed]);

  const citationCheckRef = useRef(false); // prevent double trigger

  const handleCitationCheck = async (text: string) => {
    if (citationCheckRef.current) return; // skip duplicate
    citationCheckRef.current = true;
    setCitationResults(null);
    try {
      const results = await invoke<CitationSuggestion[]>("check_citations", {
        text, projectId,
        kbIds: selectedKbIds.length > 0 ? selectedKbIds : null,
      });
      // Attach reason based on relevance
      const withReasons = results.map((r) => ({
        ...r,
        reason: r.relevance > 0.7 ? "与您的文本内容高度相关，建议引用"
              : r.relevance > 0.5 ? "与您的文本主题相关，可能需要引用"
              : "可能存在关联，请确认是否需要引用",
      }));
      setCitationResults(withReasons);
    } catch (e) {
      setCitationResults([]);
    }
    citationCheckRef.current = false;
  };

  const handleInsertCitation = (s: CitationSuggestion) => {
    // Insert with title for precise identification
    const shortTitle = s.title.length > 40 ? s.title.slice(0, 40) + "…" : s.title;
    onInsertCitation?.(`【${s.key}, 《${shortTitle}》】`);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    // Route: if KBs are selected, use tool-calling agent; otherwise stream polish
    if (selectedKbIds.length > 0) {
      sendKnowledgeQuery(trimmed, activeSessionId, selectedKbIds, projectId);
    } else {
      sendMessage(trimmed, activeSessionId);
    }
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      {/* Module tabs */}
      <div className="chat-tabs">
        {MODULES.map((m) => (
          <span
            key={m.key}
            className={`chat-tab ${activeModule === m.key ? "active" : ""}`}
            onClick={() => onModuleChange(m.key)}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Session tabs */}
      <div style={{
        display: "flex", height: "32px", borderBottom: "1px solid var(--color-hairline)",
        padding: "0 var(--space-xs)", gap: "2px", alignItems: "center",
        backgroundColor: "var(--color-canvas-soft)", overflowX: "auto",
      }}>
        {sessions.map((s, i) => (
          <div key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            style={{
              padding: "0 var(--space-sm)", height: "24px", display: "flex", alignItems: "center",
              fontSize: "11px", fontWeight: activeSessionId === s.id ? 600 : 400,
              color: activeSessionId === s.id ? "var(--color-primary)" : "var(--color-muted)",
              cursor: "pointer", borderRadius: "var(--radius-sm)",
              backgroundColor: activeSessionId === s.id ? "var(--color-surface-card)" : "transparent",
              border: activeSessionId === s.id ? "1px solid var(--color-hairline)" : "1px solid transparent",
              whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            会话 {i + 1}
          </div>
        ))}
        <button onClick={handleNewSession}
          style={{
            background: "none", border: "none", color: "var(--color-muted)",
            fontSize: "14px", cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}
          title="新建会话">+</button>
        {sessions.length > 1 && (
          <button onClick={() => activeSessionId && handleDeleteSession(activeSessionId)}
            style={{
              background: "none", border: "none", color: "var(--color-muted-soft)",
              fontSize: "12px", cursor: "pointer", padding: "0 4px", lineHeight: 1,
            }}
            title="关闭当前会话">×</button>
        )}
      </div>

      {/* KB selector (when knowledge bases exist) */}
      {kbs.length > 1 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "2px", padding: "4px var(--space-sm)",
          borderBottom: "1px solid var(--color-hairline)", backgroundColor: "var(--color-canvas)",
          maxHeight: "28px", overflowX: "auto",
        }}>
          <span style={{ fontSize: "10px", color: "var(--color-muted-soft)", lineHeight: "20px", marginRight: "4px", flexShrink: 0 }}>
            知识库:
          </span>
          {kbs.map((kb) => (
            <div key={kb.id} onClick={() => toggleKb(kb.id)}
              style={{
                fontSize: "10px", cursor: "pointer", padding: "1px 8px", borderRadius: "var(--radius-pill)",
                border: `1px solid ${selectedKbIds.includes(kb.id) ? "var(--color-primary)" : "var(--color-hairline)"}`,
                backgroundColor: selectedKbIds.includes(kb.id) ? "var(--color-canvas-soft)" : "transparent",
                color: selectedKbIds.includes(kb.id) ? "var(--color-primary)" : "var(--color-muted)",
                fontWeight: selectedKbIds.includes(kb.id) ? 600 : 400,
                whiteSpace: "nowrap", flexShrink: 0, lineHeight: "18px",
              }}
            >
              {kb.name}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-muted)", marginTop: "var(--space-xxl)", fontSize: "14px" }}>
            选中编辑器文字，右键选择操作，或直接输入问题
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role} ${msg.isStreaming ? "streaming" : ""}`}>
            {msg.isStreaming && (
              <span className={`timeline-pill ${stageClass}`}>{stageLabel}</span>
            )}
            {msg.role === "assistant" ? (
              <>
                {/* Tool calls */}
                {msg.tools && msg.tools.length > 0 && (
                  <details style={{ marginBottom: "var(--space-sm)" }} open>
                    <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--color-timeline-grep)", padding: "2px 0", userSelect: "none" }}>
                      🔧 工具调用
                    </summary>
                    <div style={{ marginTop: "var(--space-xs)" }}>
                      {msg.tools.map((t, i) => (
                        <div key={i} style={{
                          padding: "var(--space-xs) var(--space-sm)", marginBottom: "2px",
                          backgroundColor: t.type === "tool_start" ? "var(--color-canvas-soft)" : "var(--color-surface-card)",
                          borderRadius: "var(--radius-sm)", border: "1px solid var(--color-hairline)",
                          fontSize: "11px", lineHeight: 1.5,
                        }}>
                          {t.type === "tool_start" ? (
                            <div>
                              <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{t.name}</span>
                              <span style={{ color: "var(--color-muted)" }}> 查询中...</span>
                              {t.args && (
                                <div style={{ fontFamily: "var(--font-code)", fontSize: "10px", color: "var(--color-muted-soft)", marginTop: "2px" }}>
                                  {JSON.stringify(t.args)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <span style={{ fontWeight: 600, color: "var(--color-success)" }}>{t.name} ✓</span>
                              {t.result && (
                                <div style={{ color: "var(--color-muted)", marginTop: "2px", whiteSpace: "pre-wrap", maxHeight: "80px", overflowY: "auto" }}>
                                  {t.result}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {msg.reasoning && (
                  <details style={{ marginBottom: "var(--space-sm)" }}>
                    <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--color-muted)", padding: "2px 0", userSelect: "none" }}>
                      思考过程
                    </summary>
                    <div style={{ marginTop: "var(--space-xs)", padding: "var(--space-sm)", backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-md)", fontSize: "12px", color: "var(--color-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: "240px", overflowY: "auto" }}>
                      {msg.reasoning}
                    </div>
                  </details>
                )}
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              </>
            ) : (
              <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
            )}
          </div>
        ))}
        {isLoading && messages.length === 0 && (
          <div className="message assistant streaming">
            <span className={`timeline-pill ${stageClass}`}>{stageLabel}</span>
          </div>
        )}
      </div>

      {/* Citation suggestion cards */}
      {citationResults !== null && (
        <div style={{ borderTop: "1px solid var(--color-hairline)", padding: "var(--space-sm) var(--space-base)", maxHeight: "240px", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-ink)" }}>
              引用建议 ({citationResults.length})
            </span>
            <button onClick={() => setCitationResults(null)}
              style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: "16px", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
              title="关闭">×</button>
          </div>
          {citationResults.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>未找到相关文献，可能无需额外引用或知识库中暂无相关文献。</div>
          ) : (
            citationResults.map((s: CitationSuggestion & { reason?: string }) => (
              <div key={s.document_id} style={{
                padding: "var(--space-sm)", marginBottom: "var(--space-xs)",
                border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
                backgroundColor: "var(--color-surface-card)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-ink)", marginBottom: "2px" }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", marginBottom: "2px" }}>
                      {s.key} · 相关度 {(s.relevance * 100).toFixed(0)}%
                    </div>
                    {s.reason && (
                      <div style={{ fontSize: "11px", color: "var(--color-primary)", fontWeight: 500, marginBottom: "4px" }}>
                        💡 {s.reason}
                      </div>
                    )}
                    <div style={{ fontSize: "11px", color: "var(--color-muted-soft)", lineHeight: 1.5 }}>
                      {s.snippet}
                    </div>
                  </div>
                  <button
                    onClick={() => handleInsertCitation(s)}
                    style={{
                      flexShrink: 0, marginLeft: "var(--space-sm)", height: "28px",
                      padding: "0 var(--space-sm)", border: "1px solid var(--color-primary)",
                      borderRadius: "var(--radius-sm)", backgroundColor: "transparent",
                      color: "var(--color-primary)", fontSize: "11px", fontWeight: 500,
                      cursor: "pointer", fontFamily: "var(--font-ui)",
                    }}
                  >
                    插入引用
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-area">
        <input ref={inputRef} type="text" value={input}
          onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="输入问题，或 @write @data @lit..." disabled={isLoading} />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          {isLoading ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}
