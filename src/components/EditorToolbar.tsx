import { useState } from "react";
import type { editor } from "monaco-editor";

const btn: React.CSSProperties = {
  height: "28px", padding: "0 8px", border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "12px",
  fontWeight: 500, cursor: "pointer", color: "var(--color-muted)",
  backgroundColor: "transparent", display: "flex", alignItems: "center", gap: "2px",
};
const sep: React.CSSProperties = {
  width: "1px", height: "18px", backgroundColor: "var(--color-hairline)",
  margin: "0 2px", alignSelf: "center",
};

interface EditorToolbarProps {
  editor: editor.IStandaloneCodeEditor | null;
  onExport: (format: "docx" | "pdf") => void;
  onGenerateTemplate: () => void;
  onOpenAdvancedTemplate: () => void;
}

export default function EditorToolbar({ editor, onExport, onGenerateTemplate, onOpenAdvancedTemplate }: EditorToolbarProps) {
  const [showTableDlg, setShowTableDlg] = useState(false);
  const [tableCols, setTableCols] = useState(3);
  const [tableRows, setTableRows] = useState(3);

  const insert = (before: string, after?: string, placeholder?: string) => {
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;

    const text = model.getValueInRange(sel) || placeholder || "";
    const op = {
      range: sel,
      text: before + text + (after ?? ""),
      forceMoveMarkers: true,
    };
    editor.executeEdits("toolbar", [op]);

    if (after !== undefined) {
      const start = sel.getStartPosition();
      const end = sel.getEndPosition();
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column + before.length,
        endLineNumber: end.lineNumber,
        endColumn: end.column + before.length,
      });
    }
    editor.focus();
  };

  const prefixLine = (prefix: string) => {
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;

    const startLine = sel.startLineNumber;
    const endLine = sel.endLineNumber;
    const edits = [];
    for (let l = startLine; l <= endLine; l++) {
      const line = model.getLineContent(l);
      if (!line.startsWith(prefix)) {
        edits.push({ range: { startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: 1 }, text: prefix });
      }
    }
    editor.executeEdits("toolbar", edits);
    editor.focus();
  };

  const insertFormula = () => {
    if (!editor) return;
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return;

    const selected = model.getValueInRange(sel) || "";
    if (selected) {
      // Multi-line selection → block formula
      if (selected.includes("\n")) {
        insert("$$\n", "\n$$");
      } else {
        insert("$", "$");
      }
    } else {
      // No selection → insert empty block formula
      insert("$$\n", "\n$$", "");
    }
  };

  const insertTable = () => {
    const cols = Math.max(1, Math.min(10, tableCols));
    const rows = Math.max(1, Math.min(50, tableRows));

    let table = "";
    // Header
    table += "|";
    for (let c = 0; c < cols; c++) table += ` 列${c + 1} |`;
    table += "\n";
    // Separator
    table += "|";
    for (let c = 0; c < cols; c++) table += "------|";
    table += "\n";
    // Rows
    for (let r = 0; r < rows; r++) {
      table += "|";
      for (let c = 0; c < cols; c++) table += "     |";
      table += "\n";
    }

    insert(table);
    setShowTableDlg(false);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "2px", height: "36px",
      padding: "0 var(--space-sm)", borderBottom: "1px solid var(--color-hairline)",
      backgroundColor: "var(--color-canvas)", flexShrink: 0, overflowX: "auto",
    }}>
      {/* Text style */}
      <button style={btn} onClick={() => insert("**", "**", "粗体")} title="粗体">B</button>
      <button style={{ ...btn, fontStyle: "italic" }} onClick={() => insert("_", "_", "斜体")} title="斜体">I</button>
      <button style={{ ...btn, textDecoration: "line-through" }} onClick={() => insert("~~", "~~", "删除线")} title="删除线">S</button>

      <div style={sep} />

      {/* Headings */}
      <button style={btn} onClick={() => prefixLine("# ")} title="一级标题">H1</button>
      <button style={btn} onClick={() => prefixLine("## ")} title="二级标题">H2</button>
      <button style={btn} onClick={() => prefixLine("### ")} title="三级标题">H3</button>

      <div style={sep} />

      {/* Block */}
      <button style={btn} onClick={() => prefixLine("> ")} title="引用">"</button>
      <button style={btn} onClick={() => prefixLine("- ")} title="无序列表">-</button>
      <button style={btn} onClick={() => prefixLine("1. ")} title="有序列表">1.</button>

      <div style={sep} />

      {/* Insert */}
      <button style={btn} onClick={() => insert("[", "](url)", "链接文字")} title="链接">🔗</button>
      <button style={btn} onClick={() => insert("![", "](url)", "图片说明")} title="图片">🖼</button>
      <button style={{ ...btn, fontFamily: "'Latin Modern Math', 'Cambria Math', serif", fontWeight: 700 }}
        onClick={insertFormula} title="公式 (行内 $...$ / 块 $$...$$)">∑</button>
      <button style={btn} onClick={() => setShowTableDlg(true)} title="插入表格">📊</button>

      <div style={{ flex: 1 }} />

      {/* Template */}
      <button style={btn} onClick={onGenerateTemplate} title="生成基础参考模板">
        📄 模板
      </button>
      <button style={btn} onClick={onOpenAdvancedTemplate} title="高级模板设置（需要 Python + python-docx）">
        ⚙️
      </button>

      {/* Export */}
      <button style={{ ...btn, color: "var(--color-ink)", borderColor: "var(--color-hairline-strong)" }}
        onClick={() => onExport("docx")} title="导出 Word">
        📥 DOCX
      </button>
      <button style={{ ...btn, color: "var(--color-ink)", borderColor: "var(--color-hairline-strong)" }}
        onClick={() => onExport("pdf")} title="导出 PDF">
        PDF
      </button>

      {/* ── Table Insert Dialog ── */}
      {showTableDlg && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1002,
          backgroundColor: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowTableDlg(false)}>
          <div style={{
            backgroundColor: "var(--color-surface-card)", borderRadius: "var(--radius-lg)",
            padding: "var(--space-lg)", minWidth: "240px",
            border: "1px solid var(--color-hairline)", boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "var(--space-base)", color: "var(--color-ink)" }}>
              插入表格
            </div>
            <div style={{ display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-base)" }}>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "4px" }}>列数</div>
                <input type="number" min={1} max={10} value={tableCols}
                  onChange={(e) => setTableCols(parseInt(e.target.value) || 1)}
                  style={{ width: "100%", height: "32px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "14px", outline: "none" }}
                  onKeyDown={(e) => e.key === "Enter" && insertTable()} autoFocus />
              </label>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", color: "var(--color-muted)", marginBottom: "4px" }}>行数</div>
                <input type="number" min={1} max={50} value={tableRows}
                  onChange={(e) => setTableRows(parseInt(e.target.value) || 1)}
                  style={{ width: "100%", height: "32px", padding: "0 var(--space-sm)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: "14px", outline: "none" }}
                  onKeyDown={(e) => e.key === "Enter" && insertTable()} />
              </label>
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
              <button onClick={() => setShowTableDlg(false)}
                style={{ height: "32px", padding: "0 var(--space-base)", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-sm)", backgroundColor: "transparent", color: "var(--color-muted)", fontSize: "13px", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                取消
              </button>
              <button onClick={insertTable}
                style={{ height: "32px", padding: "0 var(--space-base)", border: "none", borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
