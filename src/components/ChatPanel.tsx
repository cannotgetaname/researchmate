import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import { useStreamChat } from "../hooks/useStreamChat";

interface ChatPanelProps {
  activeModule: string;
  onModuleChange: (module: string) => void;
  fillText: string;
  onFillConsumed: () => void;
}

const MODULES = [
  { key: "write", label: "写作" },
  { key: "data", label: "数据" },
  { key: "lit", label: "文献" },
  { key: "plan", label: "管理" },
];

export default function ChatPanel({
  activeModule, onModuleChange, fillText, onFillConsumed,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading } = useStreamChat();
  const inputRef = useRef<HTMLInputElement>(null);

  // When editor sends text via right-click, auto-fill the input
  useEffect(() => {
    if (fillText) {
      setInput(fillText);
      onFillConsumed();
      inputRef.current?.focus();
    }
  }, [fillText, onFillConsumed]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed, null);
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
      <div className="chat-messages">
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-muted)",
              marginTop: "var(--space-xxl)",
              fontSize: "14px",
            }}
          >
            选中编辑器文字，右键选择操作，或直接输入问题
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.role} ${msg.isStreaming ? "streaming" : ""}`}
          >
            {msg.isStreaming && (
              <span className="timeline-pill thinking">思考中</span>
            )}
            {msg.role === "assistant" && !msg.isStreaming ? (
              <div className="markdown-body">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
            )}
          </div>
        ))}
        {isLoading && messages.length === 0 && (
          <div className="message assistant streaming">
            <span className="timeline-pill thinking">思考中</span>
          </div>
        )}
      </div>
      <div className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，或 @write @data @lit..."
          disabled={isLoading}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          {isLoading ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}
