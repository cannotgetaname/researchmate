version: alpha
name: ResearchMate
description: 研究生专属桌面端 AI 科研伙伴——集成"师兄/师姐"体验，覆盖完整研究周期。
---

## 零、核心哲学

ResearchMate 是**人与 AI 协作的工具**，不是 AI 替代人干活的偷懒神器。AI 定位是"经验丰富的师兄/师姐"——给出建议、解释原因、提出问题、推动思考，但**人永远是作者和决策者**。

两条硬规则：

1. **先展示推理过程，再给出结果。**每次内容生成操作都先通过时间线色标暴露思考阶段（思考中 → 查文献 → 阅读中 → 编辑中 → 完成）。只在用户明确要求时才输出可复制文本。
2. **AI 活动按角色分类追踪。**每笔操作都记录 AI 是 `advisor`（给了建议，人自己写）还是 `copilot`（经允许后直接生成内容）。学术合规声明据此生成。

全程贯穿：**透明、教导式**伙伴定位——解释"为什么这样建议"而不只给结论。

## 一、总体架构

```
ResearchMate 桌面应用（Tauri v2）

Rust 后端（Tauri 主进程）
  ├── LLM 引擎 — DeepSeek API（async-openai）
  ├── 向量库 — Qdrant（嵌入模式，本地运行）
  ├── 文档库 — SQLite（课题、会话、提示词、设置）
  ├── PDF 解析 — pdf-extract / lopdf
  ├── Python 子进程 — 可选，仅数据分析模块需要跑代码时用
  └── Tauri IPC 接口层

React/TypeScript 前端（系统 WebView）
  ├── Monaco Editor — 论文编辑器（左侧主工作区）
  ├── AI 对话面板 — 聊天 + @命令 + 模块切换（右侧副面板）
  ├── 划词弹出菜单 — 润色 / 解释 / 引用检查
  └── 图表渲染 — ECharts

通信方式：
  ├── IPC（invoke/command）— 前端调用 Rust 后端
  ├── Event（emit/listen）— Rust 推送流式 AI 响应到前端
  └── 文件系统 API — PDF 上传、CSV 导入、课题导出
```

构建产物：单一二进制文件。双击启动，IDE 风格的独立桌面窗口。

## 二、前端布局与 DESIGN.md 适配

### 2.1 整体布局

```
┌──────────────────────────────────────────────────────────┐
│ 顶部导航（64px，canvas 底色）                             │
│ [ResearchMate]          课题：博士论文    [设置] [关于]   │
├────────────────────────────────┬─────────────────────────┤
│ 主工作区（60%）                │ AI 伙伴面板（40%）      │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │ ┌─────────────────────┐ │
│ │ [写作][数据][文献][管理]  │  │ │ 模块标签             │ │
│ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│  │ │ @write @data @lit... │ │
│ │                            │  │ ├─────────────────────┤ │
│ │  Monaco Editor             │  │ │                      │ │
│ │  论文/笔记编辑             │  │ │  对话历史             │ │
│ │                            │  │ │  - AI 回答           │ │
│ │                            │  │ │  - 流式逐字输出      │ │
│ │                            │  │ │                      │ │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │ ├─────────────────────┤ │
│                                │ │ [输入框......] @ [→] │ │
│                                │ └─────────────────────┘ │
├────────────────────────────────┴─────────────────────────┤
│ 状态栏：字数：1280 | AI：就绪 | 上次保存：3秒前          │
└──────────────────────────────────────────────────────────┘
```

### 2.2 DESIGN.md 色彩映射

| DESIGN.md Token | ResearchMate 中的用途 |
|---|---|
| `canvas` (#f7f7f4) | 编辑器底色、对话面板底色 |
| `surface-card` (#ffffff) | 划词弹出菜单、下拉面板 |
| `ink` (#26251e) | 正文、标题 |
| `primary` (#f54e00) | 发送按钮、@命令高亮、划词操作按钮 |
| `hairline` (#e6e5e0) | 面板分割线、输入框边框 |
| timeline 五色 pastel | AI 动作状态指示（思考中 / 检索中 / 阅读中 / 编辑中 / 完成） |

### 2.3 核心交互

- **划词菜单**：在 Monaco 中选中文字 → 弹出 `surface-card` 浮动面板（润色 / 解释 / 引用检查 / 续写）
- **@命令**：输入框输入 `@write` 切写作模式，`@data` 切数据分析，`@lit` 切文献模式，`@plan` 切项目管理
- **模块标签**：点击 AI 面板上方标签切换功能模式
- **流式输出**：AI 回复逐 token 打印，当前 timeline pill 显示所处阶段色

### 2.4 字体策略

DESIGN.md 指定 CursorGothic（商业授权）+ JetBrains Mono（代码）。ResearchMate 使用：
- **界面文字**：Inter（CursorGothic 的开源替代，weight 400，letter-spacing -1.5%）
- **编辑器与代码**：JetBrains Mono

## 三、后端模块架构

```
src/
├── main.rs              — Tauri 入口，注册所有 commands
├── commands/            — Tauri IPC 处理器
│   ├── writing.rs       — 写作与润色
│   ├── analysis.rs      — 数据分析
│   ├── literature.rs    — 文献与知识库
│   ├── project.rs       — 项目管理
│   └── compliance.rs    — 学术合规
├── llm/                 — LLM 引擎
│   ├── mod.rs           — 统一入口
│   ├── prompts/         — 各模块 System Prompt 模板（.md 文件）
│   └── agent.rs         — 多轮对话编排、工具调用
├── knowledge/           — 向量库与文档处理
│   ├── mod.rs           — Qdrant 封装
│   ├── embedding.rs     — 文本向量化（DeepSeek embedding API）
│   ├── pdf.rs           — PDF 解析
│   └── chunker.rs       — 文档切片策略
├── db/                  — SQLite 持久化
│   ├── mod.rs           — 连接管理
│   ├── models.rs        — 数据模型（rusqlite FromRow）
│   └── migrations.rs    — 表结构迁移
└── config.rs            — 设置管理（API Key、模型选择）
```

### 3.1 五大模块对应实现方式

| 模块 | 后端实现 |
|---|---|
| 写作与润色 | `llm/prompts/writing/*.md` 存放分层 System Prompt（语法、顶刊风、逻辑批判等） |
| 数据分析 | 分析思路 + 报错解答靠 LLM Prompt；代码执行靠可选 Python 子进程 |
| 文献与知识库 | `knowledge/` 提供 PDF 上传→切片→向量化→检索全套管线；Qdrant 嵌入模式本地运行 |
| 项目管理 | `db/` 持久化课题、小节清单、进度；界面由 SQLite 状态驱动 |
| 学术合规 | 前端侧栏常驻提醒 + LLM System Prompt 注入规则 + 基于正则的脱敏扫描 |

### 3.2 分层调用原则

```
前端调 Tauri command
  → command 层组装 System Prompt
  → llm/ 引擎调用 DeepSeek API
  → knowledge/ 处理 RAG 检索（按需）
  → db/ 读写历史记录
  → 流式返回前端
```

## 四、数据模型

### 4.1 SQLite 表结构

```sql
-- === 核心 ===
CREATE TABLE project (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE session (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    module      TEXT NOT NULL,       -- writing, analysis, literature, project_mgmt
    title       TEXT,                -- 自动生成的摘要标题
    created_at  TEXT NOT NULL
);

CREATE TABLE message (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES session(id),
    role        TEXT NOT NULL,       -- user, assistant, system
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- === 模块1：写作 ===
CREATE TABLE journal_profile (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    name        TEXT NOT NULL,       -- "Nature", "IEEE TPAMI"
    style_notes TEXT,                -- LLM 生成的风格特征摘要
    created_at  TEXT NOT NULL
);

-- === 模块2：数据分析 ===
CREATE TABLE dataset (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    filename    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    columns     TEXT,                -- JSON：列名 + 类型
    row_count   INTEGER,
    description TEXT,                -- 用户自然语言描述
    created_at  TEXT NOT NULL
);

CREATE TABLE artifact (             -- 图表、生成代码、报告等生成物
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    session_id  TEXT REFERENCES session(id),
    type        TEXT NOT NULL,       -- chart, code, report, table
    filename    TEXT,
    file_path   TEXT,
    description TEXT,
    created_at  TEXT NOT NULL
);

-- === 模块3：文献与知识库 ===
CREATE TABLE document (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    filename    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'pending',  -- pending, processing, ready, error
    created_at  TEXT NOT NULL
);

-- 论文结构化索引（逐段标注）
CREATE TABLE paper_structure (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES document(id),
    parent_id   TEXT REFERENCES paper_structure(id),
    tag         TEXT NOT NULL,       -- section, subsection, paragraph
    role        TEXT,                -- claim, evidence, method, hypothesis, result, gap
    heading     TEXT,                -- 节标题，如 "3.2 鲁棒性分析"
    summary     TEXT,                -- LLM 预生成的段落摘要
    start_char  INTEGER,
    end_char    INTEGER,
    ordering    INTEGER NOT NULL
);

-- 篇内逻辑关系（段落A支撑/质疑段落B）
CREATE TABLE paper_logic_link (
    id           TEXT PRIMARY KEY,
    document_id  TEXT NOT NULL REFERENCES document(id),
    from_node    TEXT NOT NULL REFERENCES paper_structure(id),
    to_node      TEXT NOT NULL REFERENCES paper_structure(id),
    relation     TEXT NOT NULL,      -- supports, contradicts, extends, questions, gap
    description  TEXT
);

-- 跨篇论文关系
CREATE TABLE cross_paper_link (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    source_doc  TEXT NOT NULL REFERENCES document(id),
    target_doc  TEXT NOT NULL REFERENCES document(id),
    relation    TEXT NOT NULL,       -- cites, supports, contradicts, extends, replicates
    context     TEXT,                -- 来源论文中具体怎么说的
    confidence  REAL
);

-- 论文主题索引（哪篇论文讨论哪个主题）
CREATE TABLE paper_topic (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES document(id),
    topic       TEXT NOT NULL,       -- "鲁棒性优化", "碳排放测算"
    frequency   REAL,                -- 该主题在文中的比重
    key_section TEXT                 -- 相关段落索引
);

-- 注册的参考文献条目
CREATE TABLE citation (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    document_id TEXT REFERENCES document(id),
    key         TEXT NOT NULL,       -- "Smith 2020", "Zhang et al. 2019"
    title       TEXT,
    abstract    TEXT,                -- LLM 生成的要点摘要
    claims      TEXT,                -- JSON：该文献的核心论断列表
    created_at  TEXT NOT NULL
);

-- 文稿中待确认的引用建议
CREATE TABLE draft_citation_hint (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    sentence    TEXT NOT NULL,       -- 文稿中的原文句子
    citation_id TEXT REFERENCES citation(id),
    confidence  REAL,
    status      TEXT DEFAULT 'pending',  -- pending, accepted, dismissed
    created_at  TEXT NOT NULL
);

-- 文献对比/综述产出
CREATE TABLE literature_comparison (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    title       TEXT,
    content     TEXT NOT NULL,       -- LLM 生成的对比表格/综述（Markdown）
    doc_ids     TEXT NOT NULL,       -- JSON：参与对比的 document_id 列表
    created_at  TEXT NOT NULL
);

-- === 模块4：项目管理 ===
CREATE TABLE writing_task (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    section     TEXT NOT NULL,       -- 节标题
    status      TEXT DEFAULT 'todo', -- todo, in_progress, done
    est_minutes INTEGER,             -- 预估耗时（分钟）
    created_at  TEXT NOT NULL
);

CREATE TABLE experiment_design (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    title       TEXT NOT NULL,
    hypothesis  TEXT,                -- 研究假设
    iv_list     TEXT,                -- JSON：自变量
    dv_list     TEXT,                -- JSON：因变量
    cv_list     TEXT,                -- JSON：控制变量
    confounds   TEXT,                -- LLM 识别的混淆因素
    procedure   TEXT,                -- 实验流程（Markdown）
    pitfalls    TEXT,                -- LLM 预警的陷阱列表
    status      TEXT DEFAULT 'draft',
    created_at  TEXT NOT NULL
);

-- === 模块5：学术合规 ===
CREATE TABLE ai_activity (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES project(id),
    session_id  TEXT REFERENCES session(id),
    module      TEXT NOT NULL,       -- writing, analysis, literature, project_mgmt
    action      TEXT NOT NULL,       -- polish, generate, analyze, review, suggestion
    role_type   TEXT NOT NULL,       -- advisor（给建议，人自己写）或 copilot（经允许直接生成）
    scope       TEXT,                -- 涉及的文字范围或操作摘要
    created_at  TEXT NOT NULL
);

-- === 全局 ===
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### 4.2 Qdrant 向量存储

```
Collection: "knowledge_{project_id}"
  ├── 每篇文档的每个切片 = 一个 point
  └── Point payload: {doc_id, filename, chunk_index, text_preview}
```

### 4.3 文件存储结构

```
~/.researchmate/
├── data.db              — SQLite 数据库
├── qdrant/              — Qdrant 嵌入模式数据
├── projects/
│   └── {project_id}/
│       └── files/       — 上传的 PDF、CSV、生成的图表
└── config.json          — API Key、模型选择等设置
```

## 五、跨模块查询能力

| 用户问 | 查询策略 |
|---|---|
| "这篇论文的论证结构是什么？" | 遍历 paper_structure 树，按 role 汇总：假设→方法→证据→结论 |
| "3.1 节的方法和 3.2 节的实验对得上吗？" | 查 paper_logic_link 中 method 节点与 experiment 节点的 supports/contradicts 关系 |
| "哪些段落论据薄弱？" | LLM 扫描 role=evidence 的段落，与 role=claim 的断言对比，指出支撑不足 |
| "作者漏了什么？" | 遍历 paper_logic_link 中 relation=gap 的记录 |
| "我这批文献里，谁支持 A 假说、谁反对了？" | 查 paper_topic 找涉及 A 假说的论文 → 逐篇查 paper_structure 的 evidence role → 汇总 |
| "B 和 C 两篇论文结论矛盾吗？" | 分别查各篇 paper_structure 的结论段 → 查 cross_paper_link 中 contradicts 关系 |
| "D 论文引用 E 论文的哪部分？" | 直接查 cross_paper_link |
| "这句话像是出自论文 F——需要标注引用吗？" | Qdrant 语义相似度 + paper_structure.summary 匹配 → 返回 document_id + 段落位置 |
| "我还应该读什么来填补研究空白？" | 汇总 paper_logic_link.gap + cross_paper_link 空白 → 建议切入点 |

## 六、开发阶段

```
阶段1  ██░░░░░░░░  骨架 + 写作模块
       ├── Tauri + React + Rust 工程骨架
       ├── Monaco Editor 论文编辑
       ├── AI 对话面板 + 流式输出
       ├── 基础润色（语法 + 学术风）
       └── SQLite 基础存储
       产出：可以打开、写论文、润色、保存

阶段2  ████░░░░░░  文献与知识库
       ├── PDF 上传 → 切片 → 向量化
       ├── RAG 检索问答
       ├── 论文结构化解析（paper_structure + paper_logic_link）
       ├── 文献对比
       └── 引用检查
       产出：可以用自己的文献集辅助写作

阶段3  ██████░░░░  写作能力深化
       ├── 分层润色（顶刊风、逻辑批判）
       ├── 多模态初稿（提纲→全文、数据→报告）
       ├── @write 命令路由
       └── 划词菜单
       产出：写作模块接近完整

阶段4  ████████░░  数据分析 + 项目管理
       ├── 数据分析思路引导
       ├── 代码生成 + 报错解答
       ├── 图表生成
       ├── 实验方案沙盘
       └── 写作进度看板
       产出：研究全程都有工具覆盖

阶段5  ██████████  合规模块 + 打磨
       ├── 学术诚信侧栏提醒
       ├── 数据脱敏扫描
       ├── AI 辅助声明生成
       ├── 跨模块协同（知识库 → 写作引用）
       └── 打包发布
       产出：全部功能闭环
```

每个阶段结束都是可用的产品。

## 七、技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri v2 |
| 后端语言 | Rust（2024 edition） |
| 前端语言 | TypeScript + React 19 |
| 编辑器 | Monaco Editor（VS Code 核心技术） |
| 界面风格 | Inter 字体 + JetBrains Mono，DESIGN.md 设计体系 |
| LLM 调用 | DeepSeek API，通过 `async-openai`（兼容接口） |
| 向量数据库 | Qdrant（嵌入模式，`qdrant-client`） |
| 关系数据库 | SQLite，通过 `rusqlite` |
| PDF 解析 | `pdf-extract` / `lopdf` |
| 图表（前端） | ECharts |
| 可选 Python | 子进程调用，用于数据分析模块的代码执行 |

## 八、System Prompt 设计原则

所有模块的 System Prompt 遵循以下规则：

1. **角色定位**："经验丰富的师兄/师姐，严谨但不冷漠"
2. **透明原则**：解释"为什么这样建议"，不只给结论
3. **边界意识**：不确定时主动告知，绝不编造
4. **语言**：中文为主，学术术语可中英混合
5. **默认 advisor 模式**：先建议、先解释；只在用户明确要求时才输出可直接复制的文本

### Prompt 骨架示例

**写作——逻辑批判：**
```
你是一位严谨的导师型科研助手。请审阅以下段落：
1. 指出逻辑跳跃或论证薄弱处。
2. 对每个问题给出具体的改进建议或补充方向。
3. 如有必要，反问作者以促使其深入思考。
保持建设性，不贬低。
原文：{text}
```

**数据分析——思路引导：**
```
用户是研究生，描述了以下研究问题。请不要直接给代码：
1. 列出 2-3 种可行的统计方法。
2. 说明每种方法的前提假设和适用条件。
3. 对比优缺点。
4. 询问用户数据是否满足前提条件后再推荐。
问题描述：{question}
```

**文献——空白识别：**
```
基于以下文献的对比分析，请：
1. 列出该领域已充分探讨的方向。
2. 明确指出研究空白或不一致的发现。
3. 建议 1-2 个具有创新潜力的切入点。
文献信息：{literature_summaries}
```
