// apps/backend/src/core/project-manager.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { ProjectManager } from "./project-manager";

let dbPath: string;
let projectDir: string;

afterEach(() => {
  if (dbPath && fs.existsSync(dbPath)) fs.rmSync(dbPath);
  if (projectDir && fs.existsSync(projectDir)) fs.rmSync(projectDir, { recursive: true });
});

describe("ProjectManager", () => {
  it("registers a project and detects its git branch", () => {
    dbPath = path.join(os.tmpdir(), `agentos-pm-${Date.now()}.db`);
    projectDir = path.join(os.tmpdir(), `agentos-project-${Date.now()}`);
    fs.mkdirSync(projectDir);
    execSync("git init -b main", { cwd: projectDir });

    const db = openDatabase(dbPath);
    runMigrations(db, dbPath);
    const pm = new ProjectManager(db);

    const project = pm.registerProject(projectDir);

    expect(project.name).toBe(path.basename(projectDir));
    expect(project.path).toBe(projectDir);
    expect(project.defaultBranch).toBe("main");

    const listed = pm.listProjects();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(project.id);

    db.close();
  });

  it("registering the same path twice returns the existing project", () => {
    dbPath = path.join(os.tmpdir(), `agentos-pm-2-${Date.now()}.db`);
    projectDir = path.join(os.tmpdir(), `agentos-project-2-${Date.now()}`);
    fs.mkdirSync(projectDir);

    const db = openDatabase(dbPath);
    runMigrations(db, dbPath);
    const pm = new ProjectManager(db);

    const first = pm.registerProject(projectDir);
    const second = pm.registerProject(projectDir);

    expect(second.id).toBe(first.id);
    expect(pm.listProjects()).toHaveLength(1);

    db.close();
  });
});
