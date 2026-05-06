# ResearchMate

研究生桌面端 AI 科研伙伴——覆盖写作、文献、版本控制、导出全流程。

> AI 定位是"师兄/师姐"：给建议、讲原因、推动思考。你永远是作者。
>
> 基于 [DeepSeek](https://deepseek.com) 大语言模型构建。

## 下载

[Releases](https://github.com/cannotgetaname/researchmate/releases)

| 平台 | 文件 | 说明 |
|---|---|---|
| Linux | `ResearchMate_*.AppImage` | 推荐：`chmod +x` 后直接运行 |
| Linux | `ResearchMate_*.deb` | Debian/Ubuntu |
| Linux | `ResearchMate-*.rpm` | Fedora/RHEL |
| Windows | `ResearchMate_*_windows.zip` | 解压后双击 researchmate.exe |

## 功能

**写作**
- Monaco Editor（VS Code 内核），Markdown 编辑
- 流式 AI 润色：语法 / 学术风 / 精简风格，DeepSeek V4 思考模式逐字输出
- 划词右键菜单：润色、解释、续写、引用检查
- 实时 A4 分页预览（Pandoc 渲染）

**文献与知识库**
- PDF 上传，三种解析引擎：Rust 内置 / pymupdf（推荐，中文更好）/ OpenDataLoader
- 语义检索 + RAG 问答，支持按期刊/领域/作者/方法过滤
- AI Agent 工具调用：LLM 自主查知识库，count/list/single/compare 策略
- 引用检查：选中段落 → KB 搜索 → 推荐卡片 → 一键插入
- 知识库管理：创建/删除 KB，会话级 KB 隔离

**版本控制（Git）**
- 快照保存（带备注）、分支管理、历史回溯、行级 diff、版本标签
- 5 分钟自动快照，历史版本导出 DOCX

**导出**
- DOCX / PDF（Pandoc 引擎，首次运行自动下载）
- 参考模板：基础一键生成 + 高级自定义（python-docx，可调字体/字号/三线表/标题编号）

**体验**
- 多会话 tab、草稿自动保存、思考过程独立展示、三阶段色标

## 快速开始

### 环境

- Node.js ≥ 18
- Rust ≥ 1.85
- Linux 系统依赖：
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  sudo apt install build-essential cmake pkg-config libssl-dev libsqlite3-dev
  ```

### 运行

```bash
git clone https://github.com/cannotgetaname/researchmate.git
cd researchmate
npm install
npm run tauri dev
```

首次启动后在设置中填入 DeepSeek API Key。

### 可选依赖

| 功能 | 安装 |
|---|---|
| PDF 解析（pymupdf） | `pip install pymupdf` |
| PDF 解析（OpenDataLoader） | `pip install opendataloader-pdf` + Java 11 |
| 高级模板 | `pip install python-docx` |
| 中文 PDF 导出 | `sudo apt install texlive-xetex texlive-lang-chinese` |

### 构建

```bash
# Linux
npm run tauri build
# 产物：src-tauri/target/release/bundle/{deb,rpm,appimage}/

# Windows（从 Linux 交叉编译）
rustup target add x86_64-pc-windows-gnu
sudo apt install mingw-w64
npm run tauri build -- --target x86_64-pc-windows-gnu
```

### 离线构建

先在有网机器上预取依赖，之后可离线编译：

```bash
# 首次（有网）
npm install
cd src-tauri && cargo fetch && cd ..
npm run tauri build

# 后续离线编译
npm run tauri build
```

## 技术栈

Tauri v2 | Rust | React 19 + TypeScript | Monaco Editor | DeepSeek API | SQLite (bundled) | Pandoc 3.6.4 | git2 | Inter + JetBrains Mono

## 项目结构

```
src/                    React 前端
  App.tsx               主布局 + tab 路由
  components/
    EditorPanel.tsx     Monaco 编辑器 + 划词菜单
    ChatPanel.tsx       AI 对话 + 会话管理
    DocumentPanel.tsx   文献检索 + KB 管理 + 引用建议
    VersionPanel.tsx    Git 版本 / 分支 / diff / 标签
    EditorToolbar.tsx   格式工具栏 + 导出按钮
  hooks/useStreamChat.ts 流式聊天 hook

src-tauri/              Rust 后端
  src/
    lib.rs              Tauri 入口 + 命令注册
    commands/
      writing.rs        润色 / 配置 / 项目管理
      literature.rs     文献上传 / 检索 / RAG / 引用检查
      agent.rs          AI 工具调用 Agent
      export.rs         Pandoc 导出 / 预览 / 模板 / 自动下载
      version.rs        Git 快照 / 分支 / diff / 标签
      draft.rs          草稿持久化
    llm/mod.rs          DeepSeek API 引擎
    knowledge/          PDF 解析 / 文本切片 / 向量嵌入 / BM25
    db/                 SQLite 持久化 + 迁移
  scripts/
    generate_template.py 高级模板生成（需要 python-docx）
```

## 许可

MIT © 2025 cannotgetaname
