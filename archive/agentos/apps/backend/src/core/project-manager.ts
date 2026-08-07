// apps/backend/src/core/project-manager.ts
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import type { ProjectDTO, StorageProvider } from "@agentos/shared";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  git_remote: string | null;
  default_branch: string | null;
  created_at: string;
}

function rowToDto(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
  };
}

export class ProjectManager {
  constructor(private db: StorageProvider) {}

  registerProject(folderPath: string): ProjectDTO {
    const normalizedPath = path.resolve(folderPath);
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(normalizedPath) as ProjectRow | undefined;
    if (existing) return rowToDto(existing);

    const { gitRemote, defaultBranch } = this.detectGit(normalizedPath);
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO projects (id, name, path, git_remote, default_branch, created_at, settings_json)
         VALUES (?, ?, ?, ?, ?, ?, '{}')`
      )
      .run(
        id,
        path.basename(normalizedPath),
        normalizedPath,
        gitRemote,
        defaultBranch,
        now
      );

    return {
      id,
      name: path.basename(normalizedPath),
      path: normalizedPath,
      gitRemote,
      defaultBranch,
      createdAt: now,
    };
  }

  listProjects(): ProjectDTO[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY created_at DESC")
      .all() as unknown as ProjectRow[];
    return rows.map(rowToDto);
  }

  private detectGit(folderPath: string): {
    gitRemote: string | null;
    defaultBranch: string | null;
  } {
    try {
      const branch = execSync("git symbolic-ref --short HEAD", {
        cwd: folderPath,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      let remote: string | null = null;
      try {
        remote = execSync("git remote get-url origin", {
          cwd: folderPath,
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim();
      } catch {
        remote = null;
      }
      return { gitRemote: remote, defaultBranch: branch || null };
    } catch {
      return { gitRemote: null, defaultBranch: null };
    }
  }
}
