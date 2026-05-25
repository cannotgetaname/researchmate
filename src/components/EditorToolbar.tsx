import type { Editor } from "@tiptap/react";

const btn: React.CSSProperties = {
  height: "28px",
  padding: "0 8px",
  border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-ui)",
  fontSize: "12px",
  fontWeight: 500,
  cursor: "pointer",
  color: "var(--color-muted)",
  backgroundColor: "transparent",
  display: "flex",
  alignItems: "center",
  gap: "2px",
};
const sep: React.CSSProperties = {
  width: "1px",
  height: "18px",
  backgroundColor: "var(--color-hairline)",
  margin: "0 2px",
  alignSelf: "center",
};
const activeBtn: React.CSSProperties = {
  ...btn,
  color: "var(--color-primary)",
  backgroundColor: "var(--color-canvas-soft)",
  borderColor: "var(--color-primary)",
};

interface EditorToolbarProps {
  editor: Editor;
  onExport: (format: "docx" | "pdf") => void;
  onOpenTableDlg: () => void;
}

export default function EditorToolbar({ editor, onExport, onOpenTableDlg }: EditorToolbarProps) {
  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  const addLink = () => {
    const url = window.prompt("链接地址：", "https://");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt("图片地址：", "https://");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        height: "36px",
        padding: "0 var(--space-sm)",
        borderBottom: "1px solid var(--color-hairline)",
        backgroundColor: "var(--color-canvas)",
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {/* Text formatting */}
      <button
        style={isActive("bold") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="粗体 (Ctrl+B)"
      >
        <strong>B</strong>
      </button>
      <button
        style={{ ...(isActive("italic") ? activeBtn : btn), fontStyle: "italic" }}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="斜体 (Ctrl+I)"
      >
        I
      </button>
      <button
        style={{ ...(isActive("underline") ? activeBtn : btn), textDecoration: "underline" }}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="下划线 (Ctrl+U)"
      >
        U
      </button>
      <button
        style={{ ...(isActive("strike") ? activeBtn : btn), textDecoration: "line-through" }}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="删除线"
      >
        S
      </button>
      <button
        style={isActive("code") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="行内代码"
      >
        &lt;/&gt;
      </button>
      <button
        style={isActive("highlight") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        title="高亮"
      >
        🖌
      </button>

      <div style={sep} />

      {/* Headings */}
      <button
        style={isActive("heading", { level: 1 }) ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="一级标题"
      >
        H1
      </button>
      <button
        style={isActive("heading", { level: 2 }) ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="二级标题"
      >
        H2
      </button>
      <button
        style={isActive("heading", { level: 3 }) ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="三级标题"
      >
        H3
      </button>

      <div style={sep} />

      {/* Block elements */}
      <button
        style={isActive("blockquote") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="引用"
      >
        ❝
      </button>
      <button
        style={isActive("bulletList") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="无序列表"
      >
        •≡
      </button>
      <button
        style={isActive("orderedList") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="有序列表"
      >
        1.
      </button>
      <button
        style={isActive("codeBlock") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="代码块"
      >
        {"{ }"}
      </button>

      <div style={sep} />

      {/* Align */}
      <button style={btn} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="左对齐">
        ⬅
      </button>
      <button style={btn} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="居中">
        ⬌
      </button>
      <button style={btn} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="右对齐">
        ➡
      </button>

      <div style={sep} />

      {/* Insert */}
      <button style={btn} onClick={addLink} title="插入链接">
        🔗
      </button>
      <button style={btn} onClick={addImage} title="插入图片">
        🖼
      </button>
      <button style={btn} onClick={onOpenTableDlg} title="插入表格">
        📊
      </button>
      <button
        style={{ ...btn, fontFamily: "'Latin Modern Math', 'Cambria Math', serif", fontWeight: 700, fontSize: 15 }}
        onClick={() => {
          let latex = "";
          const { from, to } = editor.state.selection;
          const selText = editor.state.doc.textBetween(from, to);
          if (selText) {
            latex = window.prompt("LaTeX 公式：", selText) || "";
          } else {
            latex = window.prompt("LaTeX 公式：", "E=mc^2") || "";
          }
          if (!latex) return;
          if (latex.includes("\n")) {
            editor.chain().focus().insertContent({ type: "mathBlock", attrs: { latex } }).run();
          } else {
            editor.chain().focus().insertContent({ type: "mathInline", attrs: { latex } }).run();
          }
        }}
        title="插入公式 (行内输入 $...$ 亦可自动转换)"
      >
        ∑
      </button>
      <button style={btn} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分割线">
        —
      </button>

      <div style={{ flex: 1 }} />

      {/* Sub/superscript */}
      <button
        style={isActive("subscript") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
        title="下标"
      >
        X₂
      </button>
      <button
        style={isActive("superscript") ? activeBtn : btn}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
        title="上标"
      >
        X²
      </button>

      <div style={sep} />

      {/* Export */}
      <button
        style={{ ...btn, color: "var(--color-ink)", borderColor: "var(--color-hairline-strong)" }}
        onClick={() => onExport("docx")}
        title="导出 Word"
      >
        📥 DOCX
      </button>
      <button
        style={{ ...btn, color: "var(--color-ink)", borderColor: "var(--color-hairline-strong)" }}
        onClick={() => onExport("pdf")}
        title="导出 PDF"
      >
        PDF
      </button>
    </div>
  );
}
