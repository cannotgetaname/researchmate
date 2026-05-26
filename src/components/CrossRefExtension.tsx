import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// ═══════════════════════════════════════════
// CrossRef — 图/表交叉引用 ("图3", "表2")
// ═══════════════════════════════════════════

function CrossRefRenderer({ node, editor }: ReactNodeViewProps) {
  const refId = (node.attrs as Record<string, any>).refId || "";
  const refType = (node.attrs as Record<string, any>).refType || "figure";
  const prefix = refType === "figure" ? "图" : "表";

  // Resolve number from the referenced caption node
  let num = "?";
  editor.state.doc.descendants((n) => {
    if (n.type.name === "caption" && n.attrs.captionType === refType && n.attrs.id === refId) {
      num = String(n.attrs.number || "?");
      return false;
    }
  });

  const handleClick = () => {
    // Find and scroll to the referenced caption
    let found = false;
    editor.state.doc.descendants((n, pos) => {
      if (!found && n.type.name === "caption" && n.attrs.captionType === refType && n.attrs.id === refId) {
        const domPos = editor.view.coordsAtPos(pos);
        editor.view.dom.parentElement?.scrollTo({ top: domPos.top - 200, behavior: "smooth" });
        // Select the caption
        editor.commands.setTextSelection(pos);
        found = true;
        return false;
      }
    });
  };

  return (
    <NodeViewWrapper as="span" className="cross-ref" contentEditable={false} style={{ cursor: "pointer" }}>
      <span
        onClick={handleClick}
        style={{ color: "var(--color-primary)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}
        title={`跳转到 ${prefix}${num}`}
      >
        {prefix}{num}
      </span>
    </NodeViewWrapper>
  );
}

export const CrossRef = Node.create({
  name: "crossRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      refId: { default: "" },
      refType: { default: "figure" },
      _sync: { default: 0 },  // bumped by captionRenumberPlugin to force re-render
    };
  },

  parseHTML() {
    return [{ tag: "span.cross-ref" }];
  },

  renderHTML({ HTMLAttributes }) {
    const prefix = HTMLAttributes.refType === "figure" ? "图" : "表";
    const num = HTMLAttributes["data-number"] || "?";
    return ["a", mergeAttributes(HTMLAttributes, {
      class: "cross-ref",
      href: `#ref-${HTMLAttributes.refId || ""}`,
      style: "color: var(--color-primary); font-weight: 500;",
    }), `${prefix}${num}`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CrossRefRenderer);
  },
});

// ═══════════════════════════════════════════
// Citation — 参考文献引用 ("[1,3,5]")
// ═══════════════════════════════════════════

function CitationRenderer({ node, editor: _editor }: ReactNodeViewProps) {
  const numbers = (node.attrs as Record<string, any>).numbers || "";
  const docIds: string[] = (node.attrs as Record<string, any>).docIds || [];

  return (
    <NodeViewWrapper as="span" className="citation-ref" contentEditable={false}>
      <sup
        style={{
          color: "var(--color-primary)", fontWeight: 600, cursor: "pointer",
          fontSize: "0.85em", margin: "0 1px",
        }}
        title={docIds.length > 0 ? `参考文献 ${docIds.join(", ")}` : "参考文献"}
      >
        [{numbers}]
      </sup>
    </NodeViewWrapper>
  );
}

export const CitationRef = Node.create({
  name: "citationRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      docIds: { default: [] as string[], parseHTML: (el) => (el.getAttribute("data-doc-ids") || "").split(",").filter(Boolean) },
      numbers: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "sup.citation-ref" }];
  },

  renderHTML({ HTMLAttributes }) {
    const nums = HTMLAttributes.numbers || "?";
    return ["sup", mergeAttributes(HTMLAttributes, {
      class: "citation-ref",
      "data-doc-ids": (HTMLAttributes.docIds || []).join(","),
    }), `[${nums}]`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationRenderer);
  },
});

// ═══════════════════════════════════════════
// Citation numbering plugin
// ═══════════════════════════════════════════

const citationNumberKey = new PluginKey("citationNumber");

export const citationNumberPlugin = new Plugin({
  key: citationNumberKey,
  appendTransaction(transactions, _oldState, newState) {
    if (transactions.every((tr) => !tr.docChanged)) return;

    const { doc } = newState;
    const seen = new Map<string, number>(); // docId → first-appearance order
    let counter = 0;
    const changes: { pos: number; numbers: string }[] = [];

    doc.descendants((node, pos) => {
      if (node.type.name !== "citationRef") return;
      const docIds: string[] = node.attrs.docIds || [];
      if (docIds.length === 0) return;

      // Assign numbers
      const nums: number[] = [];
      for (const id of docIds) {
        if (!seen.has(id)) seen.set(id, ++counter);
        nums.push(seen.get(id)!);
      }
      nums.sort((a, b) => a - b);
      const numbers = nums.join(",");
      if (node.attrs.numbers !== numbers) {
        changes.push({ pos, numbers });
      }
    });

    if (changes.length === 0) return;

    const tr = newState.tr;
    for (const c of changes) {
      tr.setNodeAttribute(c.pos, "numbers", c.numbers);
    }
    return tr;
  },
});

// Extension wrapper for citation numbering plugin
export const CitationRenumber = Extension.create({
  name: "citationRenumber",
  addProseMirrorPlugins() {
    return [citationNumberPlugin];
  },
});
