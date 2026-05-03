import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import TopNav from "./components/TopNav";
import EditorPanel from "./components/EditorPanel";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  const [content, setContent] = useState("");
  const [activeModule, setActiveModule] = useState("write");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [fillText, setFillText] = useState("");
  const [configInfo, setConfigInfo] = useState<{
    has_key: boolean;
    deepseek_api_key_masked: string;
    model_name: string;
  } | null>(null);

  const wordCount = useMemo(
    () => (content.match(/[一-鿿\w]+/g) || []).length,
    [content],
  );

  const handleContentChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleSelectionChange = useCallback((_text: string) => {
    // selection is tracked in EditorPanel internally for context menu
  }, []);

  const handleAddToChat = useCallback((text: string) => {
    setFillText(text);
  }, []);

  const handleFillConsumed = useCallback(() => {
    setFillText("");
  }, []);

  const handleOpenSettings = async () => {
    setShowSettings(true);
    setSaveMsg("");
    setApiKey("");
    try {
      const cfg = await invoke("get_config") as {
        has_key: boolean;
        deepseek_api_key_masked: string;
        model_name: string;
      };
      setConfigInfo(cfg);
    } catch (err) {
      setConfigInfo(null);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    try {
      const msg = await invoke("save_api_key", { apiKey });
      setSaveMsg(msg as string);
      setApiKey("");
      // Reload config to show updated state
      const cfg = await invoke("get_config") as typeof configInfo;
      setConfigInfo(cfg);
    } catch (err) {
      setSaveMsg(`保存失败：${err}`);
    }
  };

  return (
    <div className="app-container">
      <TopNav
        projectName="我的论文"
        onOpenSettings={handleOpenSettings}
        onOpenAbout={() => setShowAbout(true)}
      />

      <div className="app-main">
        <EditorPanel
          content={content}
          onChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
          onAddToChat={handleAddToChat}
        />
        <ChatPanel
          activeModule={activeModule}
          onModuleChange={setActiveModule}
          fillText={fillText}
          onFillConsumed={handleFillConsumed}
        />
      </div>

      <StatusBar wordCount={wordCount} aiStatus="就绪" lastSaved="刚刚" />

      {/* Settings Modal */}
      {showSettings && (
        <div
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            style={{
              backgroundColor: "var(--color-surface-card)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-xl)",
              minWidth: "400px",
              maxWidth: "480px",
              border: "1px solid var(--color-hairline)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>
              设置
            </h3>

            {/* Current config status */}
            {configInfo && (
              <div style={{
                marginBottom: "var(--space-base)",
                padding: "var(--space-sm) var(--space-base)",
                backgroundColor: "var(--color-canvas-soft)",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                color: "var(--color-muted)",
              }}>
                <div>模型：{configInfo.model_name}</div>
                <div>
                  API Key：{configInfo.has_key
                    ? <span style={{ color: "var(--color-success)" }}>已配置 ({configInfo.deepseek_api_key_masked})</span>
                    : <span style={{ color: "var(--color-error)" }}>未配置</span>
                  }
                </div>
              </div>
            )}

            <label style={{ fontSize: "13px", color: "var(--color-muted)" }}>
              修改 DeepSeek API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入新的 API Key..."
              style={{
                width: "100%", height: "40px", marginTop: "var(--space-xs)",
                padding: "0 var(--space-base)",
                border: "1px solid var(--color-hairline)",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-code)", fontSize: "13px",
                outline: "none",
              }}
            />

            {saveMsg && (
              <div style={{
                marginTop: "var(--space-sm)", fontSize: "13px",
                color: saveMsg.includes("失败") ? "var(--color-error)" : "var(--color-success)",
              }}>
                {saveMsg}
              </div>
            )}

            <div style={{
              display: "flex", gap: "var(--space-sm)",
              marginTop: "var(--space-base)", justifyContent: "flex-end",
            }}>
              <button
                className="topnav-btn"
                onClick={() => { setShowSettings(false); setSaveMsg(""); }}
              >
                关闭
              </button>
              <button
                style={{
                  height: "40px", padding: "0 18px",
                  border: "none", borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-primary)",
                  color: "var(--color-on-primary)",
                  fontFamily: "var(--font-ui)", fontSize: "14px",
                  fontWeight: 500, cursor: "pointer",
                }}
                onClick={handleSaveApiKey}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAbout && (
        <div
          style={{
            position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowAbout(false)}
        >
          <div
            style={{
              backgroundColor: "var(--color-surface-card)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-xl)",
              minWidth: "360px",
              border: "1px solid var(--color-hairline)",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>
              ResearchMate
            </h3>
            <p style={{ color: "var(--color-body)", fontSize: "14px", lineHeight: 1.6 }}>
              研究生专属 AI 科研伙伴 v0.1.0<br />
              定位：经验丰富的师兄/师姐<br />
              技术栈：Tauri + Rust + React
            </p>
            <button
              className="topnav-btn"
              style={{ marginTop: "var(--space-base)" }}
              onClick={() => setShowAbout(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
