export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface PreparedStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

/**
 * The only way any code outside `apps/backend/src/db/` touches persistence.
 * `SqliteStorageProvider` (apps/backend, built on node:sqlite) is the only
 * implementation in v1 — swapping storage engines later means writing a new
 * implementation of this interface, not touching Session Manager, Project
 * Manager, or routes.
 */
export interface StorageProvider {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  /**
   * Runs `fn` inside BEGIN/COMMIT, rolling back on throw. Returns a function
   * with the same signature as `fn` that performs this wrapping when called.
   *
   * Transactions are not reentrant/nestable: calling the returned function
   * (or `transaction()` again) from inside an already-running transaction on
   * the same provider throws, rather than issuing a nested BEGIN.
   */
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}
