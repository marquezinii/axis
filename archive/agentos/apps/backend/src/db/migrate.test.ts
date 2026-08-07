import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./connection";
import { runMigrations } from "./migrate";

let dbPath: string;

afterEach(() => {
  if (dbPath && fs.existsSync(dbPath)) fs.rmSync(dbPath);
  const bakPattern = dbPath ? `${dbPath}.bak-` : null;
  if (bakPattern) {
    for (const file of fs.readdirSync(path.dirname(dbPath))) {
      if (file.startsWith(path.basename(bakPattern))) {
        fs.rmSync(path.join(path.dirname(dbPath), file));
      }
    }
  }
});

describe("runMigrations", () => {
  it("creates all core tables and records the migration version", () => {
    dbPath = path.join(os.tmpdir(), `agentos-test-${Date.now()}.db`);
    const storage = openDatabase(dbPath);

    runMigrations(storage, dbPath);

    const tables = storage
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((row) => row.name as string);

    expect(tables).toEqual(
      expect.arrayContaining([
        "file_changes",
        "memory_entries",
        "messages",
        "projects",
        "provider_credentials",
        "providers",
        "schema_migrations",
        "sessions",
        "tasks",
      ])
    );

    const version = storage
      .prepare(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
      )
      .get() as { version: number };
    expect(version.version).toBe(1);

    storage.close();
  });

  it("is idempotent — running twice does not error and does not create a backup file (purely additive migration)", () => {
    dbPath = path.join(os.tmpdir(), `agentos-test-idempotent-${Date.now()}.db`);
    const storage = openDatabase(dbPath);
    runMigrations(storage, dbPath);
    expect(() => runMigrations(storage, dbPath)).not.toThrow();

    const files = fs.readdirSync(path.dirname(dbPath));
    const backups = files.filter((f) =>
      f.startsWith(`${path.basename(dbPath)}.bak-`)
    );
    expect(backups).toEqual([]);

    storage.close();
  });
});
