# 文献结构化解析 + 对比 — 实施计划 v2

> **Goal**: 论文章节提取、参考文献解析、跨论文引用匹配、LLM 语义增强。
> **原则**: 离线优先，正则为主，LLM 可选。三种 PDF 引擎输出统一管线。
> **Created**: 2026-05-06 | **Updated**: 2026-05-06 | **Status**: approved

---

## 总体架构

```
PDF 文本 (chunks) — 任何引擎都产出
    │
    ├─ Phase A-basic: 章节结构提取（正则，离线）
    │      └─ paper_structure 表 (tag + heading, 无 role)
    │
    ├─ Phase D: 参考文献提取（正则，离线）
    │      └─ citation 表 (key + title)
    │
    ├─ Phase C-basic: 跨论文引用匹配（字符串匹配，离线）
    │      └─ cross_paper_link 表 (cites / no_cite)
    │
    ├─ 离线分界线 ─────────────────────────────
    │
    ├─ Phase A-enhance: LLM role 标注（需 API）
    │      └─ paper_structure.role + summary 字段填充
    │
    ├─ Phase B: LLM 篇内逻辑关系（需 API）
    │      └─ paper_logic_link 表
    │
    └─ Phase C-enhance: LLM 内容对比（需 API）
           └─ literature_comparison 表
```

**核心原则**:
1. 离线部分（A-basic + D + C-basic）= 全部正则 + 字符串匹配，零依赖
2. LLM 部分（A-enhance + B + C-enhance）= 可选，需 API + 联网开关
3. 所有结果持久化到 SQLite，下次打开秒出
4. "重新分析"按钮覆盖旧数据
5. 设置里两个独立开关：`允许联网查询（使用 DeepSeek API）` + `允许查询外部数据库（Semantic Scholar）`

---

## Phase A-basic: 论文章节结构提取 [离线]

### 目标
从论文 chunk 文本中用正则提取章节层级树，写入 `paper_structure` 表。

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS paper_structure (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES document(id),
    parent_id   TEXT,
    tag         TEXT NOT NULL,       -- 'section' | 'subsection' | 'subsubsection'
    heading     TEXT NOT NULL,       -- 节标题
    role        TEXT,                -- NULL initially, filled by Phase A-enhance
    summary     TEXT,                -- NULL initially, filled by Phase A-enhance
    ordering    INTEGER NOT NULL
);
```

### 后端逻辑 (`extract_paper_structure`)

```
1. 从 doc_chunk 加载所有 chunk（按 chunk_index 排序），拼接成全文
2. 正则匹配章节标题:
   - 模式 1: "1. Introduction" / "2.1 Method" / "1.1.1 Setup"
     regex: ^(\d+(?:\.\d+)*)\s+(.+)$
   - 模式 2: "Abstract" / "Introduction" / "Methodology" / "Conclusion" / "References"
     regex: ^(Abstract|Introduction|Related Work|Methodology|Experiment|Results?|Discussion|Conclusion|References?|Bibliography)\b
   - 模式 3: 中文标题 "一、引言" / "1.1 方法"
     regex: ^[一二三四五六七八九十]+[、．.]\s*(.+)|^\d+(?:\.\d+)*\s+[\u4e00-\u9fff]
3. 根据数字层级确定 parent_id 关系:
   "1" → depth 1, children: "1.1", "1.2"
   "1.1" → depth 2, parent = "1"
4. 每个匹配到的标题生成一个 paper_structure 节点
5. 写入 DB，返回树结构
```

### 前端
- 文献列表每篇加"📊 结构"按钮
- 点击后：如果有缓存 → 直接展示；否则 → 显示"分析中..." → 展示结果
- 展示：可折叠树（用 VersionPanel 的 accordion 风格）
- 节点颜色：灰色（无 role），将来 Phase A-enhance 后会变色
- "重新分析"按钮

### 验证标准
- 上传一篇有标准章节编号的论文，点击"结构"，1 秒内出结果（纯正则）
- 结构树层级正确
- 结论/参考文献/摘要等无编号章节也正确识别

---

## Phase D: 参考文献提取 [离线]

### 目标
从论文全文提取 References 段落中的每一条引用，解析出第一作者+年份+标题。

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS citation (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES document(id),
    key         TEXT NOT NULL,       -- "Smith 2020"
    title       TEXT,                -- 论文标题
    raw         TEXT                 -- 原始引用文本 (调试用)
);
```

### 后端逻辑 (`extract_citations`)

```
1. 从 doc_chunk 加载全文
2. 定位 References 段落:
   - 找到 "References" / "Bibliography" / "参考文献" 标题
   - 取该标题之后的所有文本
3. 按引用条目分割:
   - 模式: [N] ... / [N]↵... (编号引用)
   - 模式: 每行开头是作者名 + 年份的视为新条目开始
4. 每一条目提取:
   - first_author: 第一个 "," 前的文字
   - year: 四位数年份 (19xx|20xx)
   - title: 引号内的文字，或 "." 和 "." 之间的最长句子
5. 存入 citation 表
```

### 前端
- 文献详情面板新增"📎 引用"tab
- 展示该论文引用了哪些文献
- 对每条引用显示: key (Smith 2020) + title
- 如果引用在知识库中有匹配的论文，高亮显示

### 验证标准
- 上传参考文献格式标准的论文，90%+ 的条目正确提取
- key (author year) 正确
- title 大致正确（允许截断）

---

## Phase C-basic: 跨论文引用匹配 [离线]

### 目标
利用 Phase D 提取的 citation 表，自动检测论文之间的引用关系。

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS cross_paper_link (
    id          TEXT PRIMARY KEY,
    source_doc  TEXT NOT NULL REFERENCES document(id),
    target_doc  TEXT NOT NULL REFERENCES document(id),
    relation    TEXT NOT NULL DEFAULT 'cites',
    confidence  REAL DEFAULT 1.0,
    created_at  TEXT NOT NULL
);
```

### 后端逻辑 (`check_cross_references`)

```
1. 加载 source 论文的 citation 列表
2. 加载 target 论文的 title
3. 匹配:
   - 精确: target.title 出现在 source citation[i].title 中 → confidence 1.0
   - 模糊: target.title 的前 5 个词出现在 source citation[i].title 中 → confidence 0.7
   - 作者匹配: source citation[i].key 的作者/年份与 target 的作者/年份匹配 → confidence 0.5
4. 写入 cross_paper_link
```

### 前端
- 文献列表多选 → "检查引用关系"按钮
- 结果：关系列表 "A 引用 B / A 未引用 B"
- 对已有结构标注的论文，高亮显示引用标注的位置

### 验证标准
- 两篇有引用关系的论文，点击检查，正确显示"A 引用 B"
- 两篇无引用关系的论文，显示"未发现引用关系"

---

## Phase A-enhance: LLM role 标注 [需 API]

### 目标
在已有章节结构上，用 LLM 给每个节点标注学术角色。

### 后端逻辑
```
前提: paper_structure 已有 tag + heading (Phase A-basic 产出)
1. 检查联网开关 → 未开启则返回"需要网络连接"
2. 构造 prompt: {节点列表: [heading, 原文前200字], ...}
3. LLM 返回每个节点的 role + summary
4. UPDATE paper_structure SET role=..., summary=... WHERE id=...
```

---

## Phase B: LLM 篇内逻辑关系 [需 API]

Phase A-enhance 完成后，节点有 role 标注 → LLM 识别跨节逻辑关系。
(与原方案基本一致，省略重复描述)

---

## Phase C-enhance: LLM 内容对比 [需 API]

在 C-basic 引用匹配基础上，加 LLM 内容层面的对比综述。
(与原方案基本一致，省略重复描述)

---

## 实施顺序

| # | Phase | 内容 | 离线 | 估时 | 状态 |
|---|-------|------|------|------|------|
| 1 | **A-basic** | 正则提取章节结构 | ✅ | 2h | ← 现在开始 |
| 2 | **D** | 正则提取参考文献 | ✅ | 1.5h | pending |
| 3 | **C-basic** | 字符串匹配跨篇引用 | ✅ | 1h | pending |
| 4 | **A-enhance** | LLM role 标注 | ❌ | 1h | pending |
| 5 | **B** | LLM 篇内逻辑 | ❌ | 1.5h | pending |
| 6 | **C-enhance** | LLM 内容对比 | ❌ | 1h | pending |

---

## 设置开关

```
┌─ 设置 ─────────────────────────────────┐
│  文献元数据                              │
│  ┌────────────────────────────────────┐ │
│  │ ☐ 允许 AI 语义分析（使用 DeepSeek    │ │
│  │   API 进行 role 标注、逻辑分析、     │ │
│  │   内容对比）                         │ │
│  │                                     │ │
│  │ ☐ 允许查询外部数据库（Semantic       │ │
│  │   Scholar，补充引用元数据）          │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

## 测试方式

完成 Phase A-basic + D + C-basic 后：

1. 上传 2 篇 PDF（确保它们互相引用）
2. 点 A 论文的"📊 结构"→ 看结构树是否正确
3. 点 A 论文的"📎 引用"→ 看参考文献列表是否完整，B 是否在其中
4. 选中 A 和 B → 点"检查引用关系"→ 看是否显示"A 引用 B"
5. 进入设置 → 关闭两个联网开关 → 重新测试：确认所有操作仍正常（不报网络错误）
6. 进入设置 → 开启"AI 语义分析"→ 点"重新分析"→ 看节点是否出现 role 标签色
