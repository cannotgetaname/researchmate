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
  const [aiStage, setAiStage] = useState<"thinking" | "editing" | "done" | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const prevSessionRef = useRef<string | null>(null);
  const savedRef = useRef(false);

  // Load messages from DB when session changes
  useEffect(() => {
    if (sessionId === prevSessionRef.current) return;
    prevSessionRef.current = sessionId;
    let cancelled = false;
    setMessages([]);
    if (!sessionId) return () => { cancelled = true; };
    (async () => {
      try {
        const msgs = await invoke<{id: string; session_id: string; role: string; content: string; created_at: string}[]>("get_messages", { sessionId });
        if (!cancelled) {
          setMessages(msgs.filter((m) => m.role !== "tool").map((m) => {
            let content = m.content;
            let reasoning: string | undefined;
            if (m.role === "assistant") {
              const thinkMatch = content.match(/^\[思考\]([\s\S]*?)\[\/思考\]\n?/);
              if (thinkMatch) { reasoning = thinkMatch[1]; content = content.slice(thinkMatch[0].length); }
            }
            return { id: m.id, role: m.role as "user" | "assistant" | "system", content, reasoning };
          }));
        }
      } catch { if (!cancelled) setMessages([]); }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const saveExchange = async (userMsg: ChatMessage, assistantMsg: ChatMessage) => {
    if (!sessionId || savedRef.current) return;
    savedRef.current = true;
    try {
      await invoke("save_message", { sessionId, role: "user", content: userMsg.content });
      const content = assistantMsg.reasoning
        ? `[思考]${assistantMsg.reasoning}[/思考]\n${assistantMsg.content}`
        : assistantMsg.content;
      await invoke("save_message", { sessionId, role: "assistant", content });
    } catch {}
  };

  /** Core streaming helper — invokes ai_action and listens to polish-stream events */
  const streamAiAction = useCallback(
    async (action: string | null, text: string, userLabel: string, projectId?: string) => {
      savedRef.current = false;
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: userLabel };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", reasoning: "", isStreaming: true };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStage("thinking");

      let currentStage = "thinking";
      const unlisten1 = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) => prev.map((m) => {
          if (m.id !== assistantMsg.id) return m;
          if (currentStage === "thinking") return { ...m, reasoning: (m.reasoning || "") + event.payload.delta };
          return { ...m, content: m.content + event.payload.delta };
        }));
      });
      const unlisten2 = await listen<{ stage: string }>("polish-stage", (event) => {
        if (event.payload.stage === "editing") { currentStage = "editing"; setAiStage("editing"); }
        else { setAiStage("thinking"); }
      });
      unlistenRef.current = [unlisten1, unlisten2];

      try {
        await invoke("ai_action", { action, text, projectId: projectId || null });
        setAiStage("done");
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === assistantMsg.id);
          const final: ChatMessage = { ...msg!, isStreaming: false };
          saveExchange(userMsg, final).catch(() => {});
          return prev.map((m) => m.id === assistantMsg.id ? final : m);
        });
      } catch (err) {
        setAiStage(null);
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `❌ ${err}`, isStreaming: false } : m));
      } finally {
        setIsLoading(false);
        unlistenRef.current.forEach((f) => f());
      }
    },
    [sessionId],
  );

  /** Auto-route based on pipeline stage (action = null) */
  const sendMessage = useCallback(
    (text: string, projectId?: string) => streamAiAction(null, text, text, projectId),
    [streamAiAction],
  );

  /** Explicit action (from slash command or pipeline button) */
  const sendAiAction = useCallback(
    (action: string, text: string, projectId?: string) => streamAiAction(action, text, `/${action} ${text}`, projectId),
    [streamAiAction],
  );

  const sendKnowledgeQuery = useCallback(
    async (text: string, kbIds: string[], projectId: string) => {
      savedRef.current = false;
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", reasoning: "", isStreaming: true };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStage("thinking");

      const unlistenReasoning = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) => prev.map((m) => {
          if (m.id !== assistantMsg.id) return m;
          return { ...m, reasoning: (m.reasoning || "") + event.payload.delta };
        }));
      });
      const unlistenTools = await listen<ToolRecord>("tool-stream", (event) => {
        setMessages((prev) => prev.map((m) => {
          if (m.id !== assistantMsg.id) return m;
          return { ...m, tools: [...(m.tools || []), event.payload] };
        }));
      });

      try {
        const result = await invoke<string>("chat_with_tools", { projectId, sessionId, userMessage: text, kbIds: kbIds.length > 0 ? kbIds : null });
        setAiStage("done");
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === assistantMsg.id);
          const final: ChatMessage = { ...msg!, content: result, isStreaming: false };
          saveExchange(userMsg, final).catch(() => {});
          return prev.map((m) => m.id === assistantMsg.id ? final : m);
        });
      } catch (err) {
        setAiStage(null);
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `❌ ${err}`, isStreaming: false } : m));
      } finally {
        setIsLoading(false);
        unlistenReasoning();
        unlistenTools();
      }
    },
    [sessionId],
  );

  const deleteMessage = useCallback(async (messageId: string) => {
    try { await invoke("delete_message", { messageId }); setMessages((prev) => prev.filter((m) => m.id !== messageId)); } catch {}
  }, []);

  return { messages, setMessages, sendMessage, sendAiAction, sendKnowledgeQuery, isLoading, aiStage, deleteMessage };
}
