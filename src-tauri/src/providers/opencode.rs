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
        _history: &[ChatMessage],
        _tools: &[ToolDefinition],
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