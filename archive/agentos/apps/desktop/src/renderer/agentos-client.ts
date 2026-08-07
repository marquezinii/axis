// apps/desktop/src/renderer/agentos-client.ts
import type {
  AgentEvent,
  ProjectDTO,
  SessionDTO,
} from "@agentos/shared";

export interface ConnectionInfo {
  port: number;
  sessionToken: string;
}

export class AgentosClient {
  constructor(private connection: ConnectionInfo) {}

  private baseUrl(): string {
    return `http://127.0.0.1:${this.connection.port}`;
  }

  private async request<T>(pathName: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${pathName}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${this.connection.sessionToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${pathName} (${response.status})`);
    }
    return response.json();
  }

  listProjects(): Promise<ProjectDTO[]> {
    return this.request("/projects");
  }

  registerProject(folderPath: string): Promise<ProjectDTO> {
    return this.request("/projects", {
      method: "POST",
      body: JSON.stringify({ path: folderPath }),
    });
  }

  createSession(projectId: string, providerId: string): Promise<SessionDTO> {
    return this.request("/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId, providerId }),
    });
  }

  streamSession(
    sessionId: string,
    onEvent: (event: AgentEvent) => void
  ): () => void {
    const ws = new WebSocket(
      `ws://127.0.0.1:${this.connection.port}/ws/sessions/${sessionId}?token=${this.connection.sessionToken}`
    );
    ws.onmessage = (message) => {
      onEvent(JSON.parse(message.data as string));
    };
    return () => ws.close();
  }

  sendMessage(sessionId: string, text: string): void {
    const ws = new WebSocket(
      `ws://127.0.0.1:${this.connection.port}/ws/sessions/${sessionId}?token=${this.connection.sessionToken}`
    );
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "send_message", text }));
      ws.close();
    };
    ws.onerror = (err) => {
      console.error("AgentOS sendMessage WS error:", err);
    };
  }
}
