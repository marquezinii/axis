// apps/desktop/src/renderer/agentos-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentosClient } from "./agentos-client";

describe("AgentosClient", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("sends the bearer token on every HTTP request", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const client = new AgentosClient({ port: 1234, sessionToken: "tok-123" });
    await client.listProjects();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/projects",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok-123" }),
      })
    );
  });

  it("posts a new project path when registering a project", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "p1", name: "Demo", path: "C:/demo" }),
    });

    const client = new AgentosClient({ port: 1234, sessionToken: "tok-123" });
    const result = await client.registerProject("C:/demo");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "C:/demo" }),
      })
    );
    expect(result).toEqual({ id: "p1", name: "Demo", path: "C:/demo" });
  });
});
