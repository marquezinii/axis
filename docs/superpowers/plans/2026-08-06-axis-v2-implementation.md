# Axis v2 — Unified AI Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Axis, AgentOS, and SkillDrop into a single Tauri 2 desktop app: an AI development workspace with multi-provider chat (Claude + OpenCode), skill management, batch operations, and session history.

**Architecture:** Rust trait-based `ChatProvider` abstraction with Claude (Anthropic HTTP API) and OpenCode (CLI spawn) implementations. Streaming via Tauri events to React 19 frontend with three-panel layout (Workspace/Skills/History). SQLite for sessions, messages, and file changes — added to existing `storage.rs` schema.

**Tech Stack:** Tauri 2, Rust edition 2024, React 19, TypeScript 7, Vite 7, rusqlite (bundled), reqwest (with stream feature), tokio, eventsource-stream, async-trait.

## Global Constraints

- Tauri 2 + React 19 + TypeScript 7 + Rust edition 2024 — single binary, no sidecar processes
- Chat providers: Claude (HTTP API) + OpenCode (CLI spawn) only
- No silent automatic retries — errors are visible to user with manual "try again"
- `TOOL_ERROR` never terminates the session
- No breaking changes to existing commands or SQLite tables
- `package.json` version bumped to `0.2.0`, `Cargo.toml` version `0.2.0`
- API key from `ANTHROPIC_API_KEY` environment variable
- OpenCode detected via existing `AgentAdapter` discovery in `agents.rs`
- Spec reference: `docs/superpowers/specs/2026-08-06-axis-v2-unified-design.md`

---

## Phase 1: Chat Backend (Rust)

### Task 1.1: Add Cargo dependencies for chat streaming

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Produces: `reqwest` with `stream` feature, `tokio` with `full` features, `eventsource-stream = "0.2"`, `async-trait = "0.1"`

- [ ] **Step 1: Update Cargo.toml**

Change the `reqwest` dependency line from:
```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
```
to:
```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls", "stream"] }
```

Add after the `rfd` dependency line:
```toml
tokio = { version = "1", features = ["full"] }
eventsource-stream = "0.2"
async-trait = "0.1"
```

- [ ] **Step 2: Verify Cargo.toml parses**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: downloads new crates, no errors (may have unused import warnings)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: add chat provider dependencies (reqwest stream, tokio, eventsource-stream, async-trait)"
```

### Task 1.2: Define chat data models

**Files:**
- Create: `src-tauri/src/providers/mod.rs` (provider abstractions and types)
- Modify: `src-tauri/src/models.rs` (add SessionInfo, ChatMessage, FileChange serializable types for frontend)

**Interfaces:**
- Produces: `ProviderError` enum, `StreamEvent` enum, `ToolDefinition` struct, `SessionContext` struct, `ChatMessage` struct (for provider trait), `ChatProvider` trait
- Produces (in models.rs): `SessionInfo`, `ChatMessageView`, `FileChangeView` (serde-serializable for Tauri IPC)

- [ ] **Step 1: Create `src-tauri/src/providers/mod.rs`**

```rust
use serde::{Deserialize, Serialize};

/// Closed set of provider errors per the v2 spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderError {
    AuthExpired,
    RateLimited,
    QuotaExceeded,
    ProviderUnavailable,
    ToolError,
    ContextExceeded,
    Cancelled,
    Unknown(String),
}

/// Events emitted during a streaming chat turn.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    TextDelta { delta: String },
    ToolCallStarted { tool_name: String, tool_input: serde_json::Value },
    ToolCallFinished { tool_name: String, tool_output: String },
    FileChanged { path: String, diff: Option<String>, change_type: String },
    SessionCompleted { input_tokens: u64, output_tokens: u64 },
    SessionError { code: String, message: String },
}

/// Tool definition sent to the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// A message in the conversation history (for the provider).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,   // "user" | "assistant"
    pub content: String,
}

/// Context passed to the provider on each message send.
#[derive(Debug, Clone)]
pub struct SessionContext {
    pub session_id: String,
    pub project_path: String,
}

/// The ChatProvider trait — provider-agnostic interface for chat.
/// Same pattern as the existing AgentAdapter trait.
#[async_trait::async_trait]
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

/// Registry of available chat providers.
pub fn provider_registry() -> Vec<Box<dyn ChatProvider>> {
    vec![
        #[cfg(feature = "claude")]
        Box::new(crate::providers::claude::ClaudeProvider::new()),
    ]
}
```

- [ ] **Step 2: Create directory and verify module compiles**

Run: `mkdir src-tauri\src\providers` (if not exists), then `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compile succeeds. May warn about unused feature flag `claude` — that's fine.

- [ ] **Step 3: Add Tauri IPC types to `src-tauri/src/models.rs`**

Append after line 108 (after `InstallRequest`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub workspace_id: i64,
    pub provider: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageView {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub token_usage: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeView {
    pub id: String,
    pub session_id: String,
    pub message_id: Option<String>,
    pub file_path: String,
    pub diff: Option<String>,
    pub change_type: String,
}
```

- [ ] **Step 4: Verify models compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/providers/mod.rs src-tauri/src/models.rs
git commit -m "feat: define ChatProvider trait, StreamEvent, ProviderError, and chat IPC types"
```

### Task 1.3: Add chat tables to SQLite schema

**Files:**
- Modify: `src-tauri/src/storage.rs` (add table creation in `connect()`, add CRUD functions)

**Interfaces:**
- Consumes: `SessionInfo`, `ChatMessageView`, `FileChangeView` from `models.rs`
- Produces: `storage::create_sessions_table()` (called from `connect()`), `storage::save_session(...)`, `storage::save_message(...)`, `storage::save_file_change(...)`, `storage::get_sessions(workspace_id)`, `storage::get_messages(session_id)`, `storage::get_file_changes(session_id)`, `storage::delete_session(id)`

- [ ] **Step 1: Add chat tables to `connect()` in `storage.rs`**

In the `connect()` function (line 19), add these CREATE TABLE statements inside the `execute_batch` call, before the closing `")`:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    token_usage TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS file_changes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES chat_messages(id),
    file_path TEXT NOT NULL,
    diff TEXT,
    change_type TEXT NOT NULL
);
```

- [ ] **Step 2: Add save_session function at end of storage.rs (after line 187)**

```rust
pub fn save_session(id: &str, workspace_id: i64, provider: &str) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO chat_sessions(id, workspace_id, provider) VALUES(?1, ?2, ?3)",
            rusqlite::params![id, workspace_id, provider],
        )
        .map_err(|e| e.to_string())?;
    activity("chat_session", &format!("Started {} session in workspace {}", provider, workspace_id))
}

pub fn update_session_title(id: &str, title: &str) -> Result<(), String> {
    connect()?
        .execute(
            "UPDATE chat_sessions SET title=?1, updated_at=datetime('now') WHERE id=?2",
            rusqlite::params![title, id],
        )
        .map_err(|e| e.to_string())
}

pub fn save_message(
    id: &str, session_id: &str, role: &str, content: &str,
    tool_calls: Option<&str>, token_usage: Option<&str>,
) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO chat_messages(id, session_id, role, content, tool_calls, token_usage) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, session_id, role, content, tool_calls, token_usage],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_file_change(
    id: &str, session_id: &str, message_id: Option<&str>,
    file_path: &str, diff: Option<&str>, change_type: &str,
) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO file_changes(id, session_id, message_id, file_path, diff, change_type) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, session_id, message_id, file_path, diff, change_type],
        )
        .map_err(|e| e.to_string())
}

pub fn get_sessions(workspace_id: i64) -> Result<Vec<crate::models::SessionInfo>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, workspace_id, provider, title, created_at, updated_at FROM chat_sessions WHERE workspace_id=?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![workspace_id], |r| {
        Ok(crate::models::SessionInfo {
            id: r.get(0)?,
            workspace_id: r.get(1)?,
            provider: r.get(2)?,
            title: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn get_messages(session_id: &str) -> Result<Vec<crate::models::ChatMessageView>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, session_id, role, content, tool_calls, token_usage, created_at FROM chat_messages WHERE session_id=?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![session_id], |r| {
        Ok(crate::models::ChatMessageView {
            id: r.get(0)?,
            session_id: r.get(1)?,
            role: r.get(2)?,
            content: r.get(3)?,
            tool_calls: r.get(4)?,
            token_usage: r.get(5)?,
            created_at: r.get(6)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn get_file_changes(session_id: &str) -> Result<Vec<crate::models::FileChangeView>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, session_id, message_id, file_path, diff, change_type FROM file_changes WHERE session_id=?1 ORDER BY rowid ASC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![session_id], |r| {
        Ok(crate::models::FileChangeView {
            id: r.get(0)?,
            session_id: r.get(1)?,
            message_id: r.get(2)?,
            file_path: r.get(3)?,
            diff: r.get(4)?,
            change_type: r.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn delete_chat_session(id: &str) -> Result<(), String> {
    connect()?
        .execute("DELETE FROM chat_sessions WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    activity("chat_session", "Deleted chat session")
}
```

- [ ] **Step 3: Verify storage compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors

- [ ] **Step 4: Write and run storage tests**

Create `src-tauri/tests/storage_tests.rs`:
```rust
#[cfg(test)]
mod tests {
    use axis_lib::storage;

    #[test]
    fn test_chat_tables_exist_after_connect() {
        let conn = storage::connect().expect("connect should succeed");
        // Verify tables exist by querying sqlite_master
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chat_sessions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "chat_sessions table should exist");
    }

    #[test]
    fn test_save_and_get_session() {
        let id = format!("test-session-{}", uuid::Uuid::new_v4());
        storage::save_session(&id, 1, "claude").expect("save_session");
        let sessions = storage::get_sessions(1).expect("get_sessions");
        assert!(sessions.iter().any(|s| s.id == id));
    }
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: storage tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/storage.rs src-tauri/tests/storage_tests.rs
git commit -m "feat: add chat SQLite tables and CRUD functions for sessions, messages, file_changes"
```

### Task 1.4: Implement ClaudeProvider

**Files:**
- Create: `src-tauri/src/providers/claude.rs`

**Interfaces:**
- Consumes: `ChatProvider` trait, `StreamEvent`, `ProviderError`, `SessionContext`, `ChatMessage`, `ToolDefinition` from `providers/mod.rs`
- Produces: `ClaudeProvider` struct implementing `ChatProvider`

- [ ] **Step 1: Create `src-tauri/src/providers/claude.rs`**

```rust
use super::{ChatMessage, ChatProvider, ProviderError, SessionContext, StreamEvent, ToolDefinition};
use futures_util::StreamExt;
use serde_json::Value;

pub struct ClaudeProvider {
    client: reqwest::Client,
}

impl ClaudeProvider {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    fn api_key() -> Result<String, ProviderError> {
        std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| ProviderError::AuthExpired)
    }

    fn build_body(
        session: &SessionContext,
        message: &str,
        history: &[ChatMessage],
        tools: &[ToolDefinition],
    ) -> Value {
        let mut messages: Vec<Value> = history
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": m.role,
                    "content": m.content
                })
            })
            .collect();

        // Add the new user message
        messages.push(serde_json::json!({
            "role": "user",
            "content": message
        }));

        let mut body = serde_json::json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "messages": messages,
            "stream": true,
        });

        if !tools.is_empty() {
            let anthropic_tools: Vec<Value> = tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.input_schema,
                    })
                })
                .collect();
            body["tools"] = serde_json::json!(anthropic_tools);
        }

        body
    }
}

#[async_trait::async_trait]
impl ChatProvider for ClaudeProvider {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn display_name(&self) -> &'static str {
        "Claude"
    }

    async fn send_message(
        &self,
        session: &SessionContext,
        message: &str,
        history: &[ChatMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<StreamEvent>,
    ) -> Result<(), ProviderError> {
        let api_key = Self::api_key()?;
        let body = Self::build_body(session, message, history, tools);

        let response = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ProviderError::ProviderUnavailable
                } else {
                    ProviderError::Unknown(e.to_string())
                }
            })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body_text = response.text().await.unwrap_or_default();
            return Err(match status {
                401 => ProviderError::AuthExpired,
                429 => ProviderError::RateLimited,
                529 => ProviderError::ProviderUnavailable,
                _ => ProviderError::Unknown(format!("HTTP {}: {}", status, body_text)),
            });
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut input_tokens: u64 = 0;
        let mut output_tokens: u64 = 0;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| ProviderError::Unknown(e.to_string()))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE events
            while let Some(event_end) = buffer.find("\n\n") {
                let event_text = buffer[..event_end].to_string();
                buffer = buffer[event_end + 2..].to_string();

                for line in event_text.lines() {
                    if line.is_empty() || !line.starts_with("data: ") {
                        continue;
                    }
                    let data = &line[6..];

                    let event: Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let event_type = event["type"].as_str().unwrap_or("");

                    match event_type {
                        "message_start" => {
                            if let Some(usage) = event["message"]["usage"].as_object() {
                                input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            }
                        }
                        "content_block_delta" => {
                            if let Some(delta) = event["delta"]["text"].as_str() {
                                let _ = tx.send(StreamEvent::TextDelta {
                                    delta: delta.to_string(),
                                }).await;
                            }
                        }
                        "message_delta" => {
                            if let Some(usage) = event["usage"]["output_tokens"].as_u64() {
                                output_tokens = usage;
                            }
                        }
                        "message_stop" => {
                            let _ = tx.send(StreamEvent::SessionCompleted {
                                input_tokens,
                                output_tokens,
                            }).await;
                        }
                        "error" => {
                            let msg = event["error"]["message"]
                                .as_str()
                                .unwrap_or("Unknown Claude error");
                            let _ = tx.send(StreamEvent::SessionError {
                                code: "UNKNOWN".into(),
                                message: msg.to_string(),
                            }).await;
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(())
    }
}
```

- [ ] **Step 2: Add `futures-util` to Cargo.toml**

In `src-tauri/Cargo.toml`, add after `eventsource-stream = "0.2"`:
```toml
futures-util = "0.3"
```

- [ ] **Step 3: Verify ClaudeProvider compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: may warn about unused import `eventsource_stream` — that's ok for now.

If error: recursively fix any compilation issues.

- [ ] **Step 4: Update providers/mod.rs to include claude module**

After the `use` statements at the top, add:
```rust
pub mod claude;
```

And update the `provider_registry` function to remove the `#[cfg(feature = "claude")]` gate (since we always include Claude):
```rust
pub fn provider_registry() -> Vec<Box<dyn ChatProvider>> {
    vec![Box::new(crate::providers::claude::ClaudeProvider::new())]
}
```

- [ ] **Step 5: Verify full compile**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/claude.rs src-tauri/src/providers/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: implement ClaudeProvider with Anthropic HTTP API SSE streaming"
```

### Task 1.5: Create chat.rs orchestrator and wire Tauri commands

**Files:**
- Create: `src-tauri/src/chat.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `ChatProvider` trait, `storage` CRUD functions, `models` types, Tauri `AppHandle`
- Produces: Tauri commands: `chat_create_session`, `chat_send_message`, `chat_cancel`, `chat_get_sessions`, `chat_get_messages`, `chat_get_file_changes`, `chat_delete_session`

- [ ] **Step 1: Create `src-tauri/src/chat.rs`**

```rust
use crate::models::{ChatMessageView, FileChangeView, SessionInfo};
use crate::providers::{ChatProvider, ProviderError, SessionContext, StreamEvent};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// Tracks active streaming sessions for cancellation.
pub struct ActiveSessions {
    pub cancel_tokens: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl ActiveSessions {
    pub fn new() -> Self {
        Self {
            cancel_tokens: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn chat_create_session(
    workspace_id: i64,
    provider: String,
) -> Result<SessionInfo, String> {
    let id = Uuid::new_v4().to_string();
    crate::storage::save_session(&id, workspace_id, &provider)?;
    let sessions = crate::storage::get_sessions(workspace_id)?;
    sessions
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Session created but not found".to_string())
}

#[tauri::command]
pub async fn chat_send_message(
    app: AppHandle,
    active: State<'_, ActiveSessions>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    // Validate session exists
    let db_sessions = crate::storage::get_sessions(0)?; // We need workspace_id from session
    // Actually, let's query the session directly
    let conn = crate::storage::connect()?;
    let (workspace_id, provider_id): (i64, String) = conn
        .query_row(
            "SELECT workspace_id, provider FROM chat_sessions WHERE id=?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("Session not found: {}", e))?;

    let workspace = crate::storage::workspaces()?
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    // Find the provider
    let providers = crate::providers::provider_registry();
    let provider = providers
        .iter()
        .find(|p| p.id() == provider_id)
        .ok_or(format!("Provider '{}' not available", provider_id))?;

    // Load history
    let history: Vec<crate::providers::ChatMessage> = crate::storage::get_messages(&session_id)?
        .into_iter()
        .map(|m| crate::providers::ChatMessage {
            role: m.role,
            content: m.content,
        })
        .collect();

    let session_ctx = SessionContext {
        session_id: session_id.clone(),
        project_path: workspace.path.clone(),
    };

    let message_id = Uuid::new_v4().to_string();

    // Save user message
    crate::storage::save_message(&message_id, &session_id, "user", &message, None, None)?;

    // Channel for streaming
    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamEvent>(64);
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut tokens = active.cancel_tokens.lock().unwrap();
        tokens.insert(session_id.clone(), cancel_tx);
    }

    let app_handle = app.clone();
    let sid = session_id.clone();

    // Spawn the provider call
    tokio::spawn(async move {
        let result = tokio::select! {
            r = provider.send_message(&session_ctx, &message, &history, &[], tx.clone()) => r,
            _ = cancel_rx => Err(ProviderError::Cancelled),
        };

        if let Err(e) = result {
            let _ = tx
                .send(StreamEvent::SessionError {
                    code: format!("{:?}", e),
                    message: format!("{:?}", e),
                })
                .await;
        }
    });

    // Forward stream events to Tauri events
    let sid_for_events = session_id.clone();
    tokio::spawn(async move {
        let mut assistant_content = String::new();
        let mut assistant_id = Uuid::new_v4().to_string();
        let mut saved_assistant = false;

        while let Some(event) = rx.recv().await {
            match &event {
                StreamEvent::TextDelta { delta } => {
                    assistant_content.push_str(delta);
                    let payload = serde_json::json!({
                        "sessionId": sid_for_events,
                        "delta": delta,
                    });
                    let _ = app_handle.emit("chat:token", payload);
                }
                StreamEvent::FileChanged { path, diff, change_type } => {
                    let fc_id = Uuid::new_v4().to_string();
                    let _ = crate::storage::save_file_change(
                        &fc_id, &sid_for_events, Some(&assistant_id),
                        path, diff.as_deref(), change_type,
                    );
                    let payload = serde_json::json!({
                        "sessionId": sid_for_events,
                        "path": path,
                        "diff": diff,
                        "changeType": change_type,
                    });
                    let _ = app_handle.emit("chat:file-changed", payload);
                }
                StreamEvent::SessionCompleted { input_tokens, output_tokens } => {
                    if !assistant_content.is_empty() && !saved_assistant {
                        let usage = serde_json::json!({
                            "input": input_tokens,
                            "output": output_tokens,
                        }).to_string();
                        let _ = crate::storage::save_message(
                            &assistant_id, &sid_for_events, "assistant",
                            &assistant_content, None, Some(&usage),
                        );
                        saved_assistant = true;
                    }
                    let _ = crate::storage::update_session_title(&sid_for_events, &assistant_content.chars().take(50).collect::<String>());
                    let payload = serde_json::json!({
                        "sessionId": sid_for_events,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                    });
                    let _ = app_handle.emit("chat:completed", payload);
                }
                StreamEvent::SessionError { code, message } => {
                    let payload = serde_json::json!({
                        "sessionId": sid_for_events,
                        "code": code,
                        "message": message,
                    });
                    let _ = app_handle.emit("chat:error", payload);
                }
                _ => {}
            }
        }

        // Cleanup cancel token
        // (The Mutex guard is dropped after the spawn)
    });

    // Cleanup after streaming finishes (handled by the spawned task above)
    Ok(())
}

#[tauri::command]
pub async fn chat_cancel(
    active: State<'_, ActiveSessions>,
    session_id: String,
) -> Result<(), String> {
    let mut tokens = active.cancel_tokens.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = tokens.remove(&session_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_get_sessions(workspace_id: i64) -> Result<Vec<SessionInfo>, String> {
    crate::storage::get_sessions(workspace_id)
}

#[tauri::command]
pub async fn chat_get_messages(session_id: String) -> Result<Vec<ChatMessageView>, String> {
    crate::storage::get_messages(&session_id)
}

#[tauri::command]
pub async fn chat_get_file_changes(session_id: String) -> Result<Vec<FileChangeView>, String> {
    crate::storage::get_file_changes(&session_id)
}

#[tauri::command]
pub async fn chat_delete_session(session_id: String) -> Result<(), String> {
    crate::storage::delete_chat_session(&session_id)
}
```

- [ ] **Step 2: Wire chat module into lib.rs**

In `src-tauri/src/lib.rs`, change line 1 from:
```rust
mod agents;
mod models;
mod skills;
mod storage;
```
to:
```rust
mod agents;
mod chat;
mod models;
mod providers;
mod skills;
mod storage;
```

In the `run()` function, update the `invoke_handler` to include chat commands (add to the list after `open_managed_folder`):
```rust
.invoke_handler(tauri::generate_handler![
    get_dashboard,
    rescan,
    choose_workspace,
    add_workspace,
    remove_workspace,
    add_source,
    remove_source,
    inspect_github,
    install_github,
    check_updates,
    open_managed_folder,
    chat::chat_create_session,
    chat::chat_send_message,
    chat::chat_cancel,
    chat::chat_get_sessions,
    chat::chat_get_messages,
    chat::chat_get_file_changes,
    chat::chat_delete_session,
])
```

And add `ActiveSessions` to the managed state. Change:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
```
to:
```rust
tauri::Builder::default()
    .manage(chat::ActiveSessions::new())
    .plugin(tauri_plugin_opener::init())
```

- [ ] **Step 3: Verify full backend compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors. Fix any compilation issues recursively.

- [ ] **Step 4: Write integration test**

Create `src-tauri/tests/chat_tests.rs`:
```rust
#[cfg(test)]
mod tests {
    use axis_lib::storage;

    #[test]
    fn test_session_lifecycle() {
        let sid = format!("int-{}", uuid::Uuid::new_v4());
        // Create workspace first
        storage::add_workspace("C:\\").unwrap();
        let workspaces = storage::workspaces().unwrap();
        let ws_id = workspaces.last().unwrap().id;

        storage::save_session(&sid, ws_id, "claude").unwrap();
        let sessions = storage::get_sessions(ws_id).unwrap();
        assert!(sessions.iter().any(|s| s.id == sid));

        storage::delete_chat_session(&sid).unwrap();
        let after = storage::get_sessions(ws_id).unwrap();
        assert!(!after.iter().any(|s| s.id == sid));
    }

    #[test]
    fn test_message_persistence() {
        let sid = format!("msg-{}", uuid::Uuid::new_v4());
        let workspaces = storage::workspaces().unwrap();
        let ws_id = workspaces.last().unwrap().id;

        storage::save_session(&sid, ws_id, "claude").unwrap();

        let mid = uuid::Uuid::new_v4().to_string();
        storage::save_message(&mid, &sid, "user", "Hello", None, None).unwrap();

        let msgs = storage::get_messages(&sid).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "Hello");
    }
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/chat.rs src-tauri/src/lib.rs src-tauri/tests/chat_tests.rs
git commit -m "feat: add chat.rs orchestrator with Tauri commands for session management and streaming"
```

---

## Phase 2: Streaming + Chat UI (React)

### Task 2.1: Create useChat hook

**Files:**
- Create: `src/hooks/useChat.ts`

**Interfaces:**
- Produces: `useChat(sessionId: string)` → `{ messages, send, cancel, isStreaming, error }`

- [ ] **Step 1: Create `src/hooks/useChat.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

export type FileChangeEvent = {
  sessionId: string;
  path: string;
  diff: string | null;
  changeType: string;
};

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const pendingAssistant = useRef<string>('');

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;
      setError(null);
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Add placeholder assistant message for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        await invoke('chat_send_message', { sessionId, message: content });
      } catch (e) {
        setError(String(e));
        setIsStreaming(false);
      }
    },
    [sessionId, isStreaming],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke('chat_cancel', { sessionId });
    } catch (e) {
      setError(String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const u1 = await listen<{ sessionId: string; delta: string }>(
        'chat:token',
        (e) => {
          if (e.payload.sessionId !== sessionId) return;
          pendingAssistant.current += e.payload.delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.isStreaming
                ? { ...m, content: pendingAssistant.current }
                : m,
            ),
          );
        },
      );

      const u2 = await listen('chat:completed', (e: any) => {
        if (e.payload.sessionId !== sessionId) return;
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false } : m,
          ),
        );
        pendingAssistant.current = '';
      });

      const u3 = await listen<{
        sessionId: string;
        code: string;
        message: string;
      }>('chat:error', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        setError(e.payload.message);
        setIsStreaming(false);
      });

      const u4 = await listen<FileChangeEvent>('chat:file-changed', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        setFileChanges((prev) => [...prev, e.payload]);
      });

      unlisteners = [u1, u2, u3, u4];
    };

    setup();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [sessionId]);

  return { messages, send, cancel, isStreaming, error, fileChanges };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors in useChat.ts (may have errors in App.tsx — that's fine, we're not modifying it yet)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: add useChat hook for Tauri event-based streaming chat"
```

### Task 2.2: Create useSessions hook

**Files:**
- Create: `src/hooks/useSessions.ts`

**Interfaces:**
- Produces: `useSessions(workspaceId: number | null)` → `{ sessions, createSession, deleteSession, refresh }`

- [ ] **Step 1: Create `src/hooks/useSessions.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type SessionInfo = {
  id: string;
  workspaceId: number;
  provider: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export function useSessions(workspaceId: number | null) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (workspaceId === null) return;
    try {
      const result = await invoke<SessionInfo[]>('chat_get_sessions', {
        workspaceId,
      });
      setSessions(result);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }, [workspaceId]);

  const createSession = useCallback(
    async (provider: string): Promise<SessionInfo | null> => {
      if (workspaceId === null) return null;
      setBusy(true);
      try {
        const session = await invoke<SessionInfo>('chat_create_session', {
          workspaceId,
          provider,
        });
        await refresh();
        return session;
      } catch (e) {
        console.error('Failed to create session:', e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, refresh],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('chat_delete_session', { sessionId });
        await refresh();
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, createSession, deleteSession, refresh, busy };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSessions.ts
git commit -m "feat: add useSessions hook for session CRUD via Tauri IPC"
```

### Task 2.3: Create ChatView component

**Files:**
- Create: `src/components/workspace/ChatView.tsx`

**Interfaces:**
- Consumes: `useChat` hook
- Produces: `ChatView` component with message list, input, cancel button, file change previews

- [ ] **Step 1: Create `src/components/workspace/ChatView.tsx`**

```tsx
import { useRef, useEffect, useState } from 'react';
import { useChat, type FileChangeEvent } from '../../hooks/useChat';
import { LoaderCircle, Send, Square, FileCode2 } from 'lucide-react';

type Props = {
  sessionId: string;
};

export function ChatView({ sessionId }: Props) {
  const { messages, send, cancel, isStreaming, error, fileChanges } =
    useChat(sessionId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = () => {
    if (!input.trim()) return;
    send(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const sessionFileChanges = fileChanges.filter(
    (fc) => fc.sessionId === sessionId,
  );

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role} ${msg.isStreaming ? 'streaming' : ''}`}
          >
            <div className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div className="chat-message-content">
              {msg.content || (msg.isStreaming ? 'Thinking...' : '')}
              {msg.isStreaming && <LoaderCircle className="spin" size={14} />}
            </div>
          </div>
        ))}
        {sessionFileChanges.length > 0 && (
          <div className="chat-file-changes">
            <h4>
              <FileCode2 size={14} /> Files changed
            </h4>
            {sessionFileChanges.map((fc, i) => (
              <div key={i} className="file-change-item">
                <code>{fc.path}</code>
                {fc.diff && (
                  <pre className="diff-preview">{fc.diff}</pre>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Ctrl+Enter to send)"
          rows={2}
          disabled={isStreaming}
        />
        <div className="chat-actions">
          {isStreaming ? (
            <button
              className="button danger"
              onClick={cancel}
              aria-label="Cancel"
            >
              <Square size={16} /> Stop
            </button>
          ) : (
            <button
              className="button primary"
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add basic chat CSS to App.css**

Append to `src/App.css`:
```css
/* Workspace / Chat */
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.chat-message {
  max-width: 85%;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  line-height: 1.5;
}
.chat-message.user {
  align-self: flex-end;
  background: var(--accent-color, #89b4fa);
  color: #11111b;
}
.chat-message.assistant {
  align-self: flex-start;
  background: #313244;
}
.chat-message.streaming {
  opacity: 0.85;
}
.chat-message-role {
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  opacity: 0.7;
}
.chat-message-content {
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid #45475a;
  background: #1e1e2e;
}
.chat-input-row textarea {
  flex: 1;
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 8px;
  color: #cdd6f4;
  padding: 0.5rem 0.75rem;
  resize: none;
  font-family: inherit;
  font-size: 0.875rem;
}
.chat-input-row textarea:focus {
  border-color: #89b4fa;
  outline: none;
}
.chat-actions {
  display: flex;
  align-items: flex-end;
}
.chat-error {
  background: #f38ba8;
  color: #11111b;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.85rem;
}
.chat-file-changes {
  background: #313244;
  border-radius: 8px;
  padding: 0.75rem;
  margin-top: 0.5rem;
}
.chat-file-changes h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
}
.file-change-item {
  margin-bottom: 0.5rem;
}
.file-change-item code {
  display: block;
  font-size: 0.8rem;
  color: #a6e3a1;
  margin-bottom: 0.25rem;
}
.diff-preview {
  font-size: 0.75rem;
  background: #1e1e2e;
  padding: 0.5rem;
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Verify TypeScript compiles (new components only)**

Run: `npx tsc --noEmit`
Expected: may have unused import warnings. Fix any actual errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/ChatView.tsx src/App.css
git commit -m "feat: add ChatView component with streaming, cancel, and file change preview"
```

### Task 2.4: Create ProviderSelector component and Workspace panel

**Files:**
- Create: `src/components/workspace/ProviderSelector.tsx`
- Create: `src/components/workspace/WorkspacePanel.tsx`

**Interfaces:**
- Produces: `ProviderSelector` (Claude | OpenCode tabs), `WorkspacePanel` (combines provider selector + chat view)

- [ ] **Step 1: Create ProviderSelector**

`src/components/workspace/ProviderSelector.tsx`:
```tsx
type Props = {
  selected: string;
  onSelect: (provider: string) => void;
};

const providers = [
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
];

export function ProviderSelector({ selected, onSelect }: Props) {
  return (
    <div className="provider-selector">
      {providers.map((p) => (
        <button
          key={p.id}
          className={`provider-tab ${selected === p.id ? 'active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create WorkspacePanel**

`src/components/workspace/WorkspacePanel.tsx`:
```tsx
import { useState } from 'react';
import { ChatView } from './ChatView';
import { ProviderSelector } from './ProviderSelector';
import { useSessions } from '../../hooks/useSessions';
import { Plus } from 'lucide-react';

type Props = {
  workspaceId: number;
};

export function WorkspacePanel({ workspaceId }: Props) {
  const [provider, setProvider] = useState('claude');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { sessions, createSession, busy } = useSessions(workspaceId);

  const handleStartSession = async () => {
    const session = await createSession(provider);
    if (session) setActiveSessionId(session.id);
  };

  return (
    <div className="workspace-panel">
      {!activeSessionId ? (
        <div className="workspace-start">
          <ProviderSelector selected={provider} onSelect={setProvider} />
          <button
            className="button primary"
            onClick={handleStartSession}
            disabled={busy}
          >
            <Plus size={16} /> New {provider} session
          </button>
          {sessions.length > 0 && (
            <div className="recent-sessions">
              <h3>Recent sessions</h3>
              {sessions.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  className="session-row"
                  onClick={() => setActiveSessionId(s.id)}
                >
                  <span>{s.title || 'Untitled'}</span>
                  <small>{s.provider}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ChatView sessionId={activeSessionId} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for provider selector and workspace panel**

Append to `src/App.css`:
```css
.provider-selector {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem;
  background: #313244;
  border-radius: 8px;
  margin-bottom: 1rem;
}
.provider-tab {
  flex: 1;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #a6adc8;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
}
.provider-tab.active {
  background: #89b4fa;
  color: #11111b;
}
.workspace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.workspace-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  gap: 1rem;
}
.recent-sessions {
  width: 100%;
  max-width: 400px;
  margin-top: 1.5rem;
}
.recent-sessions h3 {
  font-size: 0.85rem;
  color: #a6adc8;
  margin-bottom: 0.5rem;
}
.session-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: #313244;
  border: none;
  border-radius: 6px;
  color: #cdd6f4;
  cursor: pointer;
  margin-bottom: 0.25rem;
}
.session-row:hover {
  background: #45475a;
}
.session-row small {
  color: #a6adc8;
  font-size: 0.75rem;
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors in new files

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ProviderSelector.tsx src/components/workspace/WorkspacePanel.tsx src/App.css
git commit -m "feat: add ProviderSelector and WorkspacePanel with session start/recent sessions"
```

---

## Phase 3: OpenCode Provider

### Task 3.1: Implement OpenCodeProvider

**Files:**
- Create: `src-tauri/src/providers/opencode.rs`

**Interfaces:**
- Consumes: `ChatProvider` trait from `providers/mod.rs`
- Produces: `OpenCodeProvider` struct — spawns `opencode chat` CLI

- [ ] **Step 1: Create `src-tauri/src/providers/opencode.rs`**

```rust
use super::{ChatMessage, ChatProvider, ProviderError, SessionContext, StreamEvent, ToolDefinition};
use tokio::process::Command;
use tokio::io::AsyncBufReadExt;

pub struct OpenCodeProvider;

impl OpenCodeProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl ChatProvider for OpenCodeProvider {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn display_name(&self) -> &'static str {
        "OpenCode"
    }

    async fn send_message(
        &self,
        session: &SessionContext,
        message: &str,
        history: &[ChatMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<StreamEvent>,
    ) -> Result<(), ProviderError> {
        let mut child = Command::new("opencode")
            .arg("chat")
            .arg("--message")
            .arg(message)
            .arg("--project")
            .arg(&session.project_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ProviderError::Unknown(format!("Failed to spawn opencode: {}", e)))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProviderError::Unknown("No stdout from opencode".into()))?;

        let mut reader = tokio::io::BufReader::new(stdout).lines();
        let mut full_output = String::new();

        while let Ok(Some(line)) = reader.next_line().await {
            full_output.push_str(&line);
            full_output.push('\n');
            let _ = tx.send(StreamEvent::TextDelta { delta: line }).await;
        }

        let status = child.wait().await.map_err(|e| {
            ProviderError::Unknown(format!("opencode process error: {}", e))
        })?;

        if !status.success() {
            return Err(ProviderError::Unknown(
                format!("opencode exited with code {:?}", status.code()),
            ));
        }

        let _ = tx
            .send(StreamEvent::SessionCompleted {
                input_tokens: 0,
                output_tokens: 0,
            })
            .await;

        Ok(())
    }
}
```

- [ ] **Step 2: Register OpenCode in providers/mod.rs**

Update `src-tauri/src/providers/mod.rs`:
- Add `pub mod opencode;` after `pub mod claude;`
- Update `provider_registry()` to include OpenCode:
```rust
pub fn provider_registry() -> Vec<Box<dyn ChatProvider>> {
    vec![
        Box::new(crate::providers::claude::ClaudeProvider::new()),
        Box::new(crate::providers::opencode::OpenCodeProvider::new()),
    ]
}
```

- [ ] **Step 3: Verify compilation**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/providers/opencode.rs src-tauri/src/providers/mod.rs
git commit -m "feat: implement OpenCodeProvider via CLI spawn with line-by-line streaming"
```

---

## Phase 4: History + Diff Viewer

### Task 4.1: Create SessionList component (History panel)

**Files:**
- Create: `src/components/workspace/SessionList.tsx`

**Interfaces:**
- Consumes: `useSessions` hook
- Produces: `SessionList` component — shows past sessions with view/delete/resume

- [ ] **Step 1: Create `src/components/workspace/SessionList.tsx`**

```tsx
import { useSessions, type SessionInfo } from '../../hooks/useSessions';
import { Trash2, MessageSquare } from 'lucide-react';

type Props = {
  workspaceId: number;
  onSelectSession: (id: string) => void;
};

export function SessionList({ workspaceId, onSelectSession }: Props) {
  const { sessions, deleteSession, refresh } = useSessions(workspaceId);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
  };

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <MessageSquare size={30} />
        <h3>No sessions yet</h3>
        <p>Start a chat to see your history here.</p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((s) => (
        <button
          key={s.id}
          className="session-row"
          onClick={() => onSelectSession(s.id)}
        >
          <MessageSquare size={16} />
          <span>
            <strong>{s.title || 'Untitled session'}</strong>
            <small>
              {s.provider} · {new Date(s.updatedAt).toLocaleDateString()}
            </small>
          </span>
          <button
            className="icon-button danger"
            onClick={(e) => handleDelete(s.id, e)}
            aria-label="Delete session"
          >
            <Trash2 size={14} />
          </button>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/SessionList.tsx
git commit -m "feat: add SessionList component for history panel"
```

---

## Phase 5: Batch Operations (SkillDrop Absorption)

### Task 5.1: Add batch install backend

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `batch_install` Tauri command — installs multiple skills from GitHub

- [ ] **Step 1: Add batch_install command to lib.rs**

In `src-tauri/src/lib.rs`, add after the `install_github` command:

```rust
#[tauri::command]
fn batch_install_gitub(requests: Vec<InstallRequest>) -> Result<Dashboard, String> {
    for req in &requests {
        skills::install(req.clone())?;
    }
    storage::activity("batch_install", &format!("Batch installed {} skills", requests.len()))?;
    snapshot()
}
```

- [ ] **Step 2: Register command in invoke_handler**

Add `batch_install_github` to the invoke_handler list in `lib.rs`.

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add batch_install_github Tauri command"
```

### Task 5.2: Add batch selection UI to Skills panel

**Files:**
- Modify: `src/App.tsx` (add checkbox selection and batch action bar to skills list)

The batch UI additions are small enough to handle during Phase 6 (Integration) since they touch App.tsx which is already being restructured for tab navigation.

- [ ] **Step 1: Defer to Phase 6**

This task will be completed as part of the Integration phase when we restructure App.tsx.

---

## Phase 6: Integration

### Task 6.1: Restructure App.tsx with tab navigation

**Files:**
- Modify: `src/App.tsx`

**Changes:**
- Add `'workspace'` and `'history'` to the `View` type
- Add `'Workspace'` and `'History'` to the nav array
- Import and render `WorkspacePanel` when `view === 'workspace'`
- Import and render `SessionList` when `view === 'history'`
- When switching to `'workspace'`, user selects a workspace first (use first workspace if one exists)

- [ ] **Step 1: Update View type and nav**

In App.tsx, line 91, change:
```typescript
type View = 'home' | 'agents' | 'skills' | 'sources' | 'workspaces' | 'activity' | 'settings';
```
to:
```typescript
type View = 'home' | 'agents' | 'skills' | 'sources' | 'workspaces' | 'activity' | 'settings' | 'workspace' | 'history';
```

In the nav array (line 102-109), add two entries after 'workspaces':
```typescript
['workspace', Bot, 'Workspace'],
['history', Activity, 'History'],
```

- [ ] **Step 2: Import new components**

Add imports at top of App.tsx:
```typescript
import { WorkspacePanel } from './components/workspace/WorkspacePanel';
import { SessionList } from './components/workspace/SessionList';
```

- [ ] **Step 3: Add view rendering for workspace and history**

In the `content()` function, before the `return` at the end (the settings fallback), add:

```typescript
if (view === 'workspace') {
  const ws = dashboard.workspaces[0];
  if (!ws) {
    return (
      <EmptyState
        icon={Folder}
        title="Add a project first"
        body="Add a workspace folder to start chatting with AI."
        action={<Button kind="primary" onClick={addWorkspace}><FolderOpen size={16} /> Add project</Button>}
      />
    );
  }
  return <WorkspacePanel workspaceId={ws.id} />;
}

if (view === 'history') {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  // This needs to be at component level — move to App scope
}
```

Actually, the history view needs state. Let me revise — we'll use a simpler approach:

```typescript
if (view === 'workspace') {
  const ws = dashboard.workspaces[0];
  if (!ws) return (
    <EmptyState icon={Folder} title="Add a project first"
      body="Add a workspace folder to start chatting with AI."
      action={<Button kind="primary" onClick={addWorkspace}><FolderOpen size={16} /> Add project</Button>} />
  );
  return <div className="panel-fill"><WorkspacePanel workspaceId={ws.id} /></div>;
}

if (view === 'history') {
  const ws = dashboard.workspaces[0];
  if (!ws) return (
    <EmptyState icon={Folder} title="Add a project first"
      body="Add a workspace to see session history."
      action={<Button kind="primary" onClick={addWorkspace}><FolderOpen size={16} /> Add project</Button>} />
  );
  return (
    <div className="panel-fill">
      <SectionTitle title="Session History" body="Past chat sessions in this workspace." />
      <SessionList workspaceId={ws.id} onSelectSession={(id) => {
        setView('workspace');
        // We'd need a way to pass the session ID — for now, sessions load via WorkspacePanel's recent sessions
      }} />
    </div>
  );
}
```

- [ ] **Step 4: Add batch checkboxes to skills list**

In the skills list rendering (around line 853), add a checkbox column before each skill:
```tsx
<input type="checkbox" className="skill-checkbox" onClick={(e) => e.stopPropagation()} />
```

And add a batch action bar that appears when checkboxes are checked:
```tsx
{selectedSkills.length > 0 && (
  <div className="batch-actions">
    <span>{selectedSkills.length} selected</span>
    <Button kind="primary" onClick={batchInstall}>Install to all agents</Button>
  </div>
)}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Vite build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/
git commit -m "feat: integrate workspace and history panels, tab navigation, batch skill selection"
```

### Task 6.2: Archive AgentOS and SkillDrop

**Files:**
- Create: `archive/agentos/` (copy from C:\Projetos\AgentOS)
- Create: `archive/skilldrop/` (copy from C:\Projetos\X.dll)
- Create: `archive/README.md`

- [ ] **Step 1: Copy AgentOS**

Run:
```powershell
New-Item -ItemType Directory -Force -Path archive\agentos
Copy-Item -Path C:\Projetos\AgentOS\* -Destination archive\agentos\ -Recurse -Exclude node_modules,.git
```

- [ ] **Step 2: Copy SkillDrop**

Run:
```powershell
New-Item -ItemType Directory -Force -Path archive\skilldrop
Copy-Item -Path C:\Projetos\X.dll\* -Destination archive\skilldrop\ -Recurse
```

- [ ] **Step 3: Create archive README**

`archive/README.md`:
```markdown
# Archived projects

These projects have been absorbed into Axis v2 and are kept here as reference.

- **agentos/** — Multi-provider AI workspace (Electron + Fastify). Chat/session logic rewritten in Rust for Axis v2.
- **skilldrop/** — Batch SKILL.md processor (Python + PySide6). Functionality absorbed as native batch operations in the Skills panel.

Both are read-only archives. Do not edit files here.
```

- [ ] **Step 4: Bump versions**

In `package.json`: change `"version": "0.1.0"` to `"version": "0.2.0"`
In `src-tauri/Cargo.toml`: change `version = "0.1.0"` to `version = "0.2.0"`
In `src-tauri/tauri.conf.json`: change `"version": "0.1.0"` to `"version": "0.2.0"`

- [ ] **Step 5: Commit**

```bash
git add archive/ package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: archive AgentOS and SkillDrop, bump version to 0.2.0"
```

### Task 6.3: Final verification

- [ ] **Step 1: Run full Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: all tests pass

- [ ] **Step 2: Run full frontend build**

```bash
npm run build
```
Expected: Vite build succeeds, TypeScript no errors

- [ ] **Step 3: Verify existing functionality preserved**

Run `npm run check` (tsc + vite build).
Start app with `npm run tauri dev` and verify:
- Home dashboard loads
- Skills are discovered
- Agents are detected
- Workspaces list works

- [ ] **Step 4: Manual smoke test (if ANTHROPIC_API_KEY is set)**

- Select Workspace tab
- Start a Claude session
- Send a message
- See streaming response
- Check History tab for the session

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final integration verification, all tests passing"
```

---

## Summary

| Phase | Tasks | Commits |
|-------|-------|---------|
| 1. Chat Backend | 5 | 5 |
| 2. Streaming + UI | 4 | 4 |
| 3. OpenCode Provider | 1 | 1 |
| 4. History + Diff | 1 | 1 |
| 5. Batch Operations | 2 | 1 |
| 6. Integration | 3 | 3 |
| **Total** | **16 tasks** | **15 commits** |

**Validation checkpoints after each phase:**
- Phase 1: `cargo test` passes, `cargo build` compiles
- Phase 2: `npm run build` succeeds, chat UI renders (no API key needed for basic render)
- Phase 3: `cargo check` passes, OpenCode provider registered
- Phase 4: History panel shows past sessions
- Phase 5: Batch install command compiles, UI checkboxes render
- Phase 6: Full `npm run build` + `cargo test` pass, smoke test works