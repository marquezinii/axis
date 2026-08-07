export const PROVIDER_ERROR_CODES = [
  "AUTH_EXPIRED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "TOOL_ERROR",
  "CONTEXT_EXCEEDED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderCapabilities {
  streaming: boolean;
  fileEdit: boolean;
  terminal: boolean;
  git: boolean;
}

export interface ProviderModel {
  id: string;
  displayName: string;
}

export interface StartSessionOptions {
  projectPath: string;
  sessionId: string;
}

export interface SendMessageOptions {
  sessionId: string;
  text: string;
  /**
   * Absolute path to the project's working directory. Passed through to the
   * provider so agent tool calls (file edits, shell commands, etc.) operate
   * on the correct project, not the backend process's own cwd.
   */
  projectPath: string;
}

/**
 * Everything above this layer (Session Manager, Provider Router, Event Bus,
 * Memory) depends only on this interface — never on a concrete provider.
 */
export interface ProviderAdapter {
  readonly providerId: string;
  getCapabilities(): ProviderCapabilities;
  listModels(): Promise<ProviderModel[]>;
  startSession(options: StartSessionOptions): Promise<void>;
  sendMessage(
    options: SendMessageOptions
  ): AsyncIterable<import("./events").AgentEvent>;
  cancel(sessionId: string): Promise<void>;
}
