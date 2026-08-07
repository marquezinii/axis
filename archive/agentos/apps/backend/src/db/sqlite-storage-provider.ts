import { DatabaseSync } from "node:sqlite";
import type {
  PreparedStatement,
  RunResult,
  StorageProvider,
} from "@agentos/shared";

class SqlitePreparedStatement implements PreparedStatement {
  constructor(private statement: ReturnType<DatabaseSync["prepare"]>) {}

  run(...params: unknown[]): RunResult {
    const result = this.statement.run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.statement.get(...(params as never[])) as
      | Record<string, unknown>
      | undefined;
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this.statement.all(...(params as never[])) as Record<
      string,
      unknown
    >[];
  }
}

/**
 * Only place in the codebase allowed to import `node:sqlite`. Everything
 * else depends on `StorageProvider` from `@agentos/shared`.
 */
export class SqliteStorageProvider implements StorageProvider {
  private db: DatabaseSync;
  private inTransaction = false;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  prepare(sql: string): PreparedStatement {
    return new SqlitePreparedStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    const wrapped = (...args: Parameters<T>): ReturnType<T> => {
      if (this.inTransaction) {
        throw new Error(
          "SqliteStorageProvider.transaction() does not support nesting — a transaction is already in progress"
        );
      }
      this.inTransaction = true;
      this.db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      } finally {
        this.inTransaction = false;
      }
    };
    return wrapped as T;
  }

  close(): void {
    this.db.close();
  }
}
