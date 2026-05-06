import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ToolRecord {
  type: string;
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

export function useStreamChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("就绪");
  const [aiStage, setAiStage] = useState<"thinking" | "editing" | "done" | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const prevSessionRef = useRef<string | null>(null);

  // Load messages from DB when session changes
  useEffect(() => {
    if (sessionId === prevSessionRef.current) return;
    prevSessionRef.current = sessionId;

    let cancelled = false;
    setMessages([]);  // clear immediately on switch

    if (!sessionId) return () => { cancelled = true; };

    (async () => {
      try {
        const msgs = await invoke<{id: string; session_id: string; role: string; content: string; created_at: string}[]>("get_messages", { sessionId });
        if (!cancelled) {
          setMessages(msgs.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })));
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionId]);

  const saveExchange = async (userMsg: ChatMessage, assistantMsg: ChatMessage) => {
    if (!sessionId) return;
    try {
      await invoke("save_message", { sessionId, role: "user", content: userMsg.content });
      // Save reasoning too if present
      const content = assistantMsg.reasoning
        ? `[思考]${assistantMsg.reasoning}[/思考]\n${assistantMsg.content}`
        : assistantMsg.content;
      await invoke("save_message", { sessionId, role: "assistant", content });
    } catch { /* ignore */ }
  };

  const sendMessage = useCallback(
    async (text: string) => {
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

      let currentStage = "thinking";

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

      const unlisten2 = await listen<{ stage: string }>("polish-stage", (event) => {
        if (event.payload.stage === "editing") {
          currentStage = "editing";
          setAiStatus("写作中...");
          setAiStage("editing");
        } else if (event.payload.stage === "thinking") {
          setAiStatus("思考中...");
          setAiStage("thinking");
        }
      });
      unlistenRef.current = [unlisten1, unlisten2];

      try {
        await invoke("polish_text", { text, style: null });
        setAiStatus("完成");
        setAiStage("done");
        // Mark streaming done + persist to DB
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === assistantMsg.id);
          const final: ChatMessage = { ...msg!, isStreaming: false };
          saveExchange(userMsg, final).catch(() => {});
          return prev.map((m) => m.id === assistantMsg.id ? final : m);
        });
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
        unlistenRef.current.forEach((f) => f());
      }
    },
    [sessionId],
  );

  const sendKnowledgeQuery = useCallback(
    async (text: string, kbIds: string[], projectId: string) => {
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

      const unlistenReasoning = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            return { ...m, reasoning: (m.reasoning || "") + event.payload.delta };
          }),
        );
      });

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
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === assistantMsg.id);
          const final: ChatMessage = { ...msg!, content: result, isStreaming: false };
          setAiStatus("完成");
          setAiStage("done");
          saveExchange(userMsg, final).catch(() => {});
          return prev.map((m) => m.id === assistantMsg.id ? final : m);
        });
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
    [sessionId],
  );

  return { messages, sendMessage, sendKnowledgeQuery, isLoading, aiStatus, aiStage };
}
