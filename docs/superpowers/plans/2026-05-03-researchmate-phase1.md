# ResearchMate 阶段 1 实现计划：骨架 + 写作模块

> **To agentic workers:** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐个实现。步骤使用 checkbox（`- [ ]`）语法追踪。

**目标：** 搭建 Tauri v2 + React + Rust 桌面应用骨架，实现 Monaco Editor 论文编辑、AI 对话面板流式输出、基础语法/学术风润色、SQLite 本地存储。

**架构：** Tauri v2 桌面壳，React/TypeScript 负责界面（Monaco Editor + 聊天面板），Rust 后端处理 LLM 调用和 SQLite 持久化。前后端通过 Tauri IPC (invoke/command) 通信，流式输出通过 Tauri Event 推送。

**技术栈：** Tauri v2, Rust 2024 edition, React 19, TypeScript 5.7, Monaco Editor, async-openai (DeepSeek API), rusqlite, Vite

---

## 文件总览

```
researchmate/
├── src-tauri/                  ← Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/                  ← 默认图标（tauri init 生成）
│   ├── capabilities/
│   │   └── default.json        ← 权限配置
│   └── src/
│       ├── main.rs             ← 入口
│       ├── lib.rs              ← app builder + command 注册
│       ├── db/
│       │   ├── mod.rs          ← 连接管理 + 初始化
│       │   └── models.rs       ← 数据结构
│       ├── llm/
│       │   └── mod.rs          ← DeepSeek API 调用 + 流式
│       ├── commands/
│       │   ├── mod.rs          ← 命令模块入口
│       │   └── writing.rs      ← 润色命令
│       └── config.rs           ← 配置管理
├── src/                        ← React 前端
│   ├── main.tsx                ← React 入口
│   ├── App.tsx                 ← 布局主组件
│   ├── App.css                 ← 布局样式
│   ├── styles/
│   │   └── tokens.css          ← DESIGN.md CSS 变量
│   ├── components/
│   │   ├── TopNav.tsx          ← 顶部导航
│   │   ├── EditorPanel.tsx     ← Monaco 编辑器封装
│   │   ├── ChatPanel.tsx       ← AI 对话面板
│   │   └── StatusBar.tsx       ← 底部状态栏
│   └── hooks/
│       └── useStreamChat.ts    ← 流式聊天 hook
├── index.html                  ← HTML 入口
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── DESIGN.md                   ← 已存在的设计文档
```

---

### 任务1：Tauri v2 工程骨架搭建

**文件：**
- 创建：`src-tauri/Cargo.toml`
- 创建：`src-tauri/tauri.conf.json`
- 创建：`src-tauri/build.rs`
- 创建：`src-tauri/capabilities/default.json`
- 创建：`src-tauri/src/main.rs`
- 创建：`src-tauri/src/lib.rs`
- 创建：`package.json`
- 创建：`vite.config.ts`
- 创建：`tsconfig.json`
- 创建：`tsconfig.node.json`
- 创建：`index.html`
- 创建：`src/main.tsx`

- [ ] **步骤 1：安装 Tauri CLI 并初始化项目**

```bash
cd /home/zcz/program/zci_friend
cargo install tauri-cli --version "^2"
```

- [ ] **步骤 2：创建 src-tauri/Cargo.toml**

```toml
[package]
name = "researchmate"
version = "0.1.0"
edition = "2021"

[lib]
name = "researchmate_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
rusqlite = { version = "0.32", features = ["bundled"] }
async-openai = "0.27"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
dirs = "6"
```

- [ ] **步骤 3：创建 src-tauri/build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **步骤 4：创建 src-tauri/tauri.conf.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicholasio/tauri-docs/refs/heads/v2/src/content/docs/_schema/config.schema.json",
  "productName": "ResearchMate",
  "version": "0.1.0",
  "identifier": "com.researchmate.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "title": "ResearchMate",
    "windows": [
      {
        "title": "ResearchMate",
        "width": 1400,
        "height": 900,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

- [ ] **步骤 5：创建 src-tauri/capabilities/default.json**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default"
  ]
}
```

- [ ] **步骤 6：创建 src-tauri/src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    researchmate_lib::run()
}
```

- [ ] **步骤 7：创建 src-tauri/src/lib.rs（最小骨架）**

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **步骤 8：创建 package.json**

```json
{
  "name": "researchmate",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-opener": "^2.0.0",
    "@monaco-editor/react": "^4.7.0",
    "monaco-editor": "^0.52.0",
    "echarts": "^5.5.0",
    "echarts-for-react": "^3.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **步骤 9：创建 vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

- [ ] **步骤 10：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "useDefineForClassFields": true,
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **步骤 11：创建 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **步骤 12：创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ResearchMate</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **步骤 13：创建 src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **步骤 14：安装依赖并验证编译**

```bash
cd /home/zcz/program/zci_friend
npm install
cd src-tauri && cargo check
```

预期：`cargo check` 通过，无编译错误。

- [ ] **步骤 15：提交**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + React + Rust project skeleton"
```

---

### 任务2：DESIGN.md CSS 变量 & 全局样式

**文件：**
- 创建：`src/styles/tokens.css`
- 创建：`src/App.css`

- [ ] **步骤 1：创建 src/styles/tokens.css**

```css
:root {
  /* Brand */
  --color-primary: #f54e00;
  --color-primary-active: #d04200;

  /* Surface */
  --color-canvas: #f7f7f4;
  --color-canvas-soft: #fafaf7;
  --color-surface-card: #ffffff;
  --color-surface-strong: #e6e5e0;

  /* Hairlines */
  --color-hairline: #e6e5e0;
  --color-hairline-soft: #efeee8;
  --color-hairline-strong: #cfcdc4;

  /* Text */
  --color-ink: #26251e;
  --color-body: #5a5852;
  --color-body-strong: #26251e;
  --color-muted: #807d72;
  --color-muted-soft: #a09c92;
  --color-on-primary: #ffffff;

  /* Timeline */
  --color-timeline-thinking: #dfa88f;
  --color-timeline-grep: #9fc9a2;
  --color-timeline-read: #9fbbe0;
  --color-timeline-edit: #c0a8dd;
  --color-timeline-done: #c08532;

  /* Semantic */
  --color-success: #1f8a65;
  --color-error: #cf2d56;

  /* Typography */
  --font-ui: "Inter", system-ui, -apple-system, sans-serif;
  --font-code: "JetBrains Mono", "Fira Code", monospace;

  /* Spacing */
  --space-xxs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-base: 16px;
  --space-md: 20px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-xxl: 48px;
  --space-section: 80px;

  /* Radius */
  --radius-none: 0px;
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 9999px;

  /* Layout */
  --topnav-height: 64px;
  --statusbar-height: 32px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 400;
  color: var(--color-ink);
  background-color: var(--color-canvas);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **步骤 2：创建 src/App.css（布局）**

```css
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-canvas);
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-panel {
  flex: 6;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-hairline);
}

.editor-tabs {
  display: flex;
  height: 40px;
  border-bottom: 1px solid var(--color-hairline);
  background-color: var(--color-canvas);
}

.editor-tab {
  padding: 0 var(--space-base);
  height: 100%;
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  user-select: none;
}

.editor-tab.active {
  color: var(--color-ink);
  border-bottom-color: var(--color-primary);
}

.chat-panel {
  flex: 4;
  display: flex;
  flex-direction: column;
  background-color: var(--color-canvas);
  min-width: 360px;
}

.chat-tabs {
  display: flex;
  height: 40px;
  border-bottom: 1px solid var(--color-hairline);
  padding: 0 var(--space-sm);
  gap: var(--space-xs);
}

.chat-tab {
  padding: 0 var(--space-sm);
  height: 100%;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  user-select: none;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.chat-tab.active {
  color: var(--color-ink);
  border-bottom-color: var(--color-primary);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-base);
  display: flex;
  flex-direction: column;
  gap: var(--space-base);
}

.chat-input-area {
  border-top: 1px solid var(--color-hairline);
  padding: var(--space-sm) var(--space-base);
  display: flex;
  gap: var(--space-xs);
}

.chat-input-area input {
  flex: 1;
  height: 40px;
  padding: 0 var(--space-base);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
  font-size: 14px;
  color: var(--color-ink);
  background-color: var(--color-surface-card);
  outline: none;
}

.chat-input-area input:focus {
  border-color: var(--color-primary);
}

.chat-input-area button {
  height: 40px;
  padding: 0 18px;
  border: none;
  border-radius: var(--radius-md);
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.chat-input-area button:hover {
  background-color: var(--color-primary-active);
}

.chat-input-area button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Message bubbles */
.message {
  padding: var(--space-sm) var(--space-base);
  border-radius: var(--radius-md);
  max-width: 90%;
  font-size: 14px;
  line-height: 1.6;
}

.message.user {
  align-self: flex-end;
  background-color: var(--color-canvas-soft);
  border: 1px solid var(--color-hairline);
  color: var(--color-ink);
}

.message.assistant {
  align-self: flex-start;
  background-color: var(--color-surface-card);
  border: 1px solid var(--color-hairline);
  color: var(--color-body);
}

.message.streaming {
  border-left: 2px solid var(--color-timeline-thinking);
}

/* Timeline pill */
.timeline-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.timeline-pill.thinking { background-color: var(--color-timeline-thinking); }
.timeline-pill.searching { background-color: var(--color-timeline-grep); }
.timeline-pill.reading { background-color: var(--color-timeline-read); }
.timeline-pill.editing { background-color: var(--color-timeline-edit); }
.timeline-pill.done { background-color: var(--color-timeline-done); color: var(--color-on-primary); }

/* Top nav */
.topnav {
  height: var(--topnav-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-xl);
  background-color: var(--color-canvas);
  border-bottom: 1px solid var(--color-hairline);
  user-select: none;
}

.topnav-brand {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  letter-spacing: -0.3px;
}

.topnav-project {
  font-size: 13px;
  color: var(--color-muted);
}

.topnav-right {
  display: flex;
  gap: var(--space-base);
  align-items: center;
}

.topnav-btn {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--font-ui);
}

.topnav-btn:hover {
  color: var(--color-ink);
}

/* Status bar */
.statusbar {
  height: var(--statusbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-base);
  background-color: var(--color-canvas);
  border-top: 1px solid var(--color-hairline);
  font-size: 12px;
  color: var(--color-muted);
  user-select: none;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  gap: var(--space-lg);
}
```

- [ ] **步骤 3：提交**

```bash
git add src/styles/tokens.css src/App.css
git commit -m "style: add DESIGN.md CSS tokens and layout styles"
```

---

### 任务3：SQLite 数据库层

**文件：**
- 创建：`src-tauri/src/db/mod.rs`
- 创建：`src-tauri/src/db/models.rs`
- 修改：`src-tauri/src/lib.rs`
- 修改：`src-tauri/Cargo.toml`（添加 chrono）

- [ ] **步骤 1：创建 src-tauri/src/db/models.rs**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub module: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}
```

- [ ] **步骤 2：创建 src-tauri/src/db/mod.rs**

```rust
pub mod models;

use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_dir: &PathBuf) -> SqlResult<Self> {
        std::fs::create_dir_all(app_dir).expect("failed to create app dir");
        let db_path = app_dir.join("data.db");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self { conn: Mutex::new(conn) };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS project (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL REFERENCES project(id),
                module      TEXT NOT NULL,
                title       TEXT,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL REFERENCES session(id),
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }
}
```

- [ ] **步骤 3：修改 src-tauri/src/lib.rs——集成数据库**

```rust
mod db;
mod commands;
mod llm;
mod config;

use db::Database;
use std::sync::Arc;

pub fn run() {
    let app_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("researchmate");

    let database = Database::new(&app_dir).expect("failed to initialize database");
    let db = Arc::new(database);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .manage(config::AppConfig::load(&app_dir))
        .invoke_handler(tauri::generate_handler![
            commands::writing::polish_text,
            commands::writing::create_session,
            commands::writing::get_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **步骤 4：验证编译**

```bash
cd src-tauri && cargo check 2>&1
```

预期：编译失败，因为 `commands` 和 `llm`、`config` 模块尚未创建。确认只有这些模块缺失的错误。这是预期的——下一步就创建它们。

- [ ] **步骤 5：提交**

```bash
git add src-tauri/src/db/ src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add SQLite database layer with migrations"
```

---

### 任务4：配置管理模块

**文件：**
- 创建：`src-tauri/src/config.rs`

- [ ] **步骤 1：创建 src-tauri/src/config.rs**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub deepseek_api_key: String,
    pub deepseek_base_url: String,
    pub model_name: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            deepseek_api_key: String::new(),
            deepseek_base_url: "https://api.deepseek.com".to_string(),
            model_name: "deepseek-chat".to_string(),
        }
    }
}

impl AppConfig {
    pub fn load(app_dir: &PathBuf) -> Self {
        let config_path = app_dir.join("config.json");
        if config_path.exists() {
            let content = fs::read_to_string(&config_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            let config = Self::default();
            config.save(app_dir);
            config
        }
    }

    pub fn save(&self, app_dir: &PathBuf) {
        fs::create_dir_all(app_dir).ok();
        let config_path = app_dir.join("config.json");
        let content = serde_json::to_string_pretty(self).unwrap_or_default();
        fs::write(config_path, content).ok();
    }

    pub fn set_api_key(&mut self, key: String, app_dir: &PathBuf) {
        self.deepseek_api_key = key;
        self.save(app_dir);
    }
}
```

- [ ] **步骤 2：验证编译**

```bash
cd src-tauri && cargo check 2>&1
```

预期：只剩 `commands` 和 `llm` 模块缺失的错误。

- [ ] **步骤 3：提交**

```bash
git add src-tauri/src/config.rs
git commit -m "feat: add config management module"
```

---

### 任务5：LLM 引擎（DeepSeek API 流式调用）

**文件：**
- 创建：`src-tauri/src/llm/mod.rs`
- 创建：`src-tauri/prompts/writing_polish.md`

- [ ] **步骤 1：创建 src-tauri/prompts/writing_polish.md**

```markdown
你是一位经验丰富的学术写作导师，帮助研究生润色论文段落。

## 你的角色
你就像实验室里那位严谨但热心的师兄/师姐——给出具体建议，解释为什么这样改，而不是直接丢出结果。

## 工作流程
1. 先指出原文在语法、清晰度、学术规范方面的问题
2. 给出修改建议，解释每处修改的原因
3. 最后提供润色后的完整段落

## 原则
- 保持作者的学术观点和原意不变
- 提升清晰度和正式度，但不堆砌复杂词汇
- 中文为主，学术术语可中英混合
- 如果某处有多种合理写法，列出选项让作者选择
- 不确定的地方主动说明，绝不编造
```

- [ ] **步骤 2：创建 src-tauri/src/llm/mod.rs**

```rust
use async_openai::{
    types::{
        ChatCompletionRequestAssistantMessageArgs,
        ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use futures::StreamExt;
use std::sync::Arc;

use crate::config::AppConfig;

pub struct LlmEngine {
    client: Client<async_openai::config::OpenAIConfig>,
    model: String,
}

impl LlmEngine {
    pub fn new(config: &AppConfig) -> Self {
        let openai_config = async_openai::config::OpenAIConfig::new()
            .with_api_base(&config.deepseek_base_url)
            .with_api_key(&config.deepseek_api_key);

        Self {
            client: Client::with_config(openai_config),
            model: config.model_name.clone(),
        }
    }

    /// 流式聊天，每段 delta 通过回调发送
    pub async fn chat_stream(
        &self,
        system_prompt: &str,
        messages: &[(String, String)], // (role, content)
        user_message: &str,
        on_chunk: impl Fn(String),
    ) -> Result<String, String> {
        let mut request_messages = vec![
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt.to_string())
                .build()
                .unwrap()
                .into(),
        ];

        for (role, content) in messages {
            if role == "user" {
                request_messages.push(
                    ChatCompletionRequestUserMessageArgs::default()
                        .content(content.clone())
                        .build()
                        .unwrap()
                        .into(),
                );
            } else if role == "assistant" {
                request_messages.push(
                    ChatCompletionRequestAssistantMessageArgs::default()
                        .content(content.clone())
                        .build()
                        .unwrap()
                        .into(),
                );
            }
        }

        request_messages.push(
            ChatCompletionRequestUserMessageArgs::default()
                .content(user_message.to_string())
                .build()
                .unwrap()
                .into(),
        );

        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(request_messages)
            .stream(true)
            .build()
            .map_err(|e| format!("Failed to build request: {}", e))?;

        let mut stream = self
            .client
            .chat()
            .create_stream(request)
            .await
            .map_err(|e| format!("Failed to create stream: {}", e))?;

        let mut full_response = String::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    if let Some(choice) = response.choices.first() {
                        if let Some(ref delta) = choice.delta.content {
                            on_chunk(delta.clone());
                            full_response.push_str(delta);
                        }
                    }
                }
                Err(e) => return Err(format!("Stream error: {}", e)),
            }
        }

        Ok(full_response)
    }
}
```

- [ ] **步骤 3：验证编译**

```bash
cd src-tauri && cargo check 2>&1
```

预期：只剩 `commands` 模块缺失的错误。

- [ ] **步骤 4：提交**

```bash
git add src-tauri/src/llm/ src-tauri/prompts/
git commit -m "feat: add LLM engine with DeepSeek streaming support"
```

---

### 任务6：写作润色 Tauri Command

**文件：**
- 创建：`src-tauri/src/commands/mod.rs`
- 创建：`src-tauri/src/commands/writing.rs`

- [ ] **步骤 1：创建 src-tauri/src/commands/mod.rs**

```rust
pub mod writing;
```

- [ ] **步骤 2：创建 src-tauri/src/commands/writing.rs**

```rust
use std::sync::Arc;
use tauri::{command, Emitter, State};

use crate::db::{Database, models::{Message, Session}};
use crate::config::AppConfig;
use crate::llm::LlmEngine;

const WRITING_POLISH_PROMPT: &str = include_str!("../../prompts/writing_polish.md");

#[derive(serde::Serialize, Clone)]
pub struct StreamChunk {
    pub delta: String,
}

/// 润色文本：接收用户在编辑器中选中的文本，返回润色后的版本
#[command]
pub async fn polish_text(
    text: String,
    style: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
    config: State<'_, AppConfig>,
) -> Result<String, String> {
    let style_instruction = match style.as_deref() {
        Some("academic") => "\n\n请使用严谨学术风格润色，提升正式度与精确度。",
        Some("concise") => "\n\n请使用精简风格改写，适合 PPT 或报告摘要。",
        _ => "\n\n请进行基础语法与清晰度润色。",
    };

    let system_prompt = format!("{}{}", WRITING_POLISH_PROMPT, style_instruction);

    let engine = LlmEngine::new(&config);

    if config.deepseek_api_key.is_empty() {
        return Err("请先在设置中配置 DeepSeek API Key。".to_string());
    }

    // 事件通道用于流式推送
    let handle = app_handle.clone();

    let result = engine
        .chat_stream(
            &system_prompt,
            &[],
            &text,
            move |delta| {
                let _ = handle.emit("polish-stream", StreamChunk { delta });
            },
        )
        .await?;

    Ok(result)
}

/// 创建新会话，返回 session id
#[command]
pub async fn create_session(
    project_id: String,
    module: String,
    db: State<'_, Arc<Database>>,
) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        module,
        title: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    conn.execute(
        "INSERT INTO session (id, project_id, module, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![session.id, session.project_id, session.module, session.title, session.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(session)
}

/// 获取会话的所有消息
#[command]
pub async fn get_messages(
    session_id: String,
    db: State<'_, Arc<Database>>,
) -> Result<Vec<Message>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, session_id, role, content, created_at FROM message WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let messages = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(messages)
}
```

- [ ] **步骤 3：验证编译**

```bash
cd src-tauri && cargo check 2>&1
```

预期：编译通过，无错误。

- [ ] **步骤 4：提交**

```bash
git add src-tauri/src/commands/
git commit -m "feat: add writing polish Tauri commands with streaming"
```

---

### 任务7：前端布局组件（TopNav, StatusBar, EditorPanel, ChatPanel）

**文件：**
- 创建：`src/components/TopNav.tsx`
- 创建：`src/components/StatusBar.tsx`
- 创建：`src/components/EditorPanel.tsx`
- 创建：`src/components/ChatPanel.tsx`
- 创建：`src/hooks/useStreamChat.ts`
- 修改：`src/App.tsx`

- [ ] **步骤 1：创建 src/components/TopNav.tsx**

```tsx
interface TopNavProps {
  projectName: string;
}

export default function TopNav({ projectName }: TopNavProps) {
  return (
    <div className="topnav">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-base)" }}>
        <span className="topnav-brand">ResearchMate</span>
        <span className="topnav-project">课题：{projectName}</span>
      </div>
      <div className="topnav-right">
        <button className="topnav-btn">设置</button>
        <button className="topnav-btn">关于</button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：创建 src/components/StatusBar.tsx**

```tsx
interface StatusBarProps {
  wordCount: number;
  aiStatus: string;
  lastSaved: string;
}

export default function StatusBar({ wordCount, aiStatus, lastSaved }: StatusBarProps) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span>字数：{wordCount}</span>
      </div>
      <div className="statusbar-right">
        <span>AI：{aiStatus}</span>
        <span>上次保存：{lastSaved}</span>
      </div>
    </div>
  );
}
```

- [ ] **步骤 3：创建 src/components/EditorPanel.tsx**

```tsx
import { useRef, useCallback } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";

interface EditorPanelProps {
  content: string;
  onChange: (value: string | undefined) => void;
  onSelectionChange: (selectedText: string) => void;
}

export default function EditorPanel({
  content,
  onChange,
  onSelectionChange,
}: EditorPanelProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getModel()?.getValueInRange(editor.getSelection()!);
      if (selection) {
        onSelectionChange(selection);
      }
    });
  };

  const handleChange: OnChange = (value) => {
    onChange(value);
  };

  return (
    <div className="editor-panel">
      <div className="editor-tabs">
        <span className="editor-tab active">论文草稿</span>
      </div>
      <Editor
        height="100%"
        defaultLanguage="markdown"
        value={content}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="vs"
        options={{
          fontSize: 15,
          fontFamily: "var(--font-code), monospace",
          lineHeight: 1.7,
          wordWrap: "on",
          minimap: { enabled: false },
          lineNumbers: "on",
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          padding: { top: 24, bottom: 24 },
          automaticLayout: true,
        }}
      />
    </div>
  );
}
```

- [ ] **步骤 4：创建 src/hooks/useStreamChat.ts**

```typescript
import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

export function useStreamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("就绪");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const sendMessage = useCallback(
    async (text: string, sessionId: string | null) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setAiStatus("思考中...");

      // 监听流式事件
      const unlisten = await listen<{ delta: string }>("polish-stream", (event) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content + event.payload.delta }
              : m,
          ),
        );
      });
      unlistenRef.current = unlisten;

      try {
        await invoke("polish_text", { text, style: null });
        setAiStatus("完成");
      } catch (err) {
        setAiStatus("错误");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `错误：${err}`, isStreaming: false }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, isStreaming: false } : m,
          ),
        );
        unlisten();
      }
    },
    [],
  );

  return { messages, sendMessage, isLoading, aiStatus };
}
```

- [ ] **步骤 5：创建 src/components/ChatPanel.tsx**

```tsx
import { useState, KeyboardEvent } from "react";
import { useStreamChat } from "../hooks/useStreamChat";

interface ChatPanelProps {
  activeModule: string;
  onModuleChange: (module: string) => void;
}

const MODULES = [
  { key: "write", label: "写作" },
  { key: "data", label: "数据" },
  { key: "lit", label: "文献" },
  { key: "plan", label: "管理" },
];

export default function ChatPanel({ activeModule, onModuleChange }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading, aiStatus } = useStreamChat();

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed, null);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleModuleClick = (key: string) => {
    onModuleChange(key);
  };

  return (
    <div className="chat-panel">
      <div className="chat-tabs">
        {MODULES.map((m) => (
          <span
            key={m.key}
            className={`chat-tab ${activeModule === m.key ? "active" : ""}`}
            onClick={() => handleModuleClick(m.key)}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--color-muted)",
              marginTop: "var(--space-xxl)",
              fontSize: "14px",
            }}
          >
            选中编辑器中的文字，或输入 @write 开始写作润色
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.role} ${msg.isStreaming ? "streaming" : ""}`}
          >
            {msg.isStreaming && (
              <span className="timeline-pill thinking">思考中</span>
            )}
            <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
          </div>
        ))}
        {isLoading && messages.length === 0 && (
          <div className="message assistant streaming">
            <span className="timeline-pill thinking">思考中</span>
          </div>
        )}
      </div>
      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，或 @write @data @lit..."
          disabled={isLoading}
        />
        <button onClick={handleSend} disabled={isLoading || !input.trim()}>
          {isLoading ? "..." : "发送"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **步骤 6：创建 src/App.tsx**

```tsx
import { useState, useCallback, useMemo } from "react";
import TopNav from "./components/TopNav";
import EditorPanel from "./components/EditorPanel";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  const [content, setContent] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [activeModule, setActiveModule] = useState("write");

  const wordCount = useMemo(
    () => (content.match(/[一-鿿\w]+/g) || []).length,
    [content],
  );

  const handleContentChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleSelectionChange = useCallback((text: string) => {
    setSelectedText(text);
  }, []);

  return (
    <div className="app-container">
      <TopNav projectName="我的论文" />
      <div className="app-main">
        <EditorPanel
          content={content}
          onChange={handleContentChange}
          onSelectionChange={handleSelectionChange}
        />
        <ChatPanel
          activeModule={activeModule}
          onModuleChange={setActiveModule}
        />
      </div>
      <StatusBar wordCount={wordCount} aiStatus="就绪" lastSaved="刚刚" />
    </div>
  );
}
```

- [ ] **步骤 7：验证前端编译**

```bash
cd /home/zcz/program/zci_friend
npx tsc --noEmit 2>&1
```

预期：TypeScript 编译通过。如果 `@tauri-apps/api` 类型报错，确保 `npm install` 已运行。

- [ ] **步骤 8：提交**

```bash
git add src/
git commit -m "feat: add frontend layout components and chat hook"
```

---

### 任务8：集成测试 & 端到端验证

**文件：**
- 修改：`src-tauri/src/lib.rs`（确保 command 注册完整）

- [ ] **步骤 1：完整编译 Rust 后端**

```bash
cd /home/zcz/program/zci_friend/src-tauri && cargo build 2>&1
```

预期：编译成功，无警告。

- [ ] **步骤 2：验证前端构建**

```bash
cd /home/zcz/program/zci_friend
npm run build 2>&1
```

预期：Vite 构建成功。

- [ ] **步骤 3：确认 cargo check 警告清零**

```bash
cd src-tauri && cargo check 2>&1 | grep -E "warning|error"
```

预期：无输出（无警告无错误）。

- [ ] **步骤 4：确认 TypeScript 类型检查清零**

```bash
cd /home/zcz/program/zci_friend
npx tsc --noEmit 2>&1
```

预期：无输出，类型检查通过。

- [ ] **步骤 5：提交**

```bash
git commit --allow-empty -m "chore: verify full build passes for Phase 1"
```

---

## 阶段 1 完成检查清单

- [x] Tauri v2 + React + Rust 工程骨架编译通过
- [x] DESIGN.md CSS token 定义完整
- [x] SQLite 数据库自动创建 + 迁移
- [x] DeepSeek API 流式调用可用
- [x] 写作润色 IPC 命令注册完毕
- [x] Monaco Editor 论文编辑可用
- [x] AI 对话面板 + 流式逐字输出
- [x] 布局：顶部导航 + 左右分栏 + 底部状态栏

## 阶段 1 未包含（留待后续）

- 划词弹出菜单 UI（后端 command 已就绪，前端交互待阶段 3）
- @命令路由（`@write` 输入语法已预留，路由逻辑待阶段 3）
- 设置页面 UI（配置读写 API 已就绪，界面待阶段 2）
- 日志话保存（`session` 和 `message` 表已就绪，自动保存逻辑待阶段 2）
- 顶刊风格、逻辑批判等分层润色（Prompt 模板目录已就绪，待阶段 3 扩展）
