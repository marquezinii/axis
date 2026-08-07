// apps/backend/src/routes/sessions.ts
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../core/session-manager";
import type { FileChangeDTO, StorageProvider } from "@agentos/shared";

interface FileChangeRow {
  id: string;
  session_id: string;
  path: string;
  change_type: "created" | "modified" | "deleted";
  diff: string;
  created_at: string;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager,
  db: StorageProvider
): void {
  app.post<{ Body: { projectId: string; providerId: string } }>(
    "/sessions",
    async (request) => {
      const { projectId, providerId } = request.body;
      return sessionManager.createSession(projectId, providerId);
    }
  );

  app.get<{ Params: { id: string } }>("/sessions/:id", async (request) => {
    return sessionManager.getSession(request.params.id);
  });

  app.get<{ Params: { id: string } }>(
    "/sessions/:id/file-changes",
    async (request): Promise<FileChangeDTO[]> => {
      const rows = db
        .prepare(
          "SELECT * FROM file_changes WHERE session_id = ? ORDER BY created_at"
        )
        .all(request.params.id) as unknown as FileChangeRow[];
      return rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        path: r.path,
        changeType: r.change_type,
        diff: r.diff,
        createdAt: r.created_at,
      }));
    }
  );
}
