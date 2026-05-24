---
name: codegraph
description: Pre-indexed code knowledge graph — semantic search, call graphs, impact analysis. Use for code exploration, architecture understanding, and refactoring.
---
# CodeGraph

Pre-indexed code knowledge graph for Reasonix Code — fewer tokens, fewer tool calls, 100% local.

Supports 19+ languages via tree-sitter: TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C, C++, Swift, Kotlin, Dart, Lua, Luau, Svelte, Liquid, Pascal/Delphi.

## Quick Start

```bash
# One-time setup (already done for this project)
codegraph init -i          # Initialize and index current project

# Day-to-day
codegraph status           # Check index health / stats
codegraph sync             # Incremental update after changes
codegraph index --force    # Full re-index after major changes
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `codegraph status` | Index stats (nodes, edges, freshness) |
| `codegraph sync` | Incremental update from changed files |
| `codegraph index --force` | Full re-index |
| `codegraph query <search>` | Search symbols by name (`--kind function\|class\|method`, `--limit N`, `--json`) |
| `codegraph context <task>` | Build relevant code context for a task description |
| `codegraph callers <symbol>` | Find what calls a function/method |
| `codegraph callees <symbol>` | Find what a function/method calls |
| `codegraph impact <symbol>` | Full impact analysis — what's affected by changing a symbol (`--depth N`) |
| `codegraph files` | Show indexed file structure (`--filter '*.ts'`, `--max-depth N`) |
| `codegraph affected <files...>` | Find test files affected by changed source files (for CI hooks) |
| `codegraph serve --mcp` | Start MCP server (if configured as MCP) |
| `codegraph clean` | Delete the `.codegraph/` index |
| `codegraph uninit` | Remove CodeGraph from a project |

## Core Workflows

### 1. Code Exploration ("How does X work?")

```
codegraph context "how does authentication work"   ← Get relevant entry points
codegraph query <symbol-name>                       ← Search for specific symbols
codegraph callers <symbol>                          ← Who depends on this?
codegraph callees <symbol>                          ← What does this depend on?
```

### 2. Impact Analysis ("What breaks if I change X?")

```
codegraph impact <symbol> --depth 3                 ← Full blast radius
codegraph affected src/auth.ts                      ← Which tests to run?
```

### 3. Debugging ("Why is X failing?")

```
codegraph context "error handling flow"             ← Map the area
codegraph callees <suspected-function> --json       ← Trace the call chain
```

### 4. After Major Changes

```
codegraph sync               ← Incremental (fast, for small edits)
codegraph index --force      ← Full rebuild (after refactors / branch switches)
```

## When to use CodeGraph vs other tools

| Scenario | Use |
|----------|-----|
| "Where is X defined?" | `codegraph query X` — single lookup, no file reads |
| "How does the auth system work?" | `codegraph context "auth"` then `explore` subagent + `codegraph query` |
| "What calls `login()`?" | `codegraph callers login` |
| "I'm about to change `User.ts` — what breaks?" | `codegraph impact User` |
| "Which tests cover this change?" | `codegraph affected src/User.ts` |
| Find a file by name | `search_files` (simpler) |
| Grep for a string pattern | `search_content` (simpler) |
| Read a specific file | `read_file` (simpler) |

**Rule of thumb**: CodeGraph for *semantic* questions (callers/callees/impact/context). Native tools for *textual* questions (grep by string, find file by name).

## Index Details

- **Database**: SQLite with FTS5 full-text search at `.codegraph/codegraph.db`
- **Auto-sync**: The MCP server watches files via native OS events (inotify on Linux). Changes sync after a 2-second debounce.
- **Add `.codegraph/` to `.gitignore`** — don't commit the index.

## Troubleshooting

- **Missing symbols**: Run `codegraph sync` or `codegraph index --force`
- **WAL warning**: If `codegraph status` says "WAL couldn't be enabled," the project is on a network share or WSL2 `/mnt` — move to a local disk.
- **Unparseable files**: Check `.codegraph/errors.log`
- **npm install issues**: Proxy is configured at `http://127.0.0.1:7897`
