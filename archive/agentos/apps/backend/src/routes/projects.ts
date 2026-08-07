// apps/backend/src/routes/projects.ts
import type { FastifyInstance } from "fastify";
import type { ProjectManager } from "../core/project-manager";

export function registerProjectRoutes(
  app: FastifyInstance,
  projectManager: ProjectManager
): void {
  app.get("/projects", async () => {
    return projectManager.listProjects();
  });

  app.post<{ Body: { path: string } }>("/projects", async (request, reply) => {
    const { path: folderPath } = request.body;
    if (!folderPath) {
      reply.code(400);
      return { error: "path is required" };
    }
    return projectManager.registerProject(folderPath);
  });
}
