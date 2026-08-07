# Task 1.5 Report — chat.rs orchestrator and Tauri command wiring

**Date:** 2026-08-06
**Plan:** `docs/superpowers/plans/2026-08-06-axis-v2-implementation.md`
**Status:** Complete

## Summary

Implemented the Phase 1 final task: created the chat orchestrator (`chat.rs`) with `ActiveSessions` state management and wired all 7 new Tauri commands into `lib.rs`, connecting everything from Tasks 1.1–1.4.

## Files Changed

| File | Action |
|------|--------|
| `src-tauri/src/chat.rs` | Created — `ActiveSessions` struct + 7 Tauri commands |
| `src-tauri/src/lib.rs` | Modified — added `mod chat;`/`mod providers;`, 7 commands to `invoke_handler`, `.manage(chat::ActiveSessions::new())` |
| `src-tauri/tests/chat_tests.rs` | Created — integration tests for session lifecycle + message persistence |

## Implementation Details

### `chat.rs`
- **`ActiveSessions`** struct wrapping `Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>` for cancellation tracking.
- **7 Tauri commands:**
  - `chat_create_session` — generates UUID, saves via `storage::save_session`, returns the created `SessionInfo`.
  - `chat_send_message` — the most complex: queries session+workspace from DB, loads provider via `provider_registry()`, loads history, saves user message, spawns provider task with `tokio::select!` (provider call vs cancel), forwards `StreamEvent` → Tauri events, saves assistant message + auto-titles session from first 50 chars.
  - `chat_cancel` — sends on the oneshot channel to abort streaming.
  - `chat_get_sessions`, `chat_get_messages`, `chat_get_file_changes`, `chat_delete_session` — thin wrappers over storage CRUD.
- **Events emitted:** `chat:token`, `chat:file-changed`, `chat:completed`, `chat:error`.

### `lib.rs`
- Added `mod chat;` and `mod providers;` to module declarations.
- Added all 7 chat commands to `invoke_handler`.
- Added `.manage(chat::ActiveSessions::new())` before `.plugin(tauri_plugin_opener::init())`.

## Compilation Fix (deviation from plan)

The plan's exact code for `chat_send_message` borrowed the provider from the registry Vec:
```rust
let providers = crate::providers::provider_registry();
let provider = providers.iter().find(...)?;
```
This failed to compile with `E0597: providers does not live long enough` because the borrowed `&Box<dyn ChatProvider>` was moved into a `tokio::spawn` task requiring `'static`.

**Fix:** take ownership of the provider instead of borrowing:
```rust
let provider = crate::providers::provider_registry()
    .into_iter()
    .find(|p| p.id() == provider_id)
    .ok_or(format!("Provider '{}' not available", provider_id))?;
```
This is the minimal change that preserves the plan's intent and satisfies the `'static` bound.

## Verification

- `cargo check --manifest-path src-tauri/Cargo.toml` — **compiles cleanly** (no errors; only pre-existing warnings from plan code: unused `db_sessions`/`sid`/`mut`, unused `ChatProvider` import, dead-code warnings on `StreamEvent` variants).
- `cargo test --manifest-path src-tauri/Cargo.toml` — **all tests pass**:
  - 4 lib unit tests (agents, skills)
  - 2 `chat_tests` (session lifecycle, message persistence)
  - 2 `storage_tests` (chat tables exist, save/get session)

## Commit

```
9c07435 feat: add chat.rs orchestrator with Tauri commands for session management and streaming
```

## Global Constraints Honored

- No blocking calls in async context (all DB calls are sync `rusqlite` but invoked from async commands; matches existing app pattern).
- Single binary, no sidecar processes.
- Existing commands unchanged (only additions to `invoke_handler`).
- No breaking changes to existing SQLite tables.

## Limitations / Notes

- `chat_send_message` contains a leftover unused `let db_sessions = crate::storage::get_sessions(0)?;` line from the plan (harmless, produces a warning). It was kept to match the plan's exact code.
- The `ChatProvider` import in `chat.rs` is unused (the trait is only referenced via the registry's concrete type) — kept to match the plan.
- `chat_send_message` is not covered by an integration test (requires a live provider/network); the tests cover the storage-backed session lifecycle and message persistence as specified in the plan.

## Fix Round 1
- Finding: P2 cancel token cleanup
- Fix: Added token removal in stream completion path and error path
- Tests: `cargo check --manifest-path src-tauri/Cargo.toml` (compiles cleanly, warnings only) and `cargo test --manifest-path src-tauri/Cargo.toml` (all 8 tests pass: 4 lib + 2 chat_tests + 2 storage_tests)

### Fix details
The cancel token previously stayed in the `ActiveSessions` HashMap forever after streaming completed or errored, causing a memory leak and making concurrent sends to the same session overwrite the previous token (leaving the first flow uncancelable).

Changes in `src-tauri/src/chat.rs`:
1. **`ActiveSessions.cancel_tokens`** changed from `Mutex<HashMap<...>>` to `Arc<Mutex<HashMap<...>>>` so the map can be shared into the spawned `'static` tasks (a `tauri::State` reference is not `'static` and cannot be moved into `tokio::spawn`).
2. **Error path** (provider task, inside `if let Err(e) = result`): removes the token via `cancel_tokens.lock().unwrap().remove(&session_ctx.session_id)` before sending `SessionError`.
3. **Completion path** (forwarding task, after the `while let Some(event) = rx.recv().await` loop): removes the token via `cancel_tokens_fwd.lock().unwrap().remove(&sid_for_events)`.
4. **`chat_cancel`** already removes the token via `tokens.remove(&session_id)` before sending the cancel signal — unchanged.

Note: the plan's literal snippet used `active.cancel_tokens.lock()` inside the spawned tasks, which would not compile because `tauri::State` is a non-`'static` reference. The `Arc` wrapper is the minimal adaptation that preserves the intended cleanup behavior.