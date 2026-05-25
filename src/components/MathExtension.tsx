import { Node, mergeAttributes, InputRule, textblockTypeInputRule } from "@tiptap/core";
import { ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import katex from "katex";

// ── React renderer for inline math ──
function InlineMathRenderer({ node }: ReactNodeViewProps) {
  const latex = (node.attrs as Record<string, string>).latex || "";
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: false });
  } catch {
    html = latex;
  }
  return (
    <span
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ display: "inline", fontSize: "1em" }}
      data-latex={latex}
    />
  );
}

// ── React renderer for block math ──
function BlockMathRenderer({ node }: ReactNodeViewProps) {
  const latex = (node.attrs as Record<string, string>).latex || "";
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: true });
  } catch {
    html = latex;
  }
  return (
    <div
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ textAlign: "center", margin: "1em 0", fontSize: "1.05em" }}
      data-latex={latex}
    />
  );
}

// ── Inline math node ──
export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-latex]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-latex": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathRenderer);
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)\$(?!\$)([^$]+)\$(?!\d)/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          const { tr } = state;
          tr.replaceRangeWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});

// ── Block math node ──
export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-latex]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-latex": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathRenderer);
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^\$\$\s*$/,
        type: this.type,
        getAttributes: () => ({ latex: "" }),
      }),
      new InputRule({
        find: /(?<!\$)\$\$(?!\$)([^$]+)\$\$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim();
          const { tr } = state;
          // Replace the entire matched range (including $$ markers) with the block math node
          tr.replaceRangeWith(range.from, range.to, this.type.create({ latex }));
        },
      }),
    ];
  },
});
