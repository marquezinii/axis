// apps/backend/src/index.ts
import { buildServer } from "./server";
import { generateSessionToken } from "./auth/session-token";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function main() {
  const sessionToken = generateSessionToken();
  const dbPath = path.join(os.homedir(), ".agentos", "agentos.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const app = await buildServer({ dbPath, sessionToken });

  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const url = new URL(address);

  // Electron main process reads this line from stdout to learn the
  // dynamic port and per-launch token — see Task 8.
  console.log(
    JSON.stringify({ type: "ready", port: Number(url.port), sessionToken })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
