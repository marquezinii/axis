// apps/backend/src/core/session-manager.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { EventBus } from "./event-bus";
import { SessionManager } from "./session-manager";
import type { ProviderAdapter, AgentEvent } from "@agentos/shared";

let dbPath: string;

afterEach(() => {
  if (dbPath && fs.existsSync(dbPath)) fs.rmSync(dbPath);
});

function fakeAdapter(events: AgentEvent[]): ProviderAdapter {
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
    sendMessage: async function* () {
      for (const event of events) yield event;
    },
    cancel: async () => {},
  };
}

describe("SessionManager", () => {
  it("creates a session row with status 'created'", () => {
    dbPath = path.join(os.tmpdir(), `agentos-sm-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    runMigrations(db, dbPath);
    db.prepare(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)"
    ).run("proj-1", "Demo", "C:/demo", new Date().toISOString());
    db.prepare(
      "INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)"
    ).run("claude", "Claude", "cli");

    const sm = new SessionManager(db, new EventBus(), fakeAdapter([]));
    const session = sm.createSession("proj-1", "claude");

    expect(session.status).toBe("created");
    expect(session.projectId).toBe("proj-1");
    db.close();
  });

  it("streams adapter events onto the bus, persists messages, and marks session completed", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-sm-2-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    runMigrations(db, dbPath);
    db.prepare(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)"
    ).run("proj-1", "Demo", "C:/demo", new Date().toISOString());
    db.prepare(
      "INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)"
    ).run("claude", "Claude", "cli");

    const adapter = fakeAdapter([]);
    const bus = new EventBus();
    const sm = new SessionManager(db, bus, adapter);
    const session = sm.createSession("proj-1", "claude");

    const received: AgentEvent[] = [];
    bus.subscribe(session.id, (e) => received.push(e));

    adapter.sendMessage = async function* () {
      yield { type: "text_delta", sessionId: session.id, text: "Hi" } as AgentEvent;
      yield { type: "session_completed", sessionId: session.id } as AgentEvent;
    };

    await sm.sendMessage(session.id, "hello");

    expect(received.map((e) => e.type)).toEqual(["text_delta", "session_completed"]);

    const updated = sm.getSession(session.id);
    expect(updated.status).toBe("completed");

    const messages = db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at")
      .all(session.id) as any[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].content).toBe("Hi");

    db.close();
  });

  it("resolves the session's project path and passes it to the adapter's sendMessage", async () => {
    dbPath = path.join(os.tmpdir(), `agentos-sm-3-${Date.now()}.db`);
    const db = openDatabase(dbPath);
    runMigrations(db, dbPath);
    db.prepare(
      "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)"
    ).run("proj-1", "Demo", "C:/demo/my-project", new Date().toISOString());
    db.prepare(
      "INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)"
    ).run("claude", "Claude", "cli");

    const adapter = fakeAdapter([]);
    const sm = new SessionManager(db, new EventBus(), adapter);
    const session = sm.createSession("proj-1", "claude");

    let capturedOptions: any = null;
    adapter.sendMessage = async function* (options: any) {
      capturedOptions = options;
      yield { type: "session_completed", sessionId: session.id } as AgentEvent;
    };

    await sm.sendMessage(session.id, "hello");

    expect(capturedOptions).toEqual({
      sessionId: session.id,
      text: "hello",
      projectPath: "C:/demo/my-project",
    });

    db.close();
  });
});
