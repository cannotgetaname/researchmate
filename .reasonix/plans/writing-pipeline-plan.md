# 写作流水线 — 实现计划

## 目标

在管理 Tab 的"写作进度"分栏中，新增手风琴式论文流水线。7 个阶段，每阶段可切换状态，展开后显示 AI 快捷操作。不重构现有架构，复用 LLM 引擎和 ChatPanel。

## 架构决策

- **数据**：新增 `writing_stage` 表，project 级别
- **后端**：3 个新 command（get_stages / update_stage / init_stages）
- **前端**：新组件 `WritingPipeline.tsx`，手风琴折叠
- **AI 操作**：复用现有 `polish_text` 等 command，传不同 prompt
- **不碰**：编辑器、ChatPanel、文献模块

## 阶段 + AI 操作映射

| 阶段 | key | AI 快捷操作 |
|------|-----|------------|
| 文献调研 | `lit_review` | KB 搜索、文献上传 |
| 实验设计 | `experiment` | （暂空） |
| 中文初稿 | `draft_cn` | 中文润色、续写 |
| 中译英 | `translate` | 中→英翻译 |
| 英文润色 | `polish_en` | 英文润色、缩写、扩写 |
| 逻辑检查 | `logic_check` | 逻辑检查、去AI味 |
| 投稿格式 | `formatting` | 导出 DOCX、模板 |

## 阶段

- [ ] **Step 1**: 数据库 — writing_stage 表 + Rust 模型
- [ ] **Step 2**: 后端命令 — init/get/update stages
- [ ] **Step 3**: 创建 WritingPipeline 组件（手风琴 UI）
- [ ] **Step 4**: 集成到 App.tsx 管理 Tab + 注册 command
- [ ] **Step 5**: 构建测试
