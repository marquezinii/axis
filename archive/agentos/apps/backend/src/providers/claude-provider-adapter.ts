// apps/backend/src/providers/claude-provider-adapter.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  FileChangedEvent,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderModel,
  SendMessageOptions,
  StartSessionOptions,
} from "@agentos/shared";
import { ProviderError } from "@agentos/shared";

// Tool names whose successful tool_result carries a structured file-edit
// output (FileEditOutput / FileWriteOutput in the Claude Agent SDK's
// sdk-tools.d.ts) that we can turn into a file_changed AgentEvent. Confirmed
// against node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts: the
// SDK's built-in file tools are named "Edit" and "Write".
const FILE_EDIT_TOOL_NAMES = new Set(["Edit", "Write"]);

export class ClaudeProviderAdapter implements ProviderAdapter {
  readonly providerId = "claude";

  getCapabilities(): ProviderCapabilities {
    return { streaming: true, fileEdit: true, terminal: true, git: true };
  }

  async listModels(): Promise<ProviderModel[]> {
    return [
      { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
      { id: "claude-opus-5", displayName: "Claude Opus 5" },
    ];
  }

  async startSession(_options: StartSessionOptions): Promise<void> {
    // The Claude Agent SDK is stateless per-call in v1: each sendMessage()
    // call carries its own session context via the SDK's session resumption
    // options. No persistent handle to open here.
  }

  async *sendMessage(options: SendMessageOptions): AsyncIterable<AgentEvent> {
    const { sessionId, text, projectPath } = options;

    // Tracks tool_use blocks for file-editing tools (Edit/Write) keyed by
    // their tool_use id, so that when the matching tool_result arrives we
    // know to also emit a file_changed event.
    const pendingFileEdits = new Map<string, string>();

    try {
      for await (const sdkEvent of query({
        prompt: text,
        options: { cwd: projectPath },
      }) as AsyncIterable<any>) {
        for (const mapped of this.mapSdkEvent(sessionId, sdkEvent, pendingFileEdits)) {
          yield mapped;
        }
      }
      yield { type: "session_completed", sessionId };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  async cancel(_sessionId: string): Promise<void> {
    // v1: cancellation is cooperative via AbortController wiring in Task 6;
    // the adapter itself has no persistent handle to cancel directly.
  }

  // Maps a single raw SDK stream event to zero or more AgentEvents.
  //
  // The Claude Agent SDK's query() iterable yields top-level messages of
  // type "assistant" and "user" (see sdk.d.ts: SDKAssistantMessage /
  // SDKUserMessage) — NOT top-level "tool_use"/"tool_result" messages.
  // tool_use blocks live inside an assistant message's `message.content`
  // array; tool_result blocks live inside a user message's
  // `message.content` array, and the user message additionally carries a
  // `tool_use_result` field with the tool's full structured output (see
  // sdk-tools.d.ts FileEditOutput / FileWriteOutput for Edit/Write).
  private mapSdkEvent(
    sessionId: string,
    sdkEvent: any,
    pendingFileEdits: Map<string, string>
  ): AgentEvent[] {
    const events: AgentEvent[] = [];

    if (sdkEvent?.type === "assistant") {
      const content = sdkEvent.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text") {
          events.push({ type: "text_delta", sessionId, text: block.text });
        } else if (block.type === "tool_use") {
          events.push({
            type: "tool_call_started",
            sessionId,
            toolName: block.name,
            toolCallId: block.id,
          });
          if (FILE_EDIT_TOOL_NAMES.has(block.name)) {
            pendingFileEdits.set(block.id, block.name);
          }
        }
      }
      return events;
    }

    if (sdkEvent?.type === "user") {
      const content = sdkEvent.message?.content ?? [];
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const toolCallId = block.tool_use_id;
        const success = !block.is_error;
        events.push({
          type: "tool_call_finished",
          sessionId,
          toolCallId,
          success,
        });

        const editedToolName = pendingFileEdits.get(toolCallId);
        pendingFileEdits.delete(toolCallId);
        if (editedToolName && success) {
          const fileChanged = this.buildFileChangedEvent(
            sessionId,
            editedToolName,
            sdkEvent.tool_use_result
          );
          if (fileChanged) events.push(fileChanged);
        }
      }
      return events;
    }

    return events;
  }

  // Builds a file_changed event from the SDK's structured tool_use_result
  // for the Edit/Write tools (FileEditOutput / FileWriteOutput in
  // sdk-tools.d.ts). Uses the SDK-provided gitDiff.patch when present
  // (a real unified diff), falling back to reconstructing a unified-diff-
  // style string from structuredPatch hunks, and finally to a plain
  // description if neither is available — never a fabricated diff.
  private buildFileChangedEvent(
    sessionId: string,
    toolName: string,
    toolUseResult: any
  ): FileChangedEvent | null {
    if (!toolUseResult || typeof toolUseResult !== "object") return null;

    const path: string | undefined = toolUseResult.filePath;
    if (!path) return null;

    let changeType: "created" | "modified" | "deleted" = "modified";
    if (toolName === "Write" && toolUseResult.type === "create") {
      changeType = "created";
    } else if (toolName === "Write" && toolUseResult.originalFile === null) {
      changeType = "created";
    }

    let diff: string;
    if (toolUseResult.gitDiff?.patch) {
      diff = toolUseResult.gitDiff.patch;
    } else if (Array.isArray(toolUseResult.structuredPatch) && toolUseResult.structuredPatch.length > 0) {
      diff = toolUseResult.structuredPatch
        .map(
          (hunk: any) =>
            `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n` +
            (hunk.lines ?? []).join("\n")
        )
        .join("\n");
    } else {
      // No structured diff content was available from the SDK for this
      // tool result — approximate with a plain description rather than
      // fabricating diff content.
      diff = `${toolName} applied to ${path} (no diff content provided by SDK tool result)`;
    }

    return { type: "file_changed", sessionId, path, changeType, diff };
  }

  private normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    if (lower.includes("auth") || lower.includes("unauthorized")) {
      return new ProviderError("AUTH_EXPIRED", message, err);
    }
    if (lower.includes("rate limit")) {
      return new ProviderError("RATE_LIMITED", message, err);
    }
    if (lower.includes("quota") || lower.includes("credit")) {
      return new ProviderError("QUOTA_EXCEEDED", message, err);
    }
    if (lower.includes("context") && lower.includes("exceed")) {
      return new ProviderError("CONTEXT_EXCEEDED", message, err);
    }
    if (lower.includes("cancel") || lower.includes("abort")) {
      return new ProviderError("CANCELLED", message, err);
    }
    if (lower.includes("timeout") || lower.includes("unavailable")) {
      return new ProviderError("PROVIDER_UNAVAILABLE", message, err);
    }
    return new ProviderError("UNKNOWN", message, err);
  }
}
