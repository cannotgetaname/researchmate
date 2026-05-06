import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ToolRecord {
  type: string;   // "tool_start" | "tool_result"
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  tools?: ToolRecord[];
  isStreaming?: boolean;
}

export function useStreamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("就绪");
  const [aiStage, setAiStage] = useState<"thinking" | "editing" | "done" | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);

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
        reasoning: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStatus("思考中...");
      setAiStage("thinking");

      // Mutable flag to track stage (read by stream listener, set by stage listener)
      let currentStage = "thinking"; // reasoning always comes first in thinking mode

      // Listen for streaming events
      const unlisten1 = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            if (currentStage === "thinking") {
              return { ...m, reasoning: (m.reasoning || "") + event.payload.delta };
            } else {
              return { ...m, content: m.content + event.payload.delta };
            }
          }),
        );
      });

      // Listen for stage changes
      const unlisten2 = await listen<{ stage: string }>("polish-stage", (event) => {
        const stage = event.payload.stage;
        if (stage === "editing") {
          currentStage = "editing";
          setAiStatus("写作中...");
          setAiStage("editing");
        } else if (stage === "thinking") {
          setAiStatus("思考中...");
          setAiStage("thinking");
        }
      });
      unlistenRef.current = [unlisten1, unlisten2];

      try {
        await invoke("polish_text", { text, style: null });
        setAiStatus("完成");
        setAiStage("done");
      } catch (err) {
        setAiStatus("错误");
        setAiStage(null);
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
        unlistenRef.current.forEach((f) => f());
      }
    },
    [],
  );

  const sendKnowledgeQuery = useCallback(
    async (text: string, sessionId: string | null, kbIds: string[], projectId: string) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        reasoning: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStatus("检索中...");
      setAiStage("thinking");

      // Listen for reasoning content (from chat_with_tools thinking mode)
      const unlistenReasoning = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            return { ...m, reasoning: (m.reasoning || "") + event.payload.delta };
          }),
        );
      });

      // Listen for tool call progress
      const unlistenTools = await listen<ToolRecord>("tool-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            const tools = [...(m.tools || []), event.payload];
            return { ...m, tools };
          }),
        );
      });

      try {
        const result = await invoke<string>("chat_with_tools", {
          projectId,
          sessionId,
          userMessage: text,
          kbIds: kbIds.length > 0 ? kbIds : null,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: result, isStreaming: false }
              : m,
          ),
        );
        setAiStatus("完成");
        setAiStage("done");
      } catch (err) {
        setAiStatus("错误");
        setAiStage(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `错误：${err}`, isStreaming: false }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        unlistenReasoning();
        unlistenTools();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m,
          ),
        );
      }
    },
    [],
  );

  return { messages, sendMessage, sendKnowledgeQuery, isLoading, aiStatus, aiStage };
}
