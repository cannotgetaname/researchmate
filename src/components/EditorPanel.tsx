import { useRef, useState, useCallback } from "react";
import Editor, { OnMount, OnChange, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

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
}: EditorPanelProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, selectedText: "",
  });

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Track text selection
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getModel()?.getValueInRange(editor.getSelection()!);
      onSelectionChange(selection ?? "");
    });

    // Custom right-click handler
    editor.onContextMenu((e) => {
      e.event.preventDefault();
      const sel = editor.getModel()?.getValueInRange(editor.getSelection()!) ?? "";
      setCtxMenu({
        visible: true,
        x: e.event.posx,
        y: e.event.posy,
        selectedText: sel,
      });
    });

    // Hide menu on click elsewhere
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
      setCtxMenu((prev) => ({ ...prev, visible: false }));

      switch (key) {
        case "chat":
          onAddToChat(text);
          break;
        case "polish":
          onAddToChat(`请帮我润色以下文字，使其更学术化：\n\n${text}`);
          break;
        case "explain":
          onAddToChat(`请帮我解释以下内容：\n\n${text}`);
          break;
        case "continue":
          onAddToChat(`请基于以下文字续写，保持一致的学术风格：\n\n${text}`);
          break;
        case "citation":
          onAddToChat(`以下论述是否需要添加文献引用？\n\n${text}`);
          break;
      }
    },
    [ctxMenu.selectedText, onAddToChat],
  );

  return (
    <div className="editor-panel">
      <div className="editor-tabs">
        <span className="editor-tab active">论文草稿</span>
      </div>

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
          padding: { top: 48, bottom: 200 },
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

      {/* Custom context menu */}
      {ctxMenu.visible && (
        <div
          style={{
            position: "fixed",
            left: ctxMenu.x,
            top: ctxMenu.y,
            backgroundColor: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-xs) 0",
            minWidth: "180px",
            zIndex: 1001,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          onClick={() => setCtxMenu((prev) => ({ ...prev, visible: false }))}
        >
          {MENU_ITEMS.map((item) => (
            <div
              key={item.key}
              style={{
                padding: "8px var(--space-base)",
                cursor: "pointer",
                fontSize: "13px",
                color: "var(--color-ink)",
                transition: "background-color 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.backgroundColor = "var(--color-canvas-soft)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.backgroundColor = "transparent";
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleMenuAction(item.key);
              }}
            >
              {item.label}
            </div>
          ))}
          {!ctxMenu.selectedText && (
            <div
              style={{
                padding: "8px var(--space-base)",
                fontSize: "12px",
                color: "var(--color-muted-soft)",
                borderTop: "1px solid var(--color-hairline)",
                marginTop: "4px",
              }}
            >
              选中文字后可使用更多功能
            </div>
          )}
        </div>
      )}
    </div>
  );
}
