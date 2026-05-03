import { useRef } from "react";
import Editor, { OnMount, OnChange, loader } from "@monaco-editor/react";

loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs",
  },
});

interface EditorPanelProps {
  content: string;
  onChange: (value: string | undefined) => void;
  onSelectionChange: (selectedText: string) => void;
}

export default function EditorPanel({
  content,
  onChange,
  onSelectionChange,
}: EditorPanelProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getModel()?.getValueInRange(editor.getSelection()!);
      if (selection) {
        onSelectionChange(selection);
      }
    });
  };

  const handleChange: OnChange = (value) => {
    onChange(value);
  };

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
          fontSize: 15,
          fontFamily: "var(--font-code), monospace",
          lineHeight: 1.7,
          wordWrap: "on",
          minimap: { enabled: false },
          lineNumbers: "on",
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          padding: { top: 24, bottom: 24 },
          automaticLayout: true,
        }}
      />
    </div>
  );
}
