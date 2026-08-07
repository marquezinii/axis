// apps/desktop/e2e/golden-path.spec.ts
import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

test("open project, send a message, see the response stream in", async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-e2e-"));

  const app = await electron.launch({
    args: [path.join(__dirname, "../dist/main/main.js")],
  });

  const window = await app.firstWindow();
  await window.waitForSelector('[data-testid="project-list"]');

  window.on("dialog", async (dialog) => {
    await dialog.accept(tempProject);
  });
  await window.click("text=+ Add project");

  await window.waitForSelector(`text=${path.basename(tempProject)}`);
  await window.click(`text=${path.basename(tempProject)}`);

  await window.waitForSelector('[data-testid="chat-panel"]');
  await window.fill(
    'textarea[placeholder="Describe what you want..."]',
    "Say hello"
  );
  await window.click("text=Send");

  await expect(window.locator('[data-testid="chat-messages"] p')).toHaveCount(2, {
    timeout: 30_000,
  });

  await app.close();
  fs.rmSync(tempProject, { recursive: true, force: true });
});
