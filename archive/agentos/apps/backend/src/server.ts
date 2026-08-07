// apps/backend/src/server.ts
import Fastify, { type FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import { openDatabase } from "./db/connection";
import { runMigrations } from "./db/migrate";
import { EventBus } from "./core/event-bus";
import { SessionManager } from "./core/session-manager";
import { ProjectManager } from "./core/project-manager";
import { ClaudeProviderAdapter } from "./providers/claude-provider-adapter";
import { registerProjectRoutes } from "./routes/projects";
import { registerSessionRoutes } from "./routes/sessions";
import type { ProviderAdapter } from "@agentos/shared";

export interface BuildServerOptions {
  dbPath: string;
  sessionToken: string;
  /**
   * Injectable provider adapter, primarily for tests. Defaults to
   * ClaudeProviderAdapter when not provided.
   */
  adapter?: ProviderAdapter;
}

const PUBLIC_ROUTES = new Set(["/health"]);
const WS_SESSION_ROUTE = /^\/ws\/sessions\/[^/]+(\?.*)?$/;

export async function buildServer(
  options: BuildServerOptions
): Promise<FastifyInstance> {
  const db = openDatabase(options.dbPath);
  runMigrations(db, options.dbPath);

  db.prepare(
    "INSERT OR IGNORE INTO providers (id, name, kind, capabilities_json, enabled) VALUES (?, ?, ?, ?, 1)"
  ).run("claude", "Claude", "cli", JSON.stringify({
    streaming: true,
    fileEdit: true,
    terminal: true,
    git: true,
  }));

  const bus = new EventBus();
  const adapter = options.adapter ?? new ClaudeProviderAdapter();
  const sessionManager = new SessionManager(db, bus, adapter);
  const projectManager = new ProjectManager(db);

  const app = Fastify();
  await app.register(websocketPlugin);

  app.addHook("onClose", async () => {
    db.close();
  });

  app.addHook("onRequest", async (request, reply) => {
    if (PUBLIC_ROUTES.has(request.url)) return;
    // WebSocket upgrade requests authenticate via a `token` query param
    // inside the /ws/sessions/:id handler itself (browsers cannot set
    // custom headers on WS upgrade requests), so skip bearer-token auth here.
    if (WS_SESSION_ROUTE.test(request.url)) return;
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (token !== options.sessionToken) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  registerProjectRoutes(app, projectManager);
  registerSessionRoutes(app, sessionManager, db);

  app.get<{ Params: { id: string } }>(
    "/ws/sessions/:id",
    { websocket: true },
    (socket, request) => {
      const token = (request.query as { token?: string }).token;
      if (token !== options.sessionToken) {
        socket.close(4001, "unauthorized");
        return;
      }
      const sessionId = request.params.id;
      const unsubscribe = bus.subscribe(sessionId, (event) => {
        socket.send(JSON.stringify(event));
      });
      socket.on("close", unsubscribe);
      socket.on("message", (raw: Buffer) => {
        let parsed: { type?: string; text?: string };
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          // Ignore malformed client messages rather than crashing.
          return;
        }
        if (parsed.type === "send_message" && typeof parsed.text === "string") {
          sessionManager.sendMessage(sessionId, parsed.text).catch((err) => {
            console.error("Unhandled error in sendMessage:", err);
          });
        }
      });
    }
  );

  return app;
}
