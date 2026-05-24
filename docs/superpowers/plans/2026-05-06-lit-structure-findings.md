# 文献结构化解析 — 开源工具调查报告

> **调查日期**: 2026-05-06 | **结论**: 减少 60%+ 的自行开发量

---

## 1. 按能力维度逐一分析

### Phase A: PDF 结构提取

| 工具 | 类型 | 集成方式 | 亮点 | 致命问题 | 结论 |
|------|------|----------|------|----------|------|
| **GROBID** (7k⭐) | Java HTTP 服务 | Docker / REST API | 最准确，提取章节+引用+图表 | 需要 Java 17 + 2-4GB 内存，必须跑服务进程 | ❌ 桌面应用不适合 |
| **Science Parse** (600⭐) | Java 库 | 命令行 / Java | JSON 输出 | 维护少，仍依赖 Java | ❌ 同上 |
| **pymupdf `get_toc()`** | Python | `pip install pymupdf` | **我们已经在用！** | TOC 只能提取标题层级，不能标注角色 | ✅ **已有的宝藏，没挖完** |
| **pdfplumber** (7k⭐) | Python | pip | 表格提取好 | pymupdf 更快，我们已有 | ❌ 冗余 |

**关键发现**：pymupdf 有 `doc.get_toc()` 方法可以**免费、瞬间**提取论文的章节树（1→1.1→1.1.1），输出格式：

```python
# pymupdf TOC 输出:
[1, "1. Introduction", 1],          # level, title, page
[2, "1.1 Background", 2],
[2, "1.2 Related Work", 3],
[1, "2. Methodology", 4],
[2, "2.1 Model Architecture", 4],
...
```

**这意味着 Phase A 的方案可以大幅简化**：pymupdf 提取结构树（免费、即时、离线），再用 LLM 只在每个节点上标注 role（claim/evidence/method/gap），而不需要 LLM 去读全文找章节边界。

LLM token 消耗从「全文 15K tokens」降到「章节标题列表 500 tokens + 每节摘要 200 tokens × 10 节 ≈ 2.5K tokens」。**节省 ~80% 费用**。

---

### Phase B: 篇内逻辑关系

**结论：没有任何开源工具能做这个。** 段落间的逻辑关系（A 支撑 B、C 质疑 D）是高级语义理解，超出了现有 NLP 模型（包括 scispaCy）的能力范围。必须用 LLM。

scispaCy（Allen AI）能做科学实体识别（基因名、化学物），但对「claim/evidence/supports/contradicts」这种学术论证结构无能为力。

→ **Phase B 纯 LLM，无可替代。**

---

### Phase C: 跨篇关联

| 工具 | 集成方式 | 能力 | 限制 | 结论 |
|------|----------|------|------|------|
| **Semantic Scholar API** | REST，免费，无需 key | 查论文引用关系（A 引用了 B，C 引用了 A） | 需要网络；100 次/5min（无 key），100 次/秒（有 key） | ✅ **直接可用** |
| **OpenAlex API** | REST，完全开放，无限制 | 同上 + 主题分类 | 数据质量略低于 S2 | ✅ 备选 |
| **CrossRef API** | REST，免费 | DOI → 元数据 | 不比 S2 好 | 🟡 辅助 |
| **OpenCitations** | REST | 引文网络数据 | 覆盖不如 S2 | 🟡 辅助 |

**关键发现**：论文 A 引用了论文 B、论文 B 被哪些论文引用——这是结构性数据，不需要 LLM 猜测。Semantic Scholar 免费 API 直接返回。只需要传入论文标题或 DOI。

流程：用户选两篇论文 → 查 Semantic Scholar API 获得引用关系 → LLM **只做内容层面的对比分析**（结论是否矛盾、方法是否互补）。

→ **Phase C 可以砍掉 50% LLM 调用**，用 API 替代。

---

### Phase D: 主题索引 + 引用注册

| 工具 | 能力 | 结论 |
|------|------|------|
| OpenAlex `topics` 字段 | 论文已标注的主题分类 | ✅ 免费直接用 |
| Semantic Scholar `fieldsOfStudy` | 研究领域标签 | ✅ 比 OpenAlex 更细粒度 |
| pymupdf + LLM 关键词提取 | 自定义主题词 | ✅ 补充上面两个 |

引用注册（citation 表）可以通过 Semantic Scholar API 批量解析——输入论文标题列表，返回每篇的完整元数据（作者、年份、期刊、摘要）。

---

## 2. 修订后的实施方案

```
Phase A  ─── pymupdf TOC 提取结构树（免费、即时）
                ↓
           LLM 只做 role 标注（省 80% token）
                ↓
           paper_structure 表

Phase B  ─── LLM 全量（无替代方案）
                ↓
           paper_logic_link 表

Phase C  ─── Semantic Scholar API 获取引用关系（免费、准确）
                ↓
           LLM 只做内容对比（省 50% token）
                ↓
           cross_paper_link + literature_comparison

Phase D  ─── Semantic Scholar / OpenAlex 获取主题和元数据
                ↓
           paper_topic + citation 表
```

## 3. 资源估算（修订后）

| Phase | 原方案 LLM 成本/篇 | 修订后 LLM 成本/篇 | 节省 |
|-------|-------------------|-------------------|------|
| A | ~¥0.08 | ~¥0.02 | **75%** |
| B | ~¥0.05 | ~¥0.05 | — |
| C | ~¥0.12 | ~¥0.06 | **50%** |
| D | ~¥0.03 | ~¥0.00 (API 免费) | **100%** |

## 4. 最终建议

1. **Phase A**: 改方案——先跑 `pymupdf.get_toc()` 提取结构，再让 LLM 标注 role。pymupdf 已安装，零新增依赖。
2. **Phase B**: 纯 LLM，无替代。不改方案。
3. **Phase C**: 加 Semantic Scholar API 调用。`minreq::get("https://api.semanticscholar.org/...")` 即可。离线时降级为纯 LLM 模式。
4. **Phase D**: 加 Semantic Scholar / OpenAlex API。引用注册通过 API 批量解析。

**新增依赖**：0 个。pymupdf 已有，Semantic Scholar API 是 HTTP 调用（Rust 的 `minreq` 已在 Cargo.toml）。

**去掉的依赖**：无。没有引入 GROBID/Java/Docker 等问题。
