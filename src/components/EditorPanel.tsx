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
        if (draft) onChange(draft);
      } catch { /* ignore */ }
    })();
  }, [projectId]);

  // Auto-save draft (debounced 3s, skipped when viewing history)
  useEffect(() => {
    if (skipAutoSaveRef?.current) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(async () => {
      try {
        await invoke("save_draft", { projectId, content: contentRef.current });
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (saveRef.current) clearTimeout(saveRef.current); };
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
        // Inject pagination CSS after <head>
        html = html.replace("</head>", PAGE_CSS + "</head>");
        setPreviewHtml(html);
      } catch { /* ignore transient errors while typing */ }
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