// apps/desktop/src/main/main.ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import { BackendSupervisor, type BackendReadyInfo } from "./backend-supervisor";

let mainWindow: BrowserWindow | null = null;
let supervisor: BackendSupervisor | null = null;

function resolveBackendEntry(): string {
  // In a packaged build, apps/backend/dist is copied into resources/backend/dist
  // via electron-builder's extraResources (see apps/desktop/package.json) since
  // it lives outside apps/desktop's own asar-packed "files". In dev, it's read
  // straight from the sibling workspace's build output.
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend/dist/index.mjs")
    : path.join(__dirname, "../../../backend/dist/index.mjs");
}

async function startBackendWithRetry(): Promise<BackendReadyInfo> {
  supervisor = new BackendSupervisor({
    // Electron's own binary acting as a plain Node process — the app must
    // not depend on a Node.js runtime the user happens to have installed
    // (see Global Constraints). ELECTRON_RUN_AS_NODE makes process.execPath
    // behave like `node`, running the script instead of launching the
    // Electron GUI.
    command: process.execPath,
    args: [resolveBackendEntry()],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });

  supervisor.onCrash(async () => {
    if (!supervisor) return;
    try {
      const info = await supervisor.start();
      mainWindow?.webContents.send("backend-reconnected", info);
    } catch (err) {
      console.error("Failed to restart AgentOS backend after crash:", err);
    }
  });

  return supervisor.start();
}

async function createWindow(): Promise<void> {
  const backendInfo = await startBackendWithRetry();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, "../../../../assets/icon/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [
        `--agentos-port=${backendInfo.port}`,
        `--agentos-token=${backendInfo.sessionToken}`,
      ],
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(createWindow).catch((err) => {
  // Without this, a rejected startup promise (e.g. the backend process
  // dying before printing its "ready" line) was an unhandled rejection:
  // no window ever opened and no error surfaced anywhere, which looked
  // indistinguishable from an indefinite hang.
  console.error("Failed to start AgentOS:", err);
  app.quit();
});

app.on("window-all-closed", async () => {
  await supervisor?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await supervisor?.stop();
});
