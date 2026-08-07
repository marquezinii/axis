// apps/backend/src/server.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { buildServer } from "./server";
import type { ProviderAdapter, AgentEvent } from "@agentos/shared";

let dbPath: string;

function fakeAdapter(
  buildEvents: (sessionId: string) => AgentEvent[]
): ProviderAdapter {
  return {
    providerId: "claude",
    getCapabilities: () => ({
      streaming: true,
      fileEdit: true,
      terminal: true,
      git: true,
    }),
    listModels: async () => [{ id: "claude-sonnet-5", displayName: "Sonnet 5" }],
    startSession: async () => {},
    sendMessage: async function* (options) {
      for (const event of buildEvents(options.sessionId)) yield event;
    },
    cancel: async () => {},
  };
}

afterEach(() => {
  if (dbPath && fs.existsSync(dbPath)) fs.rmSync(dbPath);
});

describe("buildServer", () => {
  it("rejects HTTP requests without the correct bearer token", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-${Date.now()}.db`);
    const app = await buildServer({ dbPath, sessionToken: "correct-token" });

    const response = await app.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization: "Bearer wrong-token" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts HTTP requests with the correct bearer token and lists projects", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-2-${Date.now()}.db`);
    const app = await buildServer({ dbPath, sessionToken: "correct-token" });

    const response = await app.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization: "Bearer correct-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    await app.close();
  });

  it("rejects requests to a path that merely resembles the WS route without the correct bearer token", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-4-${Date.now()}.db`);
    const app = await buildServer({ dbPath, sessionToken: "correct-token" });

    const lookalikePaths = [
      "/ws/sessions/abc/extra",
      "/ws/sessions/",
      "/ws/sessionsx/abc",
      "/ws/other",
    ];

    for (const url of lookalikePaths) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }

    await app.close();
  });

  it("exposes an unauthenticated /health endpoint", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-3-${Date.now()}.db`);
    const app = await buildServer({ dbPath, sessionToken: "correct-token" });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("/ws/sessions/:id", () => {
  it("closes the connection with code 4001 and sends no events when the token is wrong", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-ws-1-${Date.now()}.db`);
    const app = await buildServer({
      dbPath,
      sessionToken: "correct-token",
      adapter: fakeAdapter(() => []),
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const url = new URL(address);

    try {
      const result = await new Promise<{ code: number; messages: unknown[] }>(
        (resolve, reject) => {
          const messages: unknown[] = [];
          const ws = new WebSocket(
            `ws://${url.hostname}:${url.port}/ws/sessions/some-session?token=wrong-token`
          );
          ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
          ws.on("close", (code) => resolve({ code, messages }));
          ws.on("error", reject);
        }
      );

      expect(result.code).toBe(4001);
      expect(result.messages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("delivers bus-published events to a connected client with the correct token", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-server-ws-2-${Date.now()}.db`);
    const buildEvents = (sessionId: string): AgentEvent[] => [
      { type: "text_delta", sessionId, text: "hello" },
      { type: "session_completed", sessionId },
    ];
    const app = await buildServer({
      dbPath,
      sessionToken: "correct-token",
      adapter: fakeAdapter(buildEvents),
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const url = new URL(address);

    // Create a real project + session so sendMessage's DB writes succeed.
    const projectRes = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { authorization: "Bearer correct-token" },
      payload: { path: "C:/demo" },
    });
    const project = projectRes.json();

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: "Bearer correct-token" },
      payload: { projectId: project.id, providerId: "claude" },
    });
    const session = sessionRes.json();
    const expectedEvents = buildEvents(session.id);

    try {
      const received = await new Promise<unknown[]>((resolve, reject) => {
        const messages: unknown[] = [];
        const ws = new WebSocket(
          `ws://${url.hostname}:${url.port}/ws/sessions/${session.id}?token=correct-token`
        );
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "send_message", text: "hi there" }));
        });
        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
          if (messages.length >= expectedEvents.length) {
            ws.close();
            resolve(messages);
          }
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("timed out waiting for events")), 5000);
      });

      expect(received).toEqual(expectedEvents);
    } finally {
      await app.close();
    }
  });
});
