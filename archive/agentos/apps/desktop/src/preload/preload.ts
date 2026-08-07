// apps/desktop/src/preload/preload.ts
import { contextBridge } from "electron";

function readArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) throw new Error(`Missing launch argument: ${name}`);
  return arg.slice(prefix.length);
}

contextBridge.exposeInMainWorld("agentos", {
  getConnectionInfo: () => ({
    port: Number(readArg("agentos-port")),
    sessionToken: readArg("agentos-token"),
  }),
});
