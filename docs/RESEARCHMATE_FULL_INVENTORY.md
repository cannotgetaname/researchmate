# ResearchMate v0.3.0 — 功能全量清单

> 2026-05-25 | 重构前基线文档 | 供 LaTeX 路线决策审查

---

## 一、技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 6 |
| 编辑器 | **TipTap 3.23** (ProseMirror) — 富文本 |
| 后端 | **Tauri v2** + Rust |
| 数据库 | SQLite (WAL) via rusqlite |
| LLM | DeepSeek API (async-openai + reqwest 手动 SSE) |
| 导出 | Pandoc 3.6.4 (自动下载) + python-docx 模板 |
| 版本 | Git (git2 crate) |
| 嵌入 | Ollama / OpenAI 兼容 API |
| PDF | Rust lopdf / PyMuPDF / OpenDataLoader |
| 公式 | KaTeX 实时渲染 |

---

## 二、前端组件

| 组件 | 文件 | 职责 |
|---|---|---|
| **App** | `src/App.tsx` | 5 Tab 路由、项目 CRUD、设置、自动快照(5min) |
| **TopNav** | `src/components/TopNav.tsx` | 项目选择、阶段标签、设置/关于 |
| **EditorPanel** | `src/components/EditorPanel.tsx` | TipTap 编辑器 + 右键菜单 + 浮动栏 + 题注弹窗 |
| **EditorToolbar** | `src/components/EditorToolbar.tsx` | 格式/字体/字号/对齐/插入/导出按钮 |
| **ChatPanel** | `src/components/ChatPanel.tsx` | AI 对话 + 斜杠命令 + 引用建议卡 |
| **DocumentPanel** | `src/components/DocumentPanel.tsx` | KB 管理 + 文献上传 + 搜索 + RAG |
| **VersionPanel** | `src/components/VersionPanel.tsx` | Git 分支/版本/diff/tag |
| **WritingPipeline** | `src/components/WritingPipeline.tsx` | 7 阶段流水线手风琴 |
| **StatusBar** | `src/components/StatusBar.tsx` | 字数/AI状态/保存时间 |
| **useStreamChat** | `src/hooks/useStreamChat.ts` | 流式聊天 hook，统一 `streamAiAction` |

---

## 三、后端命令（61 个）

### 写作模块 (`commands/writing.rs`)
| 命令 | 用途 |
|---|---|
| `create_session` | 创建对话会话 |
| `list_sessions` | 列出会话 |
| `save_message` / `delete_message` / `get_messages` | 消息 CRUD |
| `get_config` / `save_config` | 配置读写 |
| `list_projects` / `create_project` / `delete_project` | 课题管理 |
| **`ai_action`** | **统一 AI 入口**：自动路由/斜杠命令/显式 action |
| `init_stages` / `get_stages` / `update_stage` | 流水线阶段管理 |

### 文献模块 (`commands/literature/`)
| 命令 | 用途 |
|---|---|
| `upload_document` | PDF 上传 + 元数据提取 + 分块 + 嵌入 |
| `search_knowledge` | 语义搜索 + BM25 混合 |
| `ask_knowledge` | RAG 知识问答 |
| `get_documents` / `delete_document` | 文献管理 |
| `list_knowledge_bases` / `create_knowledge_base` / `delete_knowledge_base` | KB CRUD |
| `link_kb_to_project` / `unlink_kb_from_project` | KB 关联 |
| `check_citations` | 引用检查 |
| `extract_citations` / `extract_citations_ai` / `extract_citations_doi` | 引文提取 |
| `extract_paper_structure` / `extract_paper_structure_ai` | 论文结构 |

### 导出 (`commands/export.rs`)
| 命令 | 用途 |
|---|---|
| `export_document` | Pandoc → DOCX/PDF/HTML |
| `preview_html` | Pandoc HTML 预览 |
| `generate_template` / `generate_template_advanced` | reference.docx 模板 |

### 版本 (`commands/version.rs`)
| 命令 | 用途 |
|---|---|
| `git_init` / `save_version` / `list_versions` / `get_version` | 版本管理 |
| `delete_version` / `diff_versions` | 删除/对比 |
| `list_branches` / `create_branch` / `switch_branch` / `delete_branch` | 分支 |
| `set_version_tag` / `get_version_tags` / `remove_version_tag` | 标签 |
| `auto_snapshot` | 自动快照 |

### 其他
| 命令 | 用途 |
|---|---|
| `save_draft` / `load_draft` | 草稿持久化 |
| `chat_with_tools` | Tool-calling Agent |
| `set_session_kbs` / `get_session_kbs` | 会话 KB 关联 |
| `read_image_as_data_url` | 本地图片 → base64 |

---

## 四、TipTap 扩展

### 内置扩展
| 扩展 | 来源 | 用途 |
|---|---|---|
| StarterKit | `@tiptap/starter-kit` | bold/italic/strike/code/heading/list/blockquote/codeBlock/hr/hardBreak/history |
| Table + Row/Cell/Header | `@tiptap/extension-table` | 表格（三线表 CSS） |
| Placeholder | `@tiptap/extension-placeholder` | 编辑器占位文字 |
| Image | `@tiptap/extension-image` | 图片插入 |
| Highlight | `@tiptap/extension-highlight` | 文字高亮 |
| TextAlign | `@tiptap/extension-text-align` | 对齐 |
| Subscript / Superscript | `@tiptap/extension-*` | 上下标 |
| TextStyle | `@tiptap/extension-text-style` | 文本样式（其他扩展依赖） |
| FontSize | `@tiptap/extension-text-style` | 字号 |
| FontFamily | `@tiptap/extension-text-style` | 字体 |

### 自定义扩展
| 扩展 | 文件 | 用途 |
|---|---|---|
| **MathInline** / **MathBlock** | `src/components/MathExtension.tsx` | KaTeX 实时渲染，`$...$` / `$$...$$` 输入规则 |
| **Caption** | `src/components/CaptionExtension.tsx` | 图/表题注（图N: / 表N:），可编辑文字，不可编辑前缀 |
| **CaptionRenumber** | 同上 | auto-renumber plugin + CrossRef _sync bump |
| **CrossRef** | `src/components/CrossRefExtension.tsx` | 图/表交叉引用节点（"图3"），点击跳转 |
| **CitationRef** | 同上 | 参考文献引用节点（"[1,3]"），hover 显示标题 |
| **CitationRenumber** | 同上 | 引用编号自动分配 plugin |
| **SelectionBubble** | EditorPanel 内联 | 选中浮动迷你格式栏（B/I/U/S/code/highlight） |
| **contextmenu handler** | EditorPanel 内联 | 右键菜单（复制/剪切/粘贴 + AI 操作 7 项） |

### CSS 定制
- 三线表样式（`border-top/bottom: 2px` + `border-bottom: 1px` on th）
- 题注居中 14px
- sup 行距修复 (`line-height: 0`)
- 字体回退链（TNR → SimSun → serif）

---

## 五、数据库表（13 张）

| 表 | 用途 |
|---|---|
| `project` | 课题 |
| `session` | 对话会话 |
| `message` | 对话消息 |
| `document` | 文献元数据 |
| `doc_chunk` | 文献分块 + 向量 |
| `citation` | 引文信息 |
| `cross_paper_link` | 文献间引用关系 |
| `literature_comparison` | 文献对比 |
| `paper_structure` | 论文章节结构 |
| `knowledge_base` | 知识库 |
| `kb_document` | KB-文献关联 |
| `project_kb` | 课题-KB 关联 |
| `session_kb` | 会话-KB 关联 |
| `settings` | 键值配置 |
| **`writing_stage`** | **流水线阶段** |

---

## 六、Prompt 文件（6 套，全部来自 awesome-ai-research-writing）

| 文件 | action | 用途 |
|---|---|---|
| `prompts/polish_en.md` | `polish_en` | 英文论文深度润色 |
| `prompts/polish_cn.md` | `polish_cn` | 中文论文润色 |
| `prompts/translate_cn2en.md` | `translate_cn2en` | 中→英翻译 |
| `prompts/logic_check.md` | `logic_check` | 逻辑检查 |
| `prompts/de_ai.md` | `de_ai` | 去 AI 味 |
| `prompts/writing_polish.md` | (废弃) | 旧版润色 prompt |

---

## 七、AI 操作管线

### 入口
```
斜杠命令 /polish          → 显式 action
右键菜单 "AI润色"         → __ACTION__auto__ → 阶段自动路由
右键菜单 "中译英"          → __ACTION__translate_cn2en__
流水线按钮                 → __ACTION__xxx__
ChatPanel 直接打字         → ai_action(action=null) → 阶段自动路由
```

### 后端路由 (`ai_action` in `writing.rs:57`)
```
action 参数:
  null + 有 project_id  → 查 writing_stage → stage_default_action()
  "/xxx"                → SLASH_ACTIONS 映射表
  显式字符串             → 直接用

SLASH_ACTIONS:
  /polish   → polish_en      /cn       → polish_cn
  /translate → translate_cn2en  /logic  → logic_check
  /deai     → de_ai

stage_default_action:
  draft_cn    → polish_cn     translate → translate_cn2en
  polish_en   → polish_en     logic_check → logic_check
  其他        → 拒绝，提示设置阶段
```

---

## 八、npm 依赖

| 包 | 用途 |
|---|---|
| `@tiptap/react` `@tiptap/starter-kit` | 富文本编辑器 |
| `@tiptap/extension-table` 系列 | 表格 |
| `@tiptap/extension-text-style` | 文字样式（FontSize/FontFamily） |
| `@tiptap/extension-placeholder` 等 | 占位/高亮/对齐/上下标 |
| `@tiptap/extension-image` `@tiptap/extension-link` | 图片/链接 |
| `katex` | LaTeX 公式实时渲染 |
| `marked` | Markdown→HTML（旧草稿迁移） |
| `react-markdown` `remark-gfm` | ChatPanel 消息渲染 |
| `@tauri-apps/api` `@tauri-apps/plugin-dialog/opener/updater` | Tauri |
| `echarts` `echarts-for-react` | （预留，未使用） |
| `react` `react-dom` | 框架 |

---

## 九、关键数据流

### 草稿存取
```
保存: EditorPanel onUpdate → editor.getJSON() → onChange(JSON) 
      → App content state → debounced invoke("save_draft")

加载: App content 变化 → EditorPanel useEffect 
      → invoke("load_draft") → JSON.parse 尝试
      → 成功: setContent(JSON)  |  失败: markdownToHtml 回退
```

### 引用插入
```
ChatPanel 引用建议卡 → 点击"插入引用" 
→ onInsertCitation({docIds, key, title}) 
→ App setCitationInsert(data) 
→ EditorPanel useEffect → insertContent({type:"citationRef", attrs:{...}})
→ citationNumberPlugin 自动分配编号
```

### AI 操作流式
```
任何入口 → ai_action(action, text, project_id)
→ 选 prompt → LlmEngine.chat_stream_thinking()
→ 发射 polish-stream / polish-stage 事件
→ ChatPanel useStreamChat 监听 → 实时渲染
→ saveExchange() 持久化
```

### 交叉引用编号同步
```
增删图/表 → captionRenumberPlugin.appendTransaction
→ 重新编号 caption 节点 → bump CrossRef._sync
→ CrossRef NodeView 重新读取 caption number → 显示更新
```

---

## 十、LaTeX 迁移影响范围

### 保留（直接可用）
- Tauri 壳、课题系统、流水线、文献 KB
- AI 操作管线（prompt 本身就是 LaTeX 导向的）
- Git 版本控制
- 斜杠命令、ChatPanel 流式交互
- 设置/配置

### 替换
| 现在 | 换成 |
|---|---|
| TipTap + 6 个自定义扩展 | Monaco LaTeX 模式 |
| ProseMirror JSON 存储 | `.tex` 纯文本 |
| KaTeX 节点渲染 | 全文 KaTeX 预览 |
| Pandoc markdown→DOCX | tectonic PDF 编译 |
| 三线表 CSS | `\toprule` `\midrule` `\bottomrule` |
| Caption 节点 + CrossRef 节点 | `\caption{}` + `\label{}` + `\ref{}` |
| CitationRef 节点 | `\cite{}` |
| MathInline / MathBlock | 原生 `$...$` / `$$...$$` |
| `migrateLatexInDoc()` 扫描函数 | 不需要（就是 LaTeX） |

### 删除（不再需要）
- 所有自定义 TipTap 扩展文件（Math/Caption/CrossRef/FontSize）
- `captionRenumberPlugin` / `citationNumberPlugin`（LaTeX 引擎处理）
- `marked` 依赖（不需要 markdown→HTML 迁移）
- `katex` → 改为编译引擎渲染
- `insertContent` / `editor.commands` 复杂链式操作
- 导出管线中 HTML 格式检测逻辑

### 工作量
| 任务 | 预计 |
|---|---|
| Monaco → LaTeX 模式 | 2h |
| tectonic 集成 | 2h |
| PDF 预览面板 | 2h |
| 清理 TipTap 代码 | 2h |
| 测试 + 调试 | 1天 |
| **总计** | **2-3天** |
