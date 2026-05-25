# AI Action 重构 — 阶段感知 + 斜杠命令

## 目标

统一所有 AI 操作入口。根据当前流水线阶段自动路由 prompt，斜杠命令 `/xxx` 显式覆盖。

## 全局架构

```
用户操作             前端                      后端                    Prompt
─────────           ────                      ────                    ──────
右键→润色    →  invoke("ai_action",    →  ai_action(action?,  →  查 project 当前阶段
                  {text, projectId})         project_id, text)     → 自动映射 prompt
                                                                  → LLM 流式输出

ChatPanel    →  /polish  /translate    →  ai_action(action,    →  直接用指定 prompt
输入              /logic  /deai  /cn        project_id, text)

流水线按钮   →  同右键润色             →  同上
```

## 阶段 → prompt 自动映射

| 当前阶段 | 未指定 action 时默认 |
|---------|---------------------|
| draft_cn | `polish_cn` |
| translate | `translate_cn2en` |
| polish_en | `polish_en` |
| logic_check | `logic_check` |
| 其他/无 | 拒绝，提示"请先切换到写作相关阶段" |

## 斜杠命令

| 命令 | action | 说明 |
|------|--------|------|
| `/polish` | `polish_en` | 英文润色 |
| `/cn` | `polish_cn` | 中文润色 |
| `/translate` | `translate_cn2en` | 中译英 |
| `/logic` | `logic_check` | 逻辑检查 |
| `/deai` | `de_ai` | 去AI味 |

## Prompt 清单（全部来自 awesome-ai-research-writing）

| action | 文件 | 来源 |
|--------|------|------|
| `polish_en` | `polish_en.md` | 表达润色（英文论文） |
| `polish_cn` | `polish_cn.md` | 中转中-word |
| `translate_cn2en` | `translate_cn2en.md` | 中转英-word |
| `logic_check` | `logic_check.md` | 逻辑检查 |
| `de_ai` | `de_ai.md` | 去AI味-Word |

## 实施步骤

- [ ] **Step 1**: 创建 `polish_en.md` prompt，完善 `ai_action` 后端 → 自动路由 + 斜杠映射
- [ ] **Step 2**: 废弃 `polish_text` 命令，Cleanup
- [ ] **Step 3**: ChatPanel 加斜杠命令输入 + 当前阶段提示
- [ ] **Step 4**: 更新右键菜单选项 + 流水线按钮
- [ ] **Step 5**: 构建测试
