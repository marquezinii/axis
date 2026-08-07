import type { StorageProvider } from "@agentos/shared";
import fs from "node:fs";
import path from "node:path";

interface Migration {
  version: number;
  file: string;
}

const MIGRATIONS: Migration[] = [{ version: 1, file: "001_init.sql" }];

// Matches actual destructive DDL/DML statements (DROP TABLE, ALTER TABLE,
// DELETE FROM), while deliberately not matching "ON DELETE CASCADE" / "ON
// DELETE SET NULL" foreign-key clauses, which are not destructive on their
// own and appear throughout purely-additive schema migrations.
const DESTRUCTIVE_PATTERN = /\bDROP\s+TABLE\b|\bALTER\s+TABLE\b|\bDELETE\s+FROM\b/i;

function isDestructive(sql: string): boolean {
  return DESTRUCTIVE_PATTERN.test(sql);
}

function backupDatabaseFile(dbPath: string, version: number): void {
  if (!fs.existsSync(dbPath)) return; // nothing to back up yet (fresh DB)
  const backupPath = `${dbPath}.bak-${version}`;
  fs.copyFileSync(dbPath, backupPath);
}

export function runMigrations(
  storage: StorageProvider,
  dbPath: string
): void {
  storage.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );

  const appliedRow = storage
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null };
  const applied = appliedRow.v ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > applied).sort(
    (a, b) => a.version - b.version
  );

  const insertVersion = storage.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
  );

  for (const migration of pending) {
    const sql = fs.readFileSync(
      path.join(__dirname, "migrations", migration.file),
      "utf-8"
    );

    if (isDestructive(sql)) {
      backupDatabaseFile(dbPath, migration.version);
    }

    const applyMigration = storage.transaction(() => {
      storage.exec(sql);
      insertVersion.run(migration.version, new Date().toISOString());
    });
    applyMigration();
  }
}
