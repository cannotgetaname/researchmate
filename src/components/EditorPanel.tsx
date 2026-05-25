import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import EditorToolbar from "./EditorToolbar";

interface EditorPanelProps {
  content: string;
  onChange: (value: string | undefined) => void;
  onSelectionChange: (selectedText: string) => void;
  onAddToChat: (text: string) => void;
  projectId: string;
  skipAutoSaveRef?: React.MutableRefObject<boolean>;
  citationInsert?: string;
  onCitationConsumed?: () => void;
}

const AI_ACTIONS = [
  { label: "添加到对话框", key: "chat" },
  { label: "润色这段文字", key: "polish" },
  { label: "解释这段内容", key: "explain" },
  { label: "续写", key: "continue" },
  { label: "检查引用", key: "citation" },
] as const;

function buildAiPrompt(key: string, text: string): string {
  switch (key) {
    case "polish": return `请帮我润色以下文字，使其更学术化：\n\n${text}`;
    case "explain": return `请帮我解释以下内容：\n\n${text}`;
    case "continue": return `请基于以下文字续写，保持一致的学术风格：\n\n${text}`;
    case "citation": return `__CITE__${text}`;
    default: return text;
  }
}

/** Convert markdown to HTML for draft migration. */
function markdownToHtml(md: string): string {
  try {
    return marked.parse(md, { breaks: false }) as string;
  } catch {
    return md
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
      .join("\n");
  }
}

function looksLikeHtml(s: string): boolean {
  return /^\s*</.test(s);
}

// ─────────────────── SelectionBubble ───────────────────

function SelectionBubble({ editor, onAddToChat }: { editor: Editor; onAddToChat: (t: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setPos(null);
        return;
      }
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const x = (start.left + end.right) / 2;
        const y = start.top - 6;
        if (x === 0 && y === 0) return; // offscreen / not rendered
        setPos({ x, y });
      } catch {
        setPos(null);
      }
    };

    const hide = () => setPos(null);

    editor.on("selectionUpdate", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  if (!pos) return null;

  const selectedText = (() => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  })();

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, -100%)",
        zIndex: 1001,
        display: "flex",
        gap: 2,
        padding: 4,
        backgroundColor: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        userSelect: "none",
      }}
      onMouseDown={(e) => e.preventDefault()} // prevent stealing focus
    >
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="粗体"
      ><strong>B</strong></BubbleBtn>
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="斜体"
        style={{ fontStyle: "italic" }}
      >I</BubbleBtn>
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="下划线"
        style={{ textDecoration: "underline" }}
      >U</BubbleBtn>
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="删除线"
        style={{ textDecoration: "line-through" }}
      >S</BubbleBtn>
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="行内代码"
        style={{ fontFamily: "monospace", fontSize: 12 }}
      >&lt;/&gt;</BubbleBtn>
      <BubbleBtn
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        active={editor.isActive("highlight")}
        title="高亮"
      >🖌</BubbleBtn>

      <div style={{ width: 1, margin: "4px 4px", backgroundColor: "var(--color-hairline)" }} />

      {AI_ACTIONS.map((a) => (
        <BubbleBtn
          key={a.key}
          onClick={() => {
            if (a.key === "chat") onAddToChat(selectedText);
            else onAddToChat(buildAiPrompt(a.key, selectedText));
          }}
          title={a.label}
          style={{ fontSize: 12, padding: "4px 8px" }}
        >{a.label}</BubbleBtn>
      ))}
    </div>
  );
}

// ─────────────────── Context menu state ───────────────────

interface CtxState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
}

// ─────────────────── Main component ───────────────────

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
  const [exportMsg, setExportMsg] = useState("");
  const [showTableDlg, setShowTableDlg] = useState(false);
  const [tableCols, setTableCols] = useState(3);
  const [tableRows, setTableRows] = useState(3);
  const [ctxMenu, setCtxMenu] = useState<CtxState>({ visible: false, x: 0, y: 0, text: "" });

  const saveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const skipRef = useRef(skipAutoSaveRef);
  skipRef.current = skipAutoSaveRef;
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: "开始写作... 选中文字可出现格式菜单" }),
      Underline,
      Link.configure({ openOnClick: false }),
      ImageExt,
      Highlight,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Subscript,
      Superscript,
    ],
    content: "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onSelectionUpdate: ({ editor }) => {
      const sel = editor.state.selection;
      onSelectionChange(sel.empty ? "" : editor.state.doc.textBetween(sel.from, sel.to));
    },
  });

  // ── Right-click context menu ──
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      let text = editor.state.doc.textBetween(from, to);
      // If nothing selected, try to get the word under cursor
      if (!text.trim()) {
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) {
          const resolved = editor.state.doc.resolve(pos.pos);
          const node = resolved.parent;
          const nodeText = node.textContent;
          // crude word extraction around cursor
          const offset = resolved.parentOffset;
          const before = nodeText.slice(0, offset).match(/(\S+)$/)?.[1] || "";
          const after = nodeText.slice(offset).match(/^(\S+)/)?.[1] || "";
          text = before + after;
        }
      }
      setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, text });
    };
    dom.addEventListener("contextmenu", handler);
    return () => dom.removeEventListener("contextmenu", handler);
  }, [editor]);

  // ── Close context menu on any click ──
  useEffect(() => {
    if (!ctxMenu.visible) return;
    const close = () => setCtxMenu((p) => ({ ...p, visible: false }));
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu.visible]);

  // ── Handle context menu action ──
  const handleCtxAction = useCallback(
    (key: string) => {
      const text = ctxMenu.text;
      setCtxMenu((p) => ({ ...p, visible: false }));
      if (!text.trim()) return;
      if (key === "chat") onAddToChat(text);
      else onAddToChat(buildAiPrompt(key, text));
    },
    [ctxMenu.text, onAddToChat],
  );

  // ── Load draft ──
  useEffect(() => {
    if (!editor) return;
    (async () => {
      try {
        const draft: string = await invoke("load_draft", { projectId });
        editor.commands.setContent(draft ? (looksLikeHtml(draft) ? draft : markdownToHtml(draft)) : "");
      } catch {
        editor.commands.setContent("");
      }
    })();
  }, [editor, projectId]);

  // ── Auto-save ──
  useEffect(() => {
    if (!editor) return;
    if (skipRef.current?.current) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    const pid = projectRef.current;
    saveRef.current = setTimeout(async () => {
      try { await invoke("save_draft", { projectId: pid, content: contentRef.current }); } catch {}
    }, 3000);
    return () => { if (saveRef.current) clearTimeout(saveRef.current); };
  }, [content, projectId]);

  // ── Citation insertion ──
  useEffect(() => {
    if (!editor || !citationInsert) return;
    editor.commands.insertContent(citationInsert);
    onCitationConsumed?.();
  }, [citationInsert, editor, onCitationConsumed]);

  // ── Export ──
  const handleExport = useCallback(
    async (format: "docx" | "pdf") => {
      if (!editor) return;
      const chosen = await save({
        defaultPath: `论文草稿.${format}`,
        filters: [{ name: format === "docx" ? "Word 文档" : "PDF 文档", extensions: [format] }],
      });
      if (!chosen) return;
      setExportMsg(`正在导出 ${format.toUpperCase()}...`);
      try {
        const path = await invoke<string>("export_document", {
          content: editor.getHTML(), format, projectId, outputPath: chosen,
        });
        setExportMsg(`已导出：${path}`);
        setTimeout(() => setExportMsg(""), 5000);
      } catch (e) {
        setExportMsg(`导出失败：${e}`);
      }
    },
    [editor, projectId],
  );

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: true }).run();
    setShowTableDlg(false);
  }, [editor, tableRows, tableCols]);

  if (!editor) {
    return (
      <div className="editor-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-muted)" }}>
        加载编辑器中...
      </div>
    );
  }

  return (
    <div className="editor-panel">
      <div className="editor-tabs">
        <span className="editor-tab active">论文草稿</span>
      </div>

      <EditorToolbar editor={editor} onExport={handleExport} onOpenTableDlg={() => setShowTableDlg(true)} />

      {exportMsg && (
        <div style={{ padding: "4px var(--space-sm)", fontSize: 12, color: exportMsg.includes("失败") ? "var(--color-error)" : "var(--color-success)", backgroundColor: "var(--color-canvas-soft)", borderBottom: "1px solid var(--color-hairline)" }}>
          {exportMsg}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-lg) var(--space-xl)" }}>
        <style>{`
          .tiptap { outline: none; max-width: 800px; margin: 0 auto; font-family: "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif; font-size: 16px; line-height: 1.9; color: var(--color-ink); }
          .tiptap h1 { font-size: 22px; font-weight: 700; margin: 1.4em 0 0.6em; }
          .tiptap h2 { font-size: 19px; font-weight: 600; margin: 1.2em 0 0.5em; }
          .tiptap h3 { font-size: 17px; font-weight: 600; margin: 1em 0 0.4em; }
          .tiptap p  { margin: 0.5em 0; }
          .tiptap ul, .tiptap ol { padding-left: 1.5em; margin: 0.5em 0; }
          .tiptap li { margin: 0.2em 0; }
          .tiptap blockquote { border-left: 3px solid var(--color-primary); padding-left: 16px; color: var(--color-muted); margin: 1em 0; }
          .tiptap pre { background: var(--color-canvas-soft); border: 1px solid var(--color-hairline); border-radius: var(--radius-md); padding: 12px 16px; font-family: "JetBrains Mono","Fira Code",monospace; font-size: 14px; overflow-x: auto; }
          .tiptap code { font-family: "JetBrains Mono","Fira Code",monospace; font-size: 0.9em; background: var(--color-canvas-soft); padding: 1px 5px; border-radius: 3px; }
          .tiptap pre code { background: none; padding: 0; }
          .tiptap table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          .tiptap th { background: var(--color-canvas-soft); font-weight: 600; text-align: left; border: 1px solid var(--color-hairline-strong); padding: 6px 10px; }
          .tiptap td { border: 1px solid var(--color-hairline); padding: 6px 10px; }
          .tiptap img { max-width: 100%; border-radius: var(--radius-sm); }
          .tiptap mark { background: #fff3cd; padding: 0 2px; }
          .tiptap a { color: var(--color-primary); text-decoration: underline; }
          .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: var(--color-muted-soft); pointer-events: none; height: 0; }
        `}</style>

        <SelectionBubble editor={editor} onAddToChat={onAddToChat} />
        <EditorContent editor={editor} />
      </div>

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          style={{
            position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 1001,
            backgroundColor: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-md)", padding: "var(--space-xs) 0",
            minWidth: 180,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
          onClick={() => setCtxMenu((p) => ({ ...p, visible: false }))}
        >
          {AI_ACTIONS.map((a) => (
            <div
              key={a.key}
              style={{
                padding: "8px var(--space-base)", cursor: "pointer", fontSize: 13,
                color: "var(--color-ink)", transition: "background-color 0.1s",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = "var(--color-canvas-soft)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = "transparent"; }}
              onClick={(e) => { e.stopPropagation(); handleCtxAction(a.key); }}
            >
              {a.label}
            </div>
          ))}
          {!ctxMenu.text.trim() && (
            <div style={{ padding: "8px var(--space-base)", fontSize: 12, color: "var(--color-muted-soft)", borderTop: "1px solid var(--color-hairline)", marginTop: 4 }}>
              选中文字后可使用更多功能
            </div>
          )}
        </div>
      )}

      {/* Table dialog */}
      {showTableDlg && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1002, backgroundColor: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowTableDlg(false)}>
          <div style={{ backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)", padding: "var(--space-lg)", minWidth: 260, border: "1px solid var(--color-hairline)", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: "var(--space-base)", color: "var(--color-ink)" }}>插入表格</div>
            <div style={{ display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-base)" }}>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>列数</div>
                <input type="number" min={1} max={10} value={tableCols} onChange={(e) => setTableCols(parseInt(e.target.value) || 1)}
                  style={inputS} onKeyDown={(e) => e.key === "Enter" && insertTable()} autoFocus />
              </label>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>行数</div>
                <input type="number" min={1} max={50} value={tableRows} onChange={(e) => setTableRows(parseInt(e.target.value) || 1)}
                  style={inputS} onKeyDown={(e) => e.key === "Enter" && insertTable()} />
              </label>
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button className="topnav-btn" onClick={() => setShowTableDlg(false)}>取消</button>
              <button style={primaryBtnS} onClick={insertTable}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiny helpers ──

function BubbleBtn({
  onClick, active, title, style, children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        height: 28, padding: "0 6px", border: "none",
        borderRadius: "var(--radius-sm)",
        backgroundColor: active ? "var(--color-canvas-soft)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--color-ink)",
        fontFamily: "var(--font-ui)", fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer", whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

const inputS: React.CSSProperties = {
  width: "100%", height: 32, padding: "0 var(--space-sm)",
  border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-ui)", fontSize: 14, outline: "none",
};

const primaryBtnS: React.CSSProperties = {
  height: 32, padding: "0 var(--space-base)", border: "none",
  borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-primary)",
  color: "var(--color-on-primary)", fontSize: 13, fontWeight: 500,
  cursor: "pointer", fontFamily: "var(--font-ui)",
};
