import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteStorageProvider } from "./sqlite-storage-provider";

let dbPath: string;

afterEach(() => {
  if (dbPath && fs.existsSync(dbPath)) fs.rmSync(dbPath);
});

describe("SqliteStorageProvider", () => {
  it("runs prepared statements and enforces foreign keys", () => {
    dbPath = path.join(os.tmpdir(), `agentos-storage-${Date.now()}.db`);
    const storage = new SqliteStorageProvider(dbPath);

    storage.exec(
      "CREATE TABLE parents (id TEXT PRIMARY KEY)"
    );
    storage.exec(
      "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id))"
    );

    expect(() =>
      storage.prepare("INSERT INTO children (id, parent_id) VALUES (?, ?)").run(
        "child-1",
        "missing-parent"
      )
    ).toThrow();

    storage.prepare("INSERT INTO parents (id) VALUES (?)").run("parent-1");
    storage
      .prepare("INSERT INTO children (id, parent_id) VALUES (?, ?)")
      .run("child-1", "parent-1");

    const row = storage
      .prepare("SELECT id FROM children WHERE id = ?")
      .get("child-1");
    expect(row).toEqual({ id: "child-1" });

    storage.close();
  });

  it("rolls back a transaction when the callback throws", () => {
    dbPath = path.join(os.tmpdir(), `agentos-storage-tx-${Date.now()}.db`);
    const storage = new SqliteStorageProvider(dbPath);
    storage.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");

    const insertBoth = storage.transaction(() => {
      storage.prepare("INSERT INTO items (id) VALUES (?)").run("a");
      storage.prepare("INSERT INTO items (id) VALUES (?)").run("a"); // duplicate PK -> throws
    });

    expect(() => insertBoth()).toThrow();

    const count = storage.prepare("SELECT COUNT(*) as c FROM items").get() as {
      c: number;
    };
    expect(count.c).toBe(0);

    storage.close();
  });

  it("throws a clear error when transaction() is nested, and resets state afterward", () => {
    dbPath = path.join(os.tmpdir(), `agentos-storage-nest-${Date.now()}.db`);
    const storage = new SqliteStorageProvider(dbPath);
    storage.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");

    const outer = storage.transaction(() => {
      storage.prepare("INSERT INTO items (id) VALUES (?)").run("a");
      const inner = storage.transaction(() => {
        storage.prepare("INSERT INTO items (id) VALUES (?)").run("b");
      });
      inner();
    });

    expect(() => outer()).toThrow(
      "SqliteStorageProvider.transaction() does not support nesting — a transaction is already in progress"
    );

    const count = storage.prepare("SELECT COUNT(*) as c FROM items").get() as {
      c: number;
    };
    expect(count.c).toBe(0);

    const insertOne = storage.transaction(() => {
      storage.prepare("INSERT INTO items (id) VALUES (?)").run("c");
    });
    insertOne();

    const countAfter = storage
      .prepare("SELECT COUNT(*) as c FROM items")
      .get() as { c: number };
    expect(countAfter.c).toBe(1);

    storage.close();
  });
});
