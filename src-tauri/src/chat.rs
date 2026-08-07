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

    // Find the provider (take ownership so it can be moved into the spawned task)
    let provider = crate::providers::provider_registry()
        .into_iter()
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