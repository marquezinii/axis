// apps/desktop/src/main/backend-supervisor.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { BackendSupervisor } from "./backend-supervisor";

function fakeChildProcess() {
  const emitter = new EventEmitter() as any;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = vi.fn();
  return emitter;
}

describe("BackendSupervisor", () => {
  it("resolves start() with port and token once the backend prints the ready line", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const supervisor = new BackendSupervisor({ spawnFn, command: "node", args: ["index.js"] });

    const startPromise = supervisor.start();
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "ready", port: 54321, sessionToken: "tok" }) + "\n")
    );

    const result = await startPromise;
    expect(result).toEqual({ port: 54321, sessionToken: "tok" });
  });

  it("invokes the onCrash callback when the process exits unexpectedly", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const supervisor = new BackendSupervisor({ spawnFn, command: "node", args: ["index.js"] });

    const crashHandler = vi.fn();
    supervisor.onCrash(crashHandler);

    const startPromise = supervisor.start();
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ type: "ready", port: 1, sessionToken: "t" }) + "\n")
    );
    await startPromise;

    child.emit("exit", 1);

    expect(crashHandler).toHaveBeenCalledWith(1);
  });

  it("rejects start() if the process exits before printing the ready line", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const supervisor = new BackendSupervisor({ spawnFn, command: "node", args: ["index.js"] });

    const crashHandler = vi.fn();
    supervisor.onCrash(crashHandler);

    const startPromise = supervisor.start();
    child.emit("exit", 1);

    await expect(startPromise).rejects.toThrow(/exited before becoming ready/);
    // The initial-startup exit should settle the start() promise via rejection,
    // not also fire the onCrash mechanism (which is for later crashes).
    expect(crashHandler).not.toHaveBeenCalled();
  });
});
