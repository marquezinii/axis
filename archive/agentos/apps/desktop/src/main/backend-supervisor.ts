// apps/desktop/src/main/backend-supervisor.ts
import type { ChildProcess } from "node:child_process";
import { spawn as defaultSpawn } from "node:child_process";

export interface BackendReadyInfo {
  port: number;
  sessionToken: string;
}

export interface BackendSupervisorOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof defaultSpawn;
}

type CrashHandler = (exitCode: number | null) => void;

export class BackendSupervisor {
  private spawnFn: typeof defaultSpawn;
  private child: ChildProcess | null = null;
  private crashHandlers: CrashHandler[] = [];
  private expectedShutdown = false;

  constructor(private options: BackendSupervisorOptions) {
    this.spawnFn = options.spawnFn ?? defaultSpawn;
  }

  onCrash(handler: CrashHandler): void {
    this.crashHandlers.push(handler);
  }

  start(): Promise<BackendReadyInfo> {
    this.expectedShutdown = false;
    const child = this.spawnFn(this.options.command, this.options.args, {
      env: this.options.env
        ? { ...process.env, ...this.options.env }
        : process.env,
    });
    this.child = child;

    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) return;
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "ready") {
            settled = true;
            child.stdout?.off("data", onData);
            resolve({ port: parsed.port, sessionToken: parsed.sessionToken });
          }
        } catch {
          // ignore non-JSON stdout noise
        }
      };
      child.stdout?.on("data", onData);

      child.on("exit", (code) => {
        // If the process exits before we ever resolved via the "ready" line,
        // the start() promise must settle here (rejected) rather than hang
        // forever — this "error" event only fires for spawn-level failures,
        // not for the spawned process's own runtime crash/exit.
        if (!settled) {
          settled = true;
          reject(new Error(`Backend process exited before becoming ready (code ${code})`));
          return;
        }
        if (!this.expectedShutdown) {
          for (const handler of this.crashHandlers) handler(code);
        }
      });

      child.on("error", (err) => {
        settled = true;
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.expectedShutdown = true;
    this.child.kill();
    this.child = null;
  }
}
