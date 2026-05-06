import { useRef, useState, useCallback, useEffect } from "react";
import Editor, { OnMount, OnChange, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import EditorToolbar from "./EditorToolbar";

loader.config({ monaco });

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
}

interface EditorPanelProps {
  content: string;
  onChange: (value: string | undefined) => void;
  onSelectionChange: (selectedText: string) => void;
  onAddToChat: (text: string) => void;
  projectId: string;
  skipAutoSaveRef?: React.MutableRefObject<boolean>;
  citationInsert?: string;          // text to insert at cursor (from ChatPanel)
  onCitationConsumed?: () => void;  // called after insertion
}

const MENU_ITEMS = [
  { label: "添加到对话框", key: "chat" },
  { label: "润色这段文字", key: "polish" },
  { label: "解释这段内容", key: "explain" },
  { label: "续写", key: "continue" },
  { label: "检查引用", key: "citation" },
];

export default function EditorPanel({
  content,
  onChange,
  onSelectionChange,
  onAddToChat,
  projectId,
  skipAutoSaveRef,
  citationInsert,
  onCitationConsumed,
}: EditorPanelProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, selectedText: "",
  });
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [exportMsg, setExportMsg] = useState("");
  const [showTemplateDlg, setShowTemplateDlg] = useState(false);
  const [tmplBodyFont, setTmplBodyFont] = useState("SimSun");
  const [tmplBodyLatin, setTmplBodyLatin] = useState("Times New Roman");
  const [tmplHeadFont, setTmplHeadFont] = useState("SimHei");
  const [tmplBodySize, setTmplBodySize] = useState(12);
  const [tmplLineSpace, setTmplLineSpace] = useState(1.5);
  const [tmplMargin, setTmplMargin] = useState(2.5);
  const [tmplTableStyle, setTmplTableStyle] = useState("three_line");
  const [tmplIndent, setTmplIndent] = useState(2);
  const [tmplParaSpace, setTmplParaSpace] = useState(0);
  const [tmplHeadingNum, setTmplHeadingNum] = useState(true);
  const [tmplPageSize, setTmplPageSize] = useState("A4");
  const [tmplCodeSize, setTmplCodeSize] = useState(10);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const citationDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const decorationsRef = useRef<monaco.editor.IModelDeltaDecoration[]>([]);

  // Handle citation insertion from ChatPanel
  useEffect(() => {
    if (!citationInsert || !editorRef.current) return;
    const editor = editorRef.current;
    const sel = editor.getSelection();
    if (!sel) return;
    // Insert citation at the end of the last checked paragraph
    const model = editor.getModel();
    if (!model) return;
    const endLine = sel.endLineNumber;
    const lastLineContent = model.getLineContent(endLine);
    const insertPos = { line: endLine, column: lastLineContent.length + 2 };
    editor.executeEdits("citation-insert", [{
      range: { startLineNumber: insertPos.line, startColumn: insertPos.column, endLineNumber: insertPos.line, endColumn: insertPos.column },
      text: citationInsert,
    }]);
    // Remove oldest decoration marker
    if (citationDecoRef.current && decorationsRef.current.length > 0) {
      decorationsRef.current = decorationsRef.current.slice(0, -1);
      citationDecoRef.current.set(decorationsRef.current);
    }
    onCitationConsumed?.();
  }, [citationInsert, onCitationConsumed]);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Create decorations collection for citation markers
    citationDecoRef.current = editor.createDecorationsCollection();

    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getModel()?.getValueInRange(editor.getSelection()!);
      onSelectionChange(selection ?? "");
    });

    editor.onContextMenu((e) => {
      e.event.preventDefault();
      const sel = editor.getModel()?.getValueInRange(editor.getSelection()!) ?? "";
      setCtxMenu({ visible: true, x: e.event.posx, y: e.event.posy, selectedText: sel });
    });

    editor.onMouseDown(() => {
      setCtxMenu((prev) => prev.visible ? { ...prev, visible: false } : prev);
    });
  };

  const handleChange: OnChange = (value) => {
    onChange(value);
  };

  const handleMenuAction = useCallback(
    (key: string) => {
      const text = ctxMenu.selectedText;
      const editor = editorRef.current;
      const sel = editor?.getSelection();
      setCtxMenu((prev) => ({ ...prev, visible: false }));
      switch (key) {
        case "chat": onAddToChat(text); break;
        case "polish": onAddToChat(`请帮我润色以下文字，使其更学术化：\n\n${text}`); break;
        case "explain": onAddToChat(`请帮我解释以下内容：\n\n${text}`); break;
        case "continue": onAddToChat(`请基于以下文字续写，保持一致的学术风格：\n\n${text}`); break;
        case "citation":
          onAddToChat(`__CITE__${text}`);
          // Add orange wavy underline decoration on checked text
          if (sel && citationDecoRef.current) {
            const deco: monaco.editor.IModelDeltaDecoration = {
              range: sel,
              options: {
                className: "citation-checked",
                overviewRuler: { color: "#f54e00", position: 1 },
              },
            };
            decorationsRef.current = [...decorationsRef.current, deco];
            citationDecoRef.current.set(decorationsRef.current);
          }
          break;
      }
    },
    [ctxMenu.selectedText, onAddToChat],
  );

  // ── Export ──
  const handleExport = async (format: "docx" | "pdf") => {
    // Show save dialog
    const ext = format === "docx" ? "docx" : "pdf";
    const chosen = await save({
      defaultPath: `论文草稿.${ext}`,
      filters: [{
        name: format === "docx" ? "Word 文档" : "PDF 文档",
        extensions: [ext],
      }],
    });
    if (!chosen) return; // user cancelled

    setExportMsg(`正在导出 ${format.toUpperCase()}...`);
    try {
      const path = await invoke<string>("export_document", { content, format, projectId, outputPath: chosen });
      setExportMsg(`已导出：${path}`);
      setTimeout(() => setExportMsg(""), 5000);
    } catch (e) {
      setExportMsg(`导出失败：${e}`);
    }
  };

  // ── Draft persistence ──
  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Load draft on project switch
  useEffect(() => {
    (async () => {
      try {
        const draft = await invoke<string>("load_draft", { projectId });
        onChange(draft || "");  // always update, even if empty
      } catch { /* ignore */ }
    })();
  }, [projectId]);

  // Auto-save draft (debounced 3s, skipped when viewing history)
  useEffect(() => {
    if (skipAutoSaveRef?.current) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    const currentPid = projectId;
    saveRef.current = setTimeout(async () => {
      try {
        await invoke("save_draft", { projectId: currentPid, content: contentRef.current });
      } catch { /* ignore */ }
    }, 3000);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
      // Force-save on project switch
      if (contentRef.current) {
        invoke("save_draft", { projectId: currentPid, content: contentRef.current }).catch(() => {});
      }
    };
  }, [content, projectId, skipAutoSaveRef]);

  // ── Preview (auto-refresh on content change, debounced) ──
  const PAGE_CSS = `
    <style>
      @page { size: A4; margin: 2.5cm 2cm 2.5cm 2cm; }
      html { background-color: #e8e8e8; }
      body {
        max-width: 21cm; min-height: 29.7cm;
        margin: 24px auto; padding: 2.5cm 2cm;
        background: #fff; box-shadow: 0 0 12px rgba(0,0,0,0.12);
        font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
        font-size: 12pt; line-height: 1.8; color: #26251e;
      }
      h1 { font-size: 18pt; font-weight: 600; margin: 1.2em 0 0.6em; }
      h2 { font-size: 15pt; font-weight: 600; margin: 1em 0 0.5em; }
      h3 { font-size: 13pt; font-weight: 600; margin: 0.8em 0 0.4em; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #cfcdc4; padding: 6px 8px; text-align: left; }
      th { background-color: #f7f7f4; font-weight: 600; }
      blockquote { border-left: 3px solid #f54e00; padding-left: 12px; color: #807d72; margin: 0.6em 0; }
      code { font-family: "JetBrains Mono","Fira Code",monospace; font-size: 0.9em; background: #f7f7f4; padding: 1px 4px; border-radius: 3px; }
      pre { background: #f7f7f4; border: 1px solid #e6e5e0; padding: 12px; border-radius: 6px; overflow-x: auto; }
      pre code { background: none; padding: 0; }
      img { max-width: 100%; }
    </style>
  `;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        let html = await invoke<string>("preview_html", { content });
        html = html.replace("</head>", PAGE_CSS + "</head>");
        setPreviewHtml(html);
        setExportMsg("");
      } catch (e) {
        setPreviewHtml(null);
        setExportMsg(`预览失败：${e}`);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content]);

  const togglePreview = () => setShowPreview((prev) => !prev);

  return (
    <div className="editor-panel">
      {/* Tab bar */}
      <div className="editor-tabs">
        <span className="editor-tab active">论文草稿</span>
        <button
          onClick={togglePreview}
          className="editor-tab"
          style={{ marginLeft: "auto", borderBottom: showPreview ? "2px solid var(--color-primary)" : "2px solid transparent", color: showPreview ? "var(--color-ink)" : "var(--color-muted)" }}
        >
          {showPreview ? "收起预览" : "预览"}
        </button>
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editorRef.current} onExport={handleExport}
        onGenerateTemplate={async () => {
          setExportMsg("正在生成模板...");
          try {
            const path = await invoke<string>("generate_template");
            setExportMsg(`模板已生成：${path}\n请用 Word 打开编辑（三线表、中文宋体等），之后导出自动使用。`);
          } catch (e) { setExportMsg(`生成失败：${e}`); }
        }}
        onOpenAdvancedTemplate={() => setShowTemplateDlg(true)}
      />

      {/* Export status */}
      {exportMsg && (
        <div style={{
          padding: "4px var(--space-sm)", fontSize: "12px",
          color: exportMsg.includes("失败") ? "var(--color-error)" : "var(--color-success)",
          backgroundColor: "var(--color-canvas-soft)", borderBottom: "1px solid var(--color-hairline)",
        }}>
          {exportMsg}
        </div>
      )}

      {/* Editor + Preview split */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: showPreview ? 0.6 : 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <Editor
            height="100%"
            defaultLanguage="markdown"
            value={content}
            onChange={handleChange}
            onMount={handleEditorDidMount}
            theme="vs"
            options={{
              fontSize: 16,
              fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', var(--font-ui), system-ui, sans-serif",
              lineHeight: 1.8,
              fontWeight: "400",
              wordWrap: "on",
              minimap: { enabled: false },
              lineNumbers: "off",
              lineNumbersMinChars: 0,
              glyphMargin: false,
              folding: false,
              lineDecorationsWidth: 0,
              renderLineHighlight: "none",
              scrollBeyondLastLine: false,
              padding: { top: 24, bottom: 200 },
              automaticLayout: true,
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              occurrencesHighlight: "off",
              renderWhitespace: "none",
              rulers: [],
              matchBrackets: "never",
              colorDecorators: false,
              cursorBlinking: "smooth",
              cursorWidth: 2,
              smoothScrolling: true,
              contextmenu: false,
              renderControlCharacters: false,
              unicodeHighlight: {
                ambiguousCharacters: false,
                invisibleCharacters: false,
                nonBasicASCII: false,
              },
            }}
          />
        </div>

        {/* Preview pane */}
        {showPreview && previewHtml && (
          <div style={{
            flex: 0.4, borderLeft: "1px solid var(--color-hairline)",
            backgroundColor: "#ffffff", overflow: "auto", padding: "var(--space-lg)",
          }}>
            <iframe
              srcDoc={previewHtml}
              style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#ffffff" }}
              title="预览"
            />
          </div>
        )}
      </div>

      {/* Advanced Template Dialog */}
      {showTemplateDlg && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002 }}
          onClick={() => setShowTemplateDlg(false)}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-xl)", width: "460px", maxHeight: "85vh", overflowY: "auto", border: "1px solid var(--color-hairline)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "var(--space-base)", fontSize: "16px" }}>高级模板设置</h3>
            <div style={{ fontSize: "11px", color: "var(--color-muted-soft)", marginBottom: "var(--space-base)" }}>
              需要 Python 3 + <code>pip install python-docx</code> 才能生成自定义模板。未安装则退化为基础模板。
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <TmplField label="中文字体"><TmplSelect value={tmplBodyFont} onChange={setTmplBodyFont} opts={["SimSun:宋体", "SimHei:黑体", "KaiTi:楷体", "FangSong:仿宋", "Microsoft YaHei:微软雅黑"]} /></TmplField>
                <TmplField label="西文字体"><TmplSelect value={tmplBodyLatin} onChange={setTmplBodyLatin} opts={["Times New Roman", "Arial", "Calibri", "Cambria"]} /></TmplField>
              </div>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <TmplField label="标题字体"><TmplSelect value={tmplHeadFont} onChange={setTmplHeadFont} opts={["SimHei:黑体", "SimSun:宋体", "Microsoft YaHei:微软雅黑"]} /></TmplField>
                <TmplField label="正文字号"><TmplSelect value={String(tmplBodySize)} onChange={(v) => setTmplBodySize(Number(v))} opts={["10:五号(10pt)", "12:小四(12pt)", "14:四号(14pt)"]} /></TmplField>
              </div>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <TmplField label="行距"><TmplSelect value={String(tmplLineSpace)} onChange={(v) => setTmplLineSpace(Number(v))} opts={["1:单倍", "1.5:1.5倍", "2:双倍"]} /></TmplField>
                <TmplField label="页边距"><TmplSelect value={String(tmplMargin)} onChange={(v) => setTmplMargin(Number(v))} opts={["2:窄(2cm)", "2.5:标准(2.5cm)", "3:宽(3cm)"]} /></TmplField>
              </div>
              <TmplField label="表格样式"><TmplSelect value={tmplTableStyle} onChange={setTmplTableStyle} opts={["three_line:三线表", "full_grid:全框表"]} /></TmplField>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <TmplField label="首行缩进"><TmplSelect value={String(tmplIndent)} onChange={(v) => setTmplIndent(Number(v))} opts={["0:无", "2:2字符", "4:4字符"]} /></TmplField>
                <TmplField label="段间距"><TmplSelect value={String(tmplParaSpace)} onChange={(v) => setTmplParaSpace(Number(v))} opts={["0:无", "6:6pt", "12:12pt"]} /></TmplField>
              </div>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <TmplField label="标题编号"><TmplSelect value={tmplHeadingNum ? "1" : "0"} onChange={(v) => setTmplHeadingNum(v === "1")} opts={["1:自动编号", "0:无编号"]} /></TmplField>
                <TmplField label="页面大小"><TmplSelect value={tmplPageSize} onChange={setTmplPageSize} opts={["A4", "Letter"]} /></TmplField>
              </div>
              <TmplField label="代码字号"><TmplSelect value={String(tmplCodeSize)} onChange={(v) => setTmplCodeSize(Number(v))} opts={["9:9pt", "10:10pt", "11:11pt"]} /></TmplField>
            </div>

            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-lg)", justifyContent: "flex-end" }}>
              <button className="topnav-btn" onClick={() => setShowTemplateDlg(false)}>取消</button>
              <button style={{ height: "36px", padding: "0 18px", border: "none", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}
                onClick={async () => {
                  setShowTemplateDlg(false);
                  setExportMsg("正在生成高级模板...");
                  try {
                    const config = {
                      body_font: tmplBodyFont, body_font_latin: tmplBodyLatin,
                      heading_font: tmplHeadFont, body_size: tmplBodySize,
                      line_spacing: tmplLineSpace, page_margin_cm: tmplMargin,
                      table_style: tmplTableStyle,
                      indent_chars: tmplIndent,
                      paragraph_spacing: tmplParaSpace,
                      heading_numbering: tmplHeadingNum,
                      page_size: tmplPageSize,
                      code_size: tmplCodeSize,
                    };
                    const msg = await invoke<string>("generate_template_advanced", { config });
                    setExportMsg(msg);
                  } catch (e) { setExportMsg(`生成失败：${e}`); }
                }}>
                生成模板
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom context menu */}
      {ctxMenu.visible && (
        <div
          style={{
            position: "fixed", left: ctxMenu.x, top: ctxMenu.y,
            backgroundColor: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-md)", padding: "var(--space-xs) 0",
            minWidth: "180px", zIndex: 1001,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          onClick={() => setCtxMenu((prev) => ({ ...prev, visible: false }))}
        >
          {MENU_ITEMS.map((item) => (
            <div
              key={item.key}
              style={{
                padding: "8px var(--space-base)", cursor: "pointer", fontSize: "13px",
                color: "var(--color-ink)", transition: "background-color 0.1s",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = "var(--color-canvas-soft)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = "transparent"; }}
              onClick={(e) => { e.stopPropagation(); handleMenuAction(item.key); }}
            >
              {item.label}
            </div>
          ))}
          {!ctxMenu.selectedText && (
            <div style={{
              padding: "8px var(--space-base)", fontSize: "12px",
              color: "var(--color-muted-soft)",
              borderTop: "1px solid var(--color-hairline)", marginTop: "4px",
            }}>
              选中文字后可使用更多功能
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TmplField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: "11px", color: "var(--color-muted)", marginBottom: "var(--space-xxs)" }}>{label}</div>
      {children}
    </div>
  );
}

function TmplSelect({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", height: "32px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", fontFamily: "var(--font-ui)", fontSize: "13px", outline: "none", backgroundColor: "var(--color-surface-card)", cursor: "pointer" }}>
      {opts.map((opt) => {
        const [val, ...labelParts] = opt.split(":");
        return <option key={val} value={val}>{labelParts.join(":") || val}</option>;
      })}
    </select>
  );
}