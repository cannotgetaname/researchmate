import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

// ── React renderer ──
function CaptionRenderer({ node }: ReactNodeViewProps) {
  const type = (node.attrs as Record<string, any>).captionType || "figure";
  const num = (node.attrs as Record<string, any>).number || 1;
  const prefix = type === "figure" ? `图${num}` : `表${num}`;
  return (
    <NodeViewWrapper className="caption" data-caption-type={type}>
      <span className="caption-prefix" contentEditable={false}>{prefix}: </span>
      <NodeViewContent className="caption-text" />
    </NodeViewWrapper>
  );
}

// ── Node definition ──
export const Caption = Node.create({
  name: "caption",
  group: "block",
  content: "inline*",
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      captionType: { default: "figure" },
      number: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: "p.caption" }];
  },

  renderHTML({ HTMLAttributes }) {
    const t = HTMLAttributes["captionType"] || "figure";
    const n = HTMLAttributes["number"] || 1;
    const prefix = t === "figure" ? `图${n}` : `表${n}`;
    return ["p", mergeAttributes(HTMLAttributes, { class: "caption" }), `${prefix}: `, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CaptionRenderer);
  },
});

// ── ProseMirror plugin: auto-renumber captions ──
const captionPluginKey = new PluginKey("captionRenumber");

export const captionRenumberPlugin = new Plugin({
  key: captionPluginKey,
  appendTransaction(transactions, _oldState, newState) {
    // Avoid infinite loops — only run if the doc actually changed
    if (transactions.every((tr) => !tr.docChanged)) return;

    const { doc } = newState;
    const changes: { pos: number; number: number }[] = [];

    let figIdx = 0;
    let tblIdx = 0;

    doc.descendants((node, pos) => {
      if (node.type.name !== "caption") return;
      const ct = node.attrs.captionType || "figure";
      const idx = ct === "figure" ? ++figIdx : ++tblIdx;
      if (node.attrs.number !== idx) {
        changes.push({ pos, number: idx });
      }
    });

    if (changes.length === 0) return;

    const tr = newState.tr;
    for (const c of changes) {
      tr.setNodeAttribute(c.pos, "number", c.number);
    }
    return tr;
  },
});

// ── Minimal extension to register the renumber plugin ──
export const CaptionRenumber = Extension.create({
  name: "captionRenumber",
  addProseMirrorPlugins() {
    return [captionRenumberPlugin];
  },
});

/** Count existing captions of a given type and return the next number. */
export function nextCaptionNumber(editor: Editor, type: "figure" | "table"): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "caption" && node.attrs.captionType === type) count++;
  });
  return count + 1;
}
