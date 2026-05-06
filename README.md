# ResearchMate

研究生专属桌面端 AI 科研伙伴——以"师兄/师姐"的定位，覆盖论文写作、文献管理、版本控制和导出发布的全流程。

> AI 定位是**经验丰富的师兄/师姐**——给出建议、解释原因、推动思考，人永远是作者和决策者。

## 功能

### 写作
- **Monaco Editor** — VS Code 内核的 Markdown 编辑器，专注模式，无干扰
- **流式 AI 润色** — DeepSeek 逐字流式输出，语法 / 学术风 / 精简风格
- **划词菜单** — 右键选中文字：润色、解释、续写、引用检查
- **实时 A4 预览** — Pandoc 渲染 HTML + 分页 CSS，侧边实时更新

### 文献与知识库
- **PDF 上传** — 三种解析引擎：Rust 内置 / pymupdf（推荐）/ OpenDataLoader
- **语义检索** — 嵌入向量 + 余弦相似度，支持按期刊/领域/作者/方法过滤
- **AI 问答** — RAG 检索增强生成，自动引用文献来源
- **工具调用（Agent）** — LLM 自主调用 search_knowledge 工具，支持 count/list/single/compare 策略
- **知识库管理** — 创建/删除知识库，按 KB 隔离文献，会话级 KB 选择
- **引用检查** — 选中段落 → 查知识库 → 推荐文献，正文波浪线标记

### 版本控制（Git）
- **快照保存** — 一键保存当前草稿为版本，支持备注说明
- **分支管理** — 创建/切换/删除分支，不同方向独立管理
- **历史回溯** — 查看任意历史版本，一键恢复
- **版本对比** — 右键两个版本做行级 diff
- **标签标记** — 给版本打标签（初稿/投稿版/终版）
- **自动快照** — 5 分钟自动保存，防止意外丢失

### 导出
- **DOCX / PDF 导出** — Pandoc 引擎，支持自定义保存路径
- **Pandoc 自动下载** — 首次使用自动从 GitHub/ghproxy 下载，无需手动配置
- **参考模板** — 基础模板一键生成 + 高级模板（python-docx）可调字体/字号/行距/三线表/标题编号

### 体验
- **会话管理** — 多会话 tab，独立对话历史
- **草稿自动保存** — 3 秒防抖写入磁盘
- **思考过程展示** — DeepSeek V4 思考模式的 reasoning_content 独立展示
- **铅笔/编辑/完成三个阶段色标** — 时间线 pastel 色系

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri v2 |
| 后端 | Rust 2024 edition |
| 前端 | React 19 + TypeScript 5.7 |
| 编辑器 | Monaco Editor (`@monaco-editor/react`) |
| LLM | DeepSeek API（通过 `async-openai` + `reqwest`） |
| 数据库 | SQLite（`rusqlite` bundled） |
| 向量嵌入 | DeepSeek / Ollama |
| Pandoc | 3.6.4（首次运行自动下载） |
| 版本控制 | git2（libgit2） |
| 界面字体 | Inter + JetBrains Mono |

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Rust** ≥ 1.85
- **系统依赖**（Linux）：
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### 安装

```bash
git clone https://github.com/cannotgetaname/researchmate.git
cd researchmate

# 安装前端依赖
npm install

# 开发模式启动
npm run tauri dev
```

首次启动后在设置中填入 DeepSeek API Key。

### 可选依赖

| 功能 | 安装命令 | 说明 |
|---|---|---|
| 高级 PDF 解析（pymupdf） | `pip install pymupdf` | 中文支持更好，支持表格提取 |
| OpenDataLoader PDF 解析 | `pip install opendataloader-pdf` + Java 11 | 结构化提取 |
| 高级模板生成 | `pip install python-docx` | 可调字体/字号/三线表等参数 |
| PDF 导出（xelatex） | `sudo apt install texlive-xetex texlive-lang-chinese` | 中文 PDF 需要 |

## 构建发布

### Linux

```bash
npm run tauri build
# 产出：src-tauri/target/release/bundle/
```

### Windows（从 Linux 交叉编译）

```bash
# 安装交叉编译工具链
rustup target add x86_64-pc-windows-gnu
sudo apt install mingw-w64

# 构建
npm run tauri build -- --target x86_64-pc-windows-gnu
```

## 项目结构

```
researchmate/
├── src/                          # React 前端
│   ├── App.tsx                   # 主布局 + 路由
│   ├── components/
│   │   ├── EditorPanel.tsx       # Monaco 编辑器
│   │   ├── ChatPanel.tsx         # AI 对话面板
│   │   ├── DocumentPanel.tsx     # 文献管理
│   │   ├── VersionPanel.tsx      # Git 版本管理
│   │   ├── EditorToolbar.tsx     # 编辑器工具栏
│   │   └── ...
│   └── hooks/
│       └── useStreamChat.ts      # 流式聊天 hook
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri app builder
│   │   ├── commands/
│   │   │   ├── writing.rs        # 写作润色
│   │   │   ├── literature.rs     # 文献检索/RAG
│   │   │   ├── agent.rs          # 工具调用 Agent
│   │   │   ├── export.rs         # Pandoc 导出/模板
│   │   │   ├── version.rs        # Git 版本控制
│   │   │   └── draft.rs          # 草稿保存
│   │   ├── llm/                  # LLM 引擎
│   │   ├── knowledge/            # PDF/嵌入/切片
│   │   ├── db/                   # SQLite 持久化
│   │   └── config.rs
│   ├── scripts/
│   │   └── generate_template.py  # 高级模板生成脚本
│   └── Cargo.toml
├── .researchmate/                # 运行时数据（自动创建）
├── docs/superpowers/             # 设计文档
└── package.json
```

## 开发计划

已实现：写作、文献、版本控制、导出、引用检查、会话管理

开发中：
- 📊 **数据分析** — CSV 导入 → LLM 分析思路 → Python 代码执行 → ECharts 图表
- 📋 **项目管理** — 实验方案设计表 + 写作进度看板

## 许可

MIT
