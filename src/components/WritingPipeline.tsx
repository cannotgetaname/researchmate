import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Stage {
  id: string;
  project_id: string;
  stage_key: string;
  status: string;
  sort_order: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

const STAGE_LABELS: Record<string, { icon: string; label: string }> = {
  lit_review:   { icon: "📚", label: "文献调研" },
  experiment:   { icon: "🔬", label: "实验设计" },
  draft_cn:     { icon: "✍️", label: "中文初稿" },
  translate:    { icon: "🌐", label: "中译英" },
  polish_en:    { icon: "✨", label: "英文润色" },
  logic_check:  { icon: "🔍", label: "逻辑检查" },
  formatting:   { icon: "📄", label: "投稿格式" },
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待开始",
  in_progress: "进行中",
  done: "已完成",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--color-muted-soft)",
  in_progress: "#3b82f6",
  done: "#22c55e",
};

/** AI actions available per stage */
function stageActions(stageKey: string): { label: string; action: string }[] {
  switch (stageKey) {
    case "lit_review":
      return [
        { label: "文献检索", action: "kb_search" },
        { label: "上传PDF", action: "upload_pdf" },
      ];
    case "draft_cn":
      return [
        { label: "中文润色", action: "polish_cn" },
      ];
    case "translate":
      return [
        { label: "中→英翻译", action: "translate_cn2en" },
      ];
    case "polish_en":
      return [
        { label: "英文润色", action: "polish_en" },
      ];
    case "logic_check":
      return [
        { label: "逻辑检查", action: "logic_check" },
        { label: "去AI味", action: "de_ai" },
      ];
    case "formatting":
      return [
        { label: "导出DOCX", action: "export_docx" },
      ];
    default:
      return [];
  }
}

interface WritingPipelineProps {
  projectId: string;
  onAiAction?: (action: string) => void;
  onStageChange?: (stageLabel: string | null) => void;
  activeTab: string;
}

export default function WritingPipeline({ projectId, onAiAction, onStageChange, activeTab }: WritingPipelineProps) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStages = useCallback(async () => {
    try {
      let list = await invoke<Stage[]>("get_stages", { projectId });
      if (list.length === 0) {
        list = await invoke<Stage[]>("init_stages", { projectId });
      }
      setStages(list);
    } catch (e) {
      console.error("loadStages", e);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    loadStages();
  }, [loadStages]);

  // Report current active stage upward
  useEffect(() => {
    const active = stages.find((s) => s.status === "in_progress");
    if (active) {
      const info = STAGE_LABELS[active.stage_key];
      onStageChange?.(info ? `${info.icon} ${info.label}` : null);
    } else {
      onStageChange?.(null);
    }
  }, [stages, onStageChange]);

  const toggleStatus = async (stage: Stage) => {
    const next = stage.status === "pending" ? "in_progress"
      : stage.status === "in_progress" ? "done"
      : "pending";
    try {
      const updated = await invoke<Stage>("update_stage", { id: stage.id, status: next });
      setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      console.error("update_stage", e);
    }
  };

  const saveNotes = async (stage: Stage, notes: string) => {
    try {
      const updated = await invoke<Stage>("update_stage", { id: stage.id, notes });
      setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      console.error("update_stage notes", e);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  const handleAction = (action: string, _stageKey: string) => {
    if (action === "export_docx" || action === "upload_pdf" || action === "kb_search") {
      onAiAction?.(action);
      return;
    }
    // For text-based AI actions, pass action name upstream
    onAiAction?.(action);
  };

  if (activeTab !== "progress") return null;

  if (loading) {
    return <div style={{ padding: "var(--space-lg)", color: "var(--color-muted)", textAlign: "center" }}>加载中...</div>;
  }

  return (
    <div style={{ padding: "var(--space-sm) var(--space-base)", overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: "var(--space-base)", color: "var(--color-ink)" }}>
        写作流水线
      </div>

      {stages.map((stage) => {
        const info = STAGE_LABELS[stage.stage_key] || { icon: "📌", label: stage.stage_key };
        const isOpen = expanded === stage.id;
        const actions = stageActions(stage.stage_key);

        return (
          <div
            key={stage.id}
            style={{
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--space-sm)",
              backgroundColor: isOpen ? "var(--color-surface-card)" : "var(--color-canvas)",
              overflow: "hidden",
              cursor: "pointer",
            }}
            onClick={() => toggleExpand(stage.id)}
          >
            {/* Header row */}
            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-sm)",
              padding: "10px var(--space-base)",
              userSelect: "none",
            }}>
              <span style={{ fontSize: 16 }}>{info.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: "var(--color-ink)" }}>
                {info.label}
              </span>
              <span
                style={{
                  fontSize: 12, fontWeight: 600,
                  color: STATUS_COLORS[stage.status],
                  padding: "2px 10px", borderRadius: "var(--radius-sm)",
                  border: `1px solid ${STATUS_COLORS[stage.status]}`,
                  cursor: "pointer",
                }}
                onClick={(e) => { e.stopPropagation(); toggleStatus(stage); }}
                title="点击切换状态"
              >
                {STATUS_LABELS[stage.status]}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-muted-soft)", marginLeft: 4 }}>
                {isOpen ? "▲" : "▼"}
              </span>
            </div>

            {/* Expanded body */}
            {isOpen && (
              <div style={{ padding: "0 var(--space-base) var(--space-base)" }} onClick={(e) => e.stopPropagation()}>
                {/* AI quick actions */}
                {actions.length > 0 && (
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", marginBottom: "var(--space-sm)" }}>
                    {actions.map((a) => (
                      <button
                        key={a.action}
                        style={{
                          height: 30, padding: "0 12px", border: "1px solid var(--color-hairline-strong)",
                          borderRadius: "var(--radius-sm)", backgroundColor: "var(--color-canvas)",
                          fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500,
                          color: "var(--color-ink)", cursor: "pointer",
                        }}
                        onClick={() => handleAction(a.action, stage.stage_key)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Notes */}
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 4 }}>备注</div>
                <textarea
                  value={stage.notes}
                  placeholder="记录进展、想法..."
                  onChange={(e) => {
                    // optimistic local update
                    setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, notes: e.target.value } : s)));
                  }}
                  onBlur={(e) => saveNotes(stage, e.target.value)}
                  style={{
                    width: "100%", minHeight: 60, resize: "vertical",
                    padding: "var(--space-sm)", border: "1px solid var(--color-hairline)",
                    borderRadius: "var(--radius-sm)", fontFamily: "var(--font-ui)", fontSize: 13,
                    outline: "none", backgroundColor: "var(--color-canvas-soft)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
