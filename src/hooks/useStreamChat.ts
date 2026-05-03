import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

export function useStreamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("就绪");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const sendMessage = useCallback(
    async (text: string, _sessionId: string | null) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStatus("思考中...");

      // Listen for streaming events
      const unlisten = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content + event.payload.delta }
              : m,
          ),
        );
      });
      unlistenRef.current = unlisten;

      try {
        await invoke("polish_text", { text, style: null });
        setAiStatus("完成");
      } catch (err) {
        setAiStatus("错误");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `错误：${err}`, isStreaming: false }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m,
          ),
        );
        unlisten();
      }
    },
    [],
  );

  return { messages, sendMessage, isLoading, aiStatus };
}
