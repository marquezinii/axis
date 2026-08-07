// apps/backend/src/core/session-manager.ts
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ProviderAdapter,
  SessionDTO,
  SessionStatus,
  StorageProvider,
} from "@agentos/shared";
import { ProviderError } from "@agentos/shared";
import type { EventBus } from "./event-bus";

interface SessionRow {
  id: string;
  project_id: string;
  provider_id: string;
  model: string | null;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

function rowToDto(row: SessionRow): SessionDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionManager {
  constructor(
    private db: StorageProvider,
    private bus: EventBus,
    private adapter: ProviderAdapter
  ) {}

  createSession(projectId: string, providerId: string): SessionDTO {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, provider_id, model, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'created', ?, ?)`
      )
      .run(id, projectId, providerId, now, now);
    return this.getSession(id);
  }

  getSession(id: string): SessionDTO {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    if (!row) throw new Error(`Session not found: ${id}`);
    return rowToDto(row);
  }

  private setStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }

  private insertMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, tool_events_json, created_at)
         VALUES (?, ?, ?, ?, '[]', ?)`
      )
      .run(randomUUID(), sessionId, role, content, new Date().toISOString());
  }

  private insertFileChange(event: {
    sessionId: string;
    path: string;
    changeType: "created" | "modified" | "deleted";
    diff: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO file_changes (id, session_id, path, change_type, diff, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        event.sessionId,
        event.path,
        event.changeType,
        event.diff,
        new Date().toISOString()
      );
  }

  private getProjectPath(projectId: string): string {
    const row = this.db
      .prepare("SELECT path FROM projects WHERE id = ?")
      .get(projectId) as { path: string } | undefined;
    if (!row) throw new Error(`Project not found: ${projectId}`);
    return row.path;
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    let assistantText = "";

    try {
      const session = this.getSession(sessionId);
      const projectPath = this.getProjectPath(session.projectId);

      this.db.transaction(() => {
        this.insertMessage(sessionId, "user", text);
        this.setStatus(sessionId, "executing");
      })();

      for await (const event of this.adapter.sendMessage({ sessionId, text, projectPath })) {
        this.bus.publish(event);
        this.handleEvent(event, (delta) => {
          assistantText += delta;
        });
      }
      this.db.transaction(() => {
        if (assistantText.length > 0) {
          this.insertMessage(sessionId, "assistant", assistantText);
        }
        this.setStatus(sessionId, "completed");
      })();
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : "UNKNOWN";
      const message = err instanceof Error ? err.message : String(err);
      const status: SessionStatus = code === "CANCELLED" ? "interrupted" : "failed";
      this.setStatus(sessionId, status);
      this.bus.publish({
        type: "session_error",
        sessionId,
        code,
        message,
      });
    }
  }

  private handleEvent(event: AgentEvent, onTextDelta: (text: string) => void): void {
    switch (event.type) {
      case "text_delta":
        onTextDelta(event.text);
        break;
      case "file_changed":
        this.insertFileChange({
          sessionId: event.sessionId,
          path: event.path,
          changeType: event.changeType,
          diff: event.diff,
        });
        break;
      default:
        break;
    }
  }
}
