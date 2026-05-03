import { useState, useCallback, useMemo } from "react";
import TopNav from "./components/TopNav";
import EditorPanel from "./components/EditorPanel";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  const [content, setContent] = useState("");
  const [activeModule, setActiveModule] = useState("write");
  const [, setSelectedText] = useState("");

  const wordCount = useMemo(
    () => (content.match(/[一-鿿\w]+/g) || []).length,
    [content],
  );

  const handleContentChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleSelectionChange = useCallback((text: string) => {
    setSelectedText(text);
  }, []);

  return (
    <div className="app-container">
      <TopNav projectName="我的论文" />
      <div className="app-main">
        <EditorPanel
          content={content}
          onChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
        />
        <ChatPanel
          activeModule={activeModule}
          onModuleChange={setActiveModule}
        />
      </div>
      <StatusBar wordCount={wordCount} aiStatus="就绪" lastSaved="刚刚" />
    </div>
  );
}
