# ResearchMate

A desktop AI research assistant for graduate students — covering writing, literature, version control, and export across the full research cycle.

> AI acts as a "senior labmate": gives advice, explains reasoning, pushes your thinking. You are always the author.
>
> Built on [DeepSeek](https://deepseek.com) large language models.

## Download

[Releases](https://github.com/cannotgetaname/researchmate/releases)

| Platform | File | Notes |
|---|---|---|
| Linux | `ResearchMate_*.AppImage` | Recommended: `chmod +x` then run |
| Linux | `ResearchMate_*.deb` | Debian/Ubuntu |
| Linux | `ResearchMate-*.rpm` | Fedora/RHEL |
| Windows | `ResearchMate_*_windows.zip` | Unzip, run `researchmate.exe` |

## Features

**Writing**
- Monaco Editor (VS Code core) with Markdown editing
- Streaming AI polish: grammar / academic style / concise
- Right-click context menu: polish, explain, continue, check citations
- Real-time A4 preview (Pandoc-rendered HTML with pagination CSS)

**Literature & Knowledge Base**
- PDF upload with 3 parsers: Rust native / pymupdf / OpenDataLoader
- Semantic search + RAG Q&A with journal/domain/author/method filters
- AI Agent tool calling: LLM autonomously queries KB with count/list/single/compare strategies
- Citation check: select text → KB search → suggestion cards → insert inline
- KB management: create/delete KBs, session-level KB isolation

**Version Control (Git)**
- Snapshots with notes, branches, history browsing, line-level diff, tags
- 5-minute auto-snapshot, export historical versions as DOCX

**Export**
- DOCX / PDF via Pandoc (auto-downloaded on first use)
- Reference template: one-click basic generation + advanced (python-docx, customizable font/size/table style/heading numbering)

**Usability**
- Multi-session tabs, auto-save, thinking process display, 3-stage color timeline

## Quick Start

### Requirements

- Node.js ≥ 18
- Rust ≥ 1.85
- Linux system dependencies:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  sudo apt install build-essential cmake pkg-config libssl-dev libsqlite3-dev
  ```

### Run

```bash
git clone https://github.com/cannotgetaname/researchmate.git
cd researchmate
npm install
npm run tauri dev
```

Enter your DeepSeek API Key in Settings on first launch.

### Optional Dependencies

| Feature | Install |
|---|---|
| PDF parsing (pymupdf) | `pip install pymupdf` |
| PDF parsing (OpenDataLoader) | `pip install opendataloader-pdf` + Java 11 |
| Advanced template | `pip install python-docx` |
| Chinese PDF export | `sudo apt install texlive-xetex texlive-lang-chinese` |

### Build

```bash
# Linux
npm run tauri build
# Output: src-tauri/target/release/bundle/{deb,rpm,appimage}/

# Windows (cross-compile from Linux)
rustup target add x86_64-pc-windows-gnu
sudo apt install mingw-w64
npm run tauri build -- --target x86_64-pc-windows-gnu
```

### Offline Build

Pre-fetch dependencies on a machine with internet, then build offline:

```bash
# First time (with network)
npm install
cd src-tauri && cargo fetch && cd ..
npm run tauri build

# Subsequent offline builds
npm run tauri build
```

## Tech Stack

Tauri v2 | Rust | React 19 + TypeScript | Monaco Editor | DeepSeek API | SQLite (bundled) | Pandoc 3.6.4 | git2 | Inter + JetBrains Mono

## Project Structure

```
src/                    React frontend
  App.tsx               Main layout + tab routing
  components/
    EditorPanel.tsx     Monaco editor + context menu
    ChatPanel.tsx       AI chat + session management
    DocumentPanel.tsx   Literature search + KB management + citation suggestions
    VersionPanel.tsx    Git versions / branches / diff / tags
    EditorToolbar.tsx   Format toolbar + export controls
  hooks/useStreamChat.ts Streaming chat hook

src-tauri/              Rust backend
  src/
    lib.rs              Tauri entry + command registration
    commands/
      writing.rs        Polish / config / project management
      literature.rs     Upload / search / RAG / citation check
      agent.rs          AI Agent tool calling
      export.rs         Pandoc export / preview / template / auto-download
      version.rs        Git snapshots / branches / diff / tags
      draft.rs          Draft persistence
    llm/mod.rs          DeepSeek API engine
    knowledge/          PDF parsing / text chunking / vector embeddings / BM25
    db/                 SQLite persistence + migrations
  scripts/
    generate_template.py Advanced template generator (requires python-docx)
```

## License

MIT © 2025 cannotgetaname
