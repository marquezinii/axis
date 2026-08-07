# Axis v2 — Unified AI Workspace Design Spec

**Date:** 2026-08-06  
**Status:** Draft (pending implementation plan)

## Overview

Axis v2 unifies three projects into a single desktop application:

| Project | Stack | Absorbed As |
|---------|-------|-------------|
| **Axis** (current) | Tauri 2 + Rust + React 19 | Base shell, skill manager, storage, agents |
| **AgentOS** | Electron + Fastify + Claude SDK | Chat workspace, sessions, provider abstraction (rewritten in Rust) |
| **SkillDrop** | Python + PySide6 | Batch operations on skills (native feature) |

**Core identity:** AI Development Workspace. The chat is the center; the skill
manager is the "tool store" that feeds agents with capabilities.

**Stack:** Tauri 2 + React 19 + TypeScript 7 + Rust (edition 2024). Single
binary, single runtime, no sidecar processes.

## Chat Providers (v2 scope)

| Provider | Integration | Status |
|----------|-------------|--------|
| **Claude** | Anthropic Messages API (HTTP + SSE streaming) | v2 target |
| **OpenCode** | CLI spawn (`opencode chat`) + stdout streaming | v2 target |

**Provider architecture:** trait-based in Rust (`ChatProvider`), same pattern as
the existing `AgentAdapter` trait. The core chat/session layer only depends on
the trait — never on a specific provider implementation.

```rust
#[async_trait]
pub trait ChatProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    async fn send_message(
        &self,
        session: &SessionContext,
        message: &str,
        history: &[ChatMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<StreamEvent>,
    ) -> Result<(), ProviderError>;
}
```

### ClaudeProvider

- HTTP POST to `https://api.anthropic.com/v1/messages`
- Streaming via SSE (`text/event-stream`)
- API key from environment variable `ANTHROPIC_API_KEY`
- Tool definitions sent as JSON schema per Anthropic's tool-use format
- Parses SSE events: `message_start`, `content_block_start`, `content_block_delta`
  (`text_delta`), `content_block_stop`, `message_delta` (usage), `message_stop`
- Dependencies: `reqwest` (already in Cargo.toml, needs `stream` feature added),
  `tokio` (already transitive via Tauri)

### OpenCodeProvider

- Spawns `opencode chat --message "..." --project <project_path>` as a child process
- Reads stdout line by line for streaming output
- Detects OpenCode executable via the existing `AgentAdapter` discovery for
  `opencode` (already implemented in `agents.rs`)
- Cancellation: kill the child process on user abort
- Dependencies: `tokio::process::Command`

### Stream Events

```rust
pub enum StreamEvent {
    TextDelta { delta: String },
    ToolCallStarted { tool_name: String, tool_input: serde_json::Value },
    ToolCallFinished { tool_name: String, tool_output: String },
    FileChanged { path: String, diff: Option<String>, change_type: String },
    SessionCompleted { input_tokens: u64, output_tokens: u64 },
    SessionError { code: String, message: String },
}
```

### Provider Errors (closed set)

`AUTH_EXPIRED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`,
`TOOL_ERROR`, `CONTEXT_EXCEEDED`, `CANCELLED`, `UNKNOWN`.

`TOOL_ERROR` never terminates the session (the turn continues). All others
produce a `session_error` event visible to the user, with a manual "try again"
option. No silent automatic retries in v2.

## Streaming to Frontend

Tauri events for real-time token delivery:

```
Frontend: invoke("chat_send", { sessionId, message })
    ↓
Rust:    ChatSession::send() → spawns async task
    ↓
         provider.send_message(..., tx)
    ↓
         tx.send(StreamEvent::TextDelta { ... })
    ↓
         app_handle.emit("chat:token", payload)
    ↓
Frontend: listen("chat:token", (e) => { appendToChat(e.payload) })
```

Events emitted: `chat:token`, `chat:tool-start`, `chat:tool-end`,
`chat:file-changed`, `chat:completed`, `chat:error`.

Session-scoped: each event carries `session_id` so the frontend routes tokens
to the correct chat view.

## Session Management

- Sessions are scoped to a workspace (project folder)
- New Tauri commands:

  ```
  chat_create_session(projectId, provider) → SessionInfo
  chat_send_message(sessionId, message) → ()
  chat_cancel(sessionId) → ()
  chat_get_sessions(projectId) → Vec<SessionInfo>
  chat_get_messages(sessionId) → Vec<ChatMessage>
  chat_get_file_changes(sessionId) → Vec<FileChange>
  ```

- Sessions persist across app restarts (SQLite)
- History is navigable and restorable (unlike AgentOS v1 which lacked this UI)

## SQLite Schema (extensions)

Tables added to `storage.rs` (existing tables unchanged):

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    provider     TEXT NOT NULL,
    title        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    tool_calls  TEXT,
    token_usage TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE file_changes (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id  TEXT REFERENCES messages(id),
    file_path    TEXT NOT NULL,
    diff         TEXT,
    change_type  TEXT NOT NULL
);
```

**Existing tables NOT modified:** `skills`, `installations`, `workspaces`,
`sources`, `activities`, `settings`.

`activities` table gets new entries for chat actions
(`kind: "chat_session"`, `kind: "chat_message"`) via the existing
`storage::activity()` function — no schema change needed.

## Frontend Layout

Three-panel navigation replacing the current single-view layout:

```
+--------------------------------------------------+
| Axis                          ⚙ | [Min][Max][X] |
+--------+-----------------------------------------+
| Sidebar|  [Workspace] [Skills] [History]          |
|        |                                         |
| Proj.  |  ┌─────────────────────────────────┐   |
| ├─ a   |  │ Provider: [Claude] [OpenCode]    │   |
| ├─ b   |  │                                  │   |
| └─ +    |  │ Chat messages (streaming)       │   |
|        |  │ File diffs (inline preview)      │   |
| Sessions|  │                                  │   |
| ├─ S1   |  ├──────────────────────────────────┤   |
| ├─ S2   |  │ > _type your message..._    [↗] │   |
| └─ +    |  └─────────────────────────────────┘   |
|        |                                         |
+--------+-----------------------------------------+
| Status: ● Connected | Session: refactor (3m)      |
+--------------------------------------------------+
```

### Panel details

**Workspace panel** (primary, center):
- Provider selector (tabs: Claude | OpenCode)
- Chat message list with streaming tokens
- Inline diff preview for file changes
- Message input with send button (or Ctrl+Enter)
- Cancel button during active streaming

**Skills panel** (existing, now a tab):
- All current skill management functionality preserved
- New: multi-select checkboxes → batch install/inspect/update
  (absorbs SkillDrop's batch processing)
- New: "Install to all detected agents" batch action
- New: progress bar for batch operations

**History panel** (new):
- List of past sessions per workspace
- Click to view full conversation
- Resume/restore a session (creates a new session with history context)
- Delete sessions

**Sidebar** (left, persistent):
- Workspace list with quick-switch
- Recent sessions per workspace
- Quick stats (skills count, agents detected)

## Batch Operations (SkillDrop Absorption)

Replaces the standalone Python SkillDrop tool:

- Checkbox selection on skill list (single-click to select, click name for detail)
- Batch action bar appears when 1+ skills selected:
  - **Install selected**: triggers `install_github` with all selected skills
  - **Check updates**: runs `check_updates` scoped to selection
  - **Export manifest**: generates a JSON manifest of selected skills
- Progress indicator with per-skill status (queued → installing → done/failed)
- All operations use the existing `skills.rs` infrastructure — batch is purely
  a UI/coordination layer

## Rust Module Structure

```
src-tauri/src/
├── main.rs              # (unchanged)
├── lib.rs               # (extended) new Tauri commands for chat
├── models.rs            # (extended) Session, ChatMessage, StreamEvent types
├── agents.rs            # (existing) AgentAdapter trait + impls
├── skills.rs            # (existing) skill discovery, install, update
├── storage.rs           # (extended) new tables for sessions/messages/file_changes
├── chat.rs              # (NEW) ChatSession orchestrator, command handlers
└── providers/
    ├── mod.rs           # (NEW) ChatProvider trait, provider registry
    ├── claude.rs        # (NEW) ClaudeProvider via Anthropic HTTP API
    └── opencode.rs      # (NEW) OpenCodeProvider via CLI spawn
```

## Dependencies Added to Cargo.toml

```toml
# Existing reqwest needs streaming:
reqwest = { version = "0.12", features = ["blocking", "json", "rustls-tls", "stream"] }

# Async runtime (likely already available via Tauri's tokio):
tokio = { version = "1", features = ["full"] }

# SSE parsing for Claude streaming:
eventsource-stream = "0.2"

# Async trait support:
async-trait = "0.1"
```

## Migration Plan

### AgentOS → Axis

AgentOS (`C:\Projetos\AgentOS`) is archived as reference:
- Copied to `C:\Projetos\Axis\archive\agentos\` (read-only)
- Chat/session logic rewritten in Rust (this spec)
- Frontend React used as design reference, reimplemented in Axis's React 19 + Tauri IPC
- AgentOS repo on GitHub remains archived, not deleted

### SkillDrop → Axis

SkillDrop (`C:\Projetos\X.dll\skilldrop.py`) is absorbed as native feature:
- Copied to `C:\Projetos\Axis\archive\skilldrop\` (read-only)
- Batch processing becomes UI feature in Skills panel (see above)
- No Python dependency in the unified app

### Axis itself
- `package.json`: remains `"axis"`, version bumped to `0.2.0`
- `Cargo.toml`: new dependencies added, version `0.2.0`
- No breaking changes to existing commands or data
- Users upgrading from Axis v0.1.0 keep all their skills, workspaces, and settings

## Implementation Phases

| Phase | Scope | Dependencies |
|-------|-------|--------------|
| **1. Chat Backend** | `providers/` module, `ChatProvider` trait, Claude HTTP provider, session/message SQLite tables, `chat.rs` orchestrator | — |
| **2. Streaming + UI** | Tauri event bridge, chat view in React, token streaming display, message input | Phase 1 |
| **3. OpenCode Provider** | CLI spawn, stdout parsing, provider registration | Phase 1 |
| **4. History + Diff** | File change tracking, diff viewer component, session history panel | Phase 2 |
| **5. Batch Operations** | Multi-select UI, batch install/update actions, progress indicator | — (parallel to 1-4) |
| **6. Integration** | Tab navigation, sidebar, polish, error states, archive AgentOS+SkillDrop | Phases 1-5 |

Phases 1-4 are sequential. Phase 5 can run in parallel. Phase 6 is the
integration pass.

## What's NOT in v2

From AgentOS: multi-provider failover, RAG/memory vectorial, multi-agent
coordination — all remain for future versions.

From Axis: code signing, automatic updates, watchers, Windows startup, private
GitHub repos — remain on the existing backlog.

From SkillDrop: the standalone Python GUI tool is retired; the
`skilldrop_state.json` progress tracking file has no equivalent in v2
(batch operations are synchronous within a session).

## Validation Criteria

- `npm run build` (Vite frontend) compiles without errors
- `cargo build` (Tauri backend) compiles without errors
- Existing tests (vitest for frontend, cargo test for Rust) all pass
- Manual smoke test: launch Axis, switch to Workspace tab, send a message to
  Claude, see streaming response
- Batch install: select 3+ skills from a GitHub source, install all, verify
  they appear in the skills list
- Session persistence: create a session, close Axis, reopen, verify session
  appears in History