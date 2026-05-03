import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import TopNav from "./components/TopNav";
import EditorPanel from "./components/EditorPanel";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

interface AppConfig {
  has_key: boolean;
  deepseek_api_key_masked: string;
  deepseek_base_url: string;
  default_model: string;
  model_overrides: Record<string, string>;
  modules: string[];
}

const MODULE_LABELS: Record<string, string> = {
  writing: "写作润色",
  analysis: "数据分析",
  literature: "文献处理",
  project_mgmt: "项目管理",
};

const inputStyle: React.CSSProperties = {
  width: "100%", height: "36px",
  padding: "0 var(--space-base)",
  border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-code)", fontSize: "13px",
  outline: "none",
};

export default function App() {
  const [content, setContent] = useState("");
  const [activeModule, setActiveModule] = useState("write");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [fillText, setFillText] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // Settings form state
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const wordCount = useMemo(
    () => (content.match(/[一-鿿\w]+/g) || []).length,
    [content],
  );

  const handleContentChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleSelectionChange = useCallback((_text: string) => {
    // selection tracked internally in EditorPanel for context menu
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
      const c = await invoke("get_config") as AppConfig;
      setCfg(c);
      setDefaultModel(c.default_model);
      setOverrides(c.model_overrides);
    } catch {
      setCfg(null);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const modelOverrides = Object.fromEntries(
        cfg!.modules.map((m) => [
          m,
          overrides[m] && overrides[m].trim() ? overrides[m].trim() : null,
        ]),
      );
      const msg = await invoke("save_config", {
        apiKey: apiKey.trim() || null,
        defaultModel: defaultModel.trim() || null,
        modelOverrides,
      });
      setSaveMsg(msg as string);
      setApiKey("");
      // Refresh display
      const c = await invoke("get_config") as AppConfig;
      setCfg(c);
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
              width: "500px",
              maxHeight: "80vh",
              overflowY: "auto",
              border: "1px solid var(--color-hairline)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>
              设置
            </h3>

            {/* Current status */}
            {cfg && (
              <div style={{
                marginBottom: "var(--space-base)",
                padding: "var(--space-sm) var(--space-base)",
                backgroundColor: "var(--color-canvas-soft)",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px", color: "var(--color-muted)",
              }}>
                <div>
                  API Key：
                  {cfg.has_key
                    ? <span style={{ color: "var(--color-success)" }}>已配置 ({cfg.deepseek_api_key_masked})</span>
                    : <span style={{ color: "var(--color-error)" }}>未配置</span>
                  }
                </div>
                <div>默认模型：{cfg.default_model}</div>
              </div>
            )}

            {/* API Key */}
            <SectionLabel>修改 API Key</SectionLabel>
            <input
              type="password" value={apiKey} placeholder="输入新的 API Key..."
              onChange={(e) => setApiKey(e.target.value)}
              style={inputStyle}
            />

            {/* Default model */}
            <div style={{ marginTop: "var(--space-lg)" }}>
              <SectionLabel>默认模型</SectionLabel>
              <input
                type="text" value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                style={inputStyle}
              />
            </div>

            {/* Per-module overrides */}
            <div style={{ marginTop: "var(--space-lg)" }}>
              <SectionLabel>各模块模型（留空则使用默认）</SectionLabel>
              {cfg?.modules.map((mod) => (
                <div key={mod} style={{ marginTop: "var(--space-sm)" }}>
                  <div style={{
                    fontSize: "12px", color: "var(--color-muted)",
                    marginBottom: "var(--space-xxs)",
                  }}>
                    {MODULE_LABELS[mod] ?? mod}
                  </div>
                  <input
                    type="text"
                    value={overrides[mod] ?? ""}
                    placeholder={cfg.default_model}
                    onChange={(e) => setOverrides((prev) => ({
                      ...prev, [mod]: e.target.value,
                    }))}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>

            {saveMsg && (
              <div style={{
                marginTop: "var(--space-base)", fontSize: "13px",
                color: saveMsg.includes("失败") ? "var(--color-error)" : "var(--color-success)",
              }}>
                {saveMsg}
              </div>
            )}

            <div style={{
              display: "flex", gap: "var(--space-sm)",
              marginTop: "var(--space-base)", justifyContent: "flex-end",
            }}>
              <button className="topnav-btn" onClick={() => setShowSettings(false)}>
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
                onClick={handleSaveConfig}
              >
                保存全部
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "var(--space-xs)" }}>
      {children}
    </div>
  );
}
