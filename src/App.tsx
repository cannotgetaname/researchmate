import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import TopNav from "./components/TopNav";
import EditorPanel from "./components/EditorPanel";
import ChatPanel from "./components/ChatPanel";
import DocumentPanel from "./components/DocumentPanel";
import StatusBar from "./components/StatusBar";

interface AppConfig {
  has_key: boolean;
  deepseek_api_key_masked: string;
  default_model: string;
  model_overrides: Record<string, string>;
  modules: string[];
  embedding_provider: string;
  embedding_model: string;
  embedding_base_url: string;
  pdf_parser: string;
  python_path: string;
  pdf_parsers: string[];
  embedding_providers: string[];
}

const MODULE_LABELS: Record<string, string> = {
  writing: "写作润色", analysis: "数据分析",
  literature: "文献处理", project_mgmt: "项目管理",
};

const inputS: React.CSSProperties = {
  width: "100%", height: "40px",
  padding: "0 var(--space-base)",
  border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-code)", fontSize: "13px",
  outline: "none",
};

const selectS: React.CSSProperties = {
  ...inputS, cursor: "pointer", appearance: "none",
  fontFamily: "var(--font-ui)",
};

interface ProjectInfo { id: string; name: string; }

export default function App() {
  const [content, setContent] = useState("");
  const [activeModule, setActiveModule] = useState("write");
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [fillText, setFillText] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([{ id: "default", name: "默认项目" }]);
  const [activeProject, setActiveProject] = useState("default");
  const [newProjectName, setNewProjectName] = useState("");

  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [embProvider, setEmbProvider] = useState("ollama");
  const [embModel, setEmbModel] = useState("");
  const [embUrl, setEmbUrl] = useState("");
  const [pdfParser, setPdfParser] = useState("native");
  const [pythonPath, setPythonPath] = useState("");

  const wordCount = useMemo(() => (content.match(/[一-鿿\w]+/g) || []).length, [content]);

  const handleContentChange = useCallback((value: string | undefined) => { setContent(value ?? ""); }, []);
  const handleSelectionChange = useCallback(() => {}, []);
  const handleAddToChat = useCallback((text: string) => { setFillText(text); }, []);
  const handleFillConsumed = useCallback(() => { setFillText(""); }, []);

  const loadProjects = async () => {
    try {
      const list = await invoke("list_projects") as ProjectInfo[];
      setProjects(list);
    } catch {}
  };
  useEffect(() => { loadProjects(); }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await invoke("create_project", { name: newProjectName.trim(), description: null });
      setNewProjectName("");
      setShowNewProject(false);
      await loadProjects();
    } catch (e) { alert(`创建失败：${e}`); }
  };

  const handleOpenSettings = async () => {
    setShowSettings(true); setSaveMsg(""); setApiKey("");
    try {
      const c = await invoke("get_config") as AppConfig;
      setCfg(c);
      setDefaultModel(c.default_model);
      setOverrides(c.model_overrides);
      setEmbProvider(c.embedding_provider);
      setEmbModel(c.embedding_model);
      setEmbUrl(c.embedding_base_url);
      setPdfParser(c.pdf_parser);
      setPythonPath(c.python_path);
    } catch { setCfg(null); }
  };

  const handleSaveConfig = async () => {
    try {
      const modelOverrides = Object.fromEntries(
        cfg!.modules.map((m) => [m, overrides[m]?.trim() || null]),
      );
      const msg = await invoke("save_config", {
        apiKey: apiKey.trim() || null,
        defaultModel: defaultModel.trim() || null,
        modelOverrides,
        embeddingProvider: embProvider,
        embeddingModel: embModel.trim(),
        embeddingBaseUrl: embUrl.trim(),
        pdfParser,
        pythonPath: pythonPath.trim(),
      });
      setSaveMsg(msg as string);
      setApiKey("");
      const c = await invoke("get_config") as AppConfig;
      setCfg(c);
    } catch (err) { setSaveMsg(`保存失败：${err}`); }
  };

  return (
    <div className="app-container">
      <TopNav
        projects={projects} activeProjectId={activeProject}
        onSwitchProject={setActiveProject}
        onCreateProject={() => setShowNewProject(true)}
        onOpenSettings={handleOpenSettings} onOpenAbout={() => setShowAbout(true)}
      />
      <div className="app-main">
        <EditorPanel content={content} onChange={handleContentChange} onSelectionChange={handleSelectionChange} onAddToChat={handleAddToChat} />
        <div style={{ display: activeModule === "lit" ? "flex" : "none", flex: 4, flexDirection: "column", backgroundColor: "var(--color-canvas)", minWidth: "360px" }}>
          <div className="chat-tabs" style={{ display: "flex", height: "40px", borderBottom: "1px solid var(--color-hairline)", padding: "0 var(--space-sm)", gap: "var(--space-xs)" }}>
            {[{ key: "write", label: "写作" }, { key: "data", label: "数据" }, { key: "lit", label: "文献" }, { key: "plan", label: "管理" }].map((m) => (
              <span key={m.key} className={`chat-tab ${activeModule === m.key ? "active" : ""}`} onClick={() => setActiveModule(m.key)}>{m.label}</span>
            ))}
          </div>
          <DocumentPanel projectId={activeProject} />
        </div>
        <div style={{ display: activeModule !== "lit" ? "flex" : "none", flex: 4, flexDirection: "column", backgroundColor: "var(--color-canvas)", minWidth: "360px" }}>
          <ChatPanel activeModule={activeModule} onModuleChange={setActiveModule} fillText={fillText} onFillConsumed={handleFillConsumed} />
        </div>
      </div>
      <StatusBar wordCount={wordCount} aiStatus="就绪" lastSaved="刚刚" />

      {/* New Project Dialog */}
      {showNewProject && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowNewProject(false)}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", width: "360px", border: "1px solid var(--color-hairline)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>新建课题</h3>
            <input type="text" value={newProjectName} placeholder="课题名称" onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateProject()} style={{ ...inputS, marginBottom: "var(--space-sm)" }} autoFocus />
            <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="topnav-btn" onClick={() => { setShowNewProject(false); setNewProjectName(""); }}>取消</button>
              <button style={{ height: "36px", padding: "0 18px", border: "none", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500, cursor: "pointer" }} onClick={handleCreateProject}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowSettings(false)}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", width: "520px", maxHeight: "85vh", overflowY: "auto", border: "1px solid var(--color-hairline)" }} onClick={(e) => e.stopPropagation()}>

            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>设置</h3>

            {cfg && (
              <div style={{ marginBottom: "var(--space-base)", padding: "var(--space-sm) var(--space-base)", backgroundColor: "var(--color-canvas-soft)", borderRadius: "var(--radius-sm)", fontSize: "13px", color: "var(--color-muted)" }}>
                <div>API Key：{cfg.has_key ? <span style={{ color: "var(--color-success)" }}>已配置 ({cfg.deepseek_api_key_masked})</span> : <span style={{ color: "var(--color-error)" }}>未配置</span>}</div>
                <div>默认模型：{cfg.default_model} | 嵌入：{cfg.embedding_provider} / {cfg.embedding_model} | PDF：{cfg.pdf_parser}</div>
              </div>
            )}

            {/* ── LLM ── */}
            <SectionHeader>大语言模型</SectionHeader>
            <Field label="API Key" mt={false}><input type="password" value={apiKey} placeholder="sk-..." onChange={(e) => setApiKey(e.target.value)} style={inputS} /></Field>
            <Field label="默认模型"><input type="text" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} style={inputS} /></Field>
            {cfg?.modules.map((mod) => (
              <Field key={mod} label={`  └ ${MODULE_LABELS[mod] ?? mod}`}>
                <input type="text" value={overrides[mod] ?? ""} placeholder={cfg.default_model} onChange={(e) => setOverrides((prev) => ({ ...prev, [mod]: e.target.value }))} style={inputS} />
              </Field>
            ))}

            {/* ── Embedding ── */}
            <SectionHeader>向量嵌入</SectionHeader>
            <Field label="提供方" mt={false}>
              <select value={embProvider} onChange={(e) => setEmbProvider(e.target.value)} style={selectS}>
                {(cfg?.embedding_providers ?? ["ollama", "openai"]).map((p) => <option key={p} value={p}>{p === "ollama" ? "Ollama（本地）" : "OpenAI 兼容 API"}</option>)}
              </select>
            </Field>
            <Field label="模型"><input type="text" value={embModel} onChange={(e) => setEmbModel(e.target.value)} style={inputS} /></Field>
            <Field label="API 地址"><input type="text" value={embUrl} onChange={(e) => setEmbUrl(e.target.value)} style={inputS} /></Field>

            {/* ── PDF Parser ── */}
            <SectionHeader>PDF 解析</SectionHeader>
            <Field label="引擎" mt={false}>
              <select value={pdfParser} onChange={(e) => setPdfParser(e.target.value)} style={selectS}>
                {(cfg?.pdf_parsers ?? ["native", "opendataloader"]).map((p) => <option key={p} value={p}>{p === "native" ? "Native（Rust 内置）" : "OpenDataLoader（Python）"}</option>)}
              </select>
            </Field>
            <Field label="Python 路径"><input type="text" value={pythonPath} placeholder="python3" onChange={(e) => setPythonPath(e.target.value)} style={inputS} /></Field>

            {saveMsg && <div style={{ marginTop: "var(--space-base)", fontSize: "13px", color: saveMsg.includes("失败") ? "var(--color-error)" : "var(--color-success)" }}>{saveMsg}</div>}

            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-base)", justifyContent: "flex-end" }}>
              <button className="topnav-btn" onClick={() => setShowSettings(false)}>关闭</button>
              <button style={{ height: "40px", padding: "0 18px", border: "none", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500, cursor: "pointer" }} onClick={handleSaveConfig}>保存全部</button>
            </div>
          </div>
        </div>
      )}

      {/* About */}
      {showAbout && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowAbout(false)}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", minWidth: "360px", border: "1px solid var(--color-hairline)", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>ResearchMate</h3>
            <p style={{ color: "var(--color-body)", fontSize: "14px", lineHeight: 1.6 }}>研究生专属 AI 科研伙伴 v0.1.0<br />定位：经验丰富的师兄/师姐<br />技术栈：Tauri + Rust + React</p>
            <button className="topnav-btn" style={{ marginTop: "var(--space-base)" }} onClick={() => setShowAbout(false)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-ink)", marginTop: "var(--space-lg)", marginBottom: "var(--space-sm)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)" }}>{children}</div>;
}

function Field({ label, children, mt = true }: { label: string; children: React.ReactNode; mt?: boolean }) {
  return (
    <div style={{ marginTop: mt ? "var(--space-sm)" : 0 }}>
      <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "var(--space-xxs)" }}>{label}</div>
      {children}
    </div>
  );
}
