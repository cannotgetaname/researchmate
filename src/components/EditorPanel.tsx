import { useRef } from "react";
import Editor, { OnMount, OnChange, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

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
          fontSize: 16,
          fontFamily: "var(--font-ui), system-ui, sans-serif",
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
        }}
      />
    </div>
  );
}
