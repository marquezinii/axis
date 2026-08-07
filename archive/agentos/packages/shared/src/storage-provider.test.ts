import { describe, it, expect } from "vitest";
import type { StorageProvider } from "./storage-provider";

describe("StorageProvider", () => {
  it("a minimal fake satisfies the interface (compile-time shape check)", () => {
    const calls: string[] = [];
    const fake: StorageProvider = {
      prepare: (sql: string) => {
        calls.push(sql);
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          get: () => undefined,
          all: () => [],
        };
      },
      exec: (sql: string) => {
        calls.push(sql);
      },
      transaction: (fn) => fn,
      close: () => {},
    };

    fake.exec("PRAGMA foreign_keys = ON");
    fake.prepare("SELECT 1").run();

    expect(calls).toEqual(["PRAGMA foreign_keys = ON", "SELECT 1"]);
  });
});
