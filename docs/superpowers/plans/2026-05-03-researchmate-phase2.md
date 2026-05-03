# ResearchMate 阶段 2 实现计划：文献与知识库

> **To agentic workers:** 使用 superpowers:subagent-driven-development 按任务逐个实现。

**目标：** PDF 上传→切片→向量化→RAG 检索问答 + 论文结构化解析（段落角色标注、逻辑关系）+ 文献对比 + 引用检查。

**架构：** 新增 `knowledge/` 模块（PDF 解析、切片策略、向量嵌入、Qdrant 本地集成），新增 `src-tauri/src/commands/literature.rs`（文献上传/检索/结构化/对比/引用建议的 Tauri Commands），前端新增文件上传、文档列表、知识库问答界面。

---

## 任务 1：Qdrant 依赖 + 嵌入模式初始化

**新增依赖：** `qdrant-client`（Rust）、`pdf-extract`、`text-splitter`

在 `Cargo.toml` 添加：
```toml
qdrant-client = "1.12"
pdf-extract = "0.6"
text-splitter = "0.17"
```

## 任务 2：PDF 解析 + 文档切片模块

### src-tauri/src/knowledge/mod.rs
```rust
pub mod pdf;
pub mod chunker;
pub mod embedding;
```

### src-tauri/src/knowledge/pdf.rs
```rust
use pdf_extract::extract_text;
use std::path::Path;

pub fn extract_pdf_text(path: &Path) -> Result<String, String> {
    extract_text(path).map_err(|e| format!("PDF 解析失败：{}", e))
}
```

### src-tauri/src/knowledge/chunker.rs
```rust
use text_splitter::TextSplitter;

pub fn chunk_text(text: &str, max_chars: usize, overlap: usize) -> Vec<String> {
    let splitter = TextSplitter::default().with_trim_chunks(true);
    splitter
        .chunks(text, max_chars)
        .map(|c| c.to_string())
        .collect()
}
```

## 任务 3：向量嵌入 + Qdrant 存储

### src-tauri/src/knowledge/embedding.rs
使用 DeepSeek Embedding API 生成向量（复用 `async-openai` 的 `embeddings` 模块），存入 Qdrant 本地嵌入模式。

## 任务 4：文献知识库 Tauri Commands

### src-tauri/src/commands/literature.rs
- `upload_document(file_path)` → 解析 PDF → 切片 → 向量化 → 存入 Qdrant
- `search_knowledge(query)` → 向量检索 → 返回 top-k 结果
- `ask_knowledge(question)` → RAG：检索 + LLM 回答（引用来源）
- `analyze_structure(doc_id)` → LLM 解析论文结构 → 存入 paper_structure + paper_logic_link
- `compare_literature(doc_ids)` → 多篇论文对比 → 生成综述/对比表
- `check_citations(text)` → 对文稿文本做引用建议

## 任务 5：前端文献面板

### 修改前端
- 文献列表侧栏（上传按钮 + 文档列表 + 处理状态）
- 上传对话框（拖拽/选择 PDF）
- @lit 命令路由到文献模式
- 知识库问答界面（检索结果 + 引用来源标注）
- ChatPanel 中渲染引用标注

## 任务 6：集成验证

完整编译 + 端到端测试（上传 PDF → 检索问答 → 结构化解析）
