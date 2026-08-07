use serde::{Deserialize, Serialize};

pub mod claude;

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
    vec![Box::new(crate::providers::claude::ClaudeProvider::new())]
}