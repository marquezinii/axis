import type { ProviderErrorCode } from "./provider-adapter";

export interface TextDeltaEvent {
  type: "text_delta";
  sessionId: string;
  text: string;
}

export interface ToolCallStartedEvent {
  type: "tool_call_started";
  sessionId: string;
  toolName: string;
  toolCallId: string;
}

export interface ToolCallFinishedEvent {
  type: "tool_call_finished";
  sessionId: string;
  toolCallId: string;
  success: boolean;
}

export interface FileChangedEvent {
  type: "file_changed";
  sessionId: string;
  path: string;
  changeType: "created" | "modified" | "deleted";
  diff: string;
}

export interface SessionErrorEvent {
  type: "session_error";
  sessionId: string;
  code: ProviderErrorCode;
  message: string;
}

export interface SessionCompletedEvent {
  type: "session_completed";
  sessionId: string;
}

export type AgentEvent =
  | TextDeltaEvent
  | ToolCallStartedEvent
  | ToolCallFinishedEvent
  | FileChangedEvent
  | SessionErrorEvent
  | SessionCompletedEvent;
