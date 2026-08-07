import type { StorageProvider } from "@agentos/shared";
import { SqliteStorageProvider } from "./sqlite-storage-provider";

export function openDatabase(path: string): StorageProvider {
  return new SqliteStorageProvider(path);
}
