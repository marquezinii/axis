// apps/backend/src/providers/claude-provider-adapter.test.ts
import { describe, it, expect, vi } from "vitest";
import { ClaudeProviderAdapter } from "./claude-provider-adapter";

const queryMock = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: any[]) => queryMock(...args),
}));

describe("ClaudeProviderAdapter", () => {
  it("normalizes SDK text and tool events into AgentEvents", async () => {
    queryMock.mockImplementation(async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi" }] },
      };
      yield {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }],
        },
      };
      yield {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: false }],
        },
        tool_use_result: {},
      };
      yield { type: "result", subtype: "success" };
    });

    const adapter = new ClaudeProviderAdapter();
    const events = [];
    for await (const event of adapter.sendMessage({
      sessionId: "s1",
      text: "hello",
      projectPath: "C:/proj",
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "text_delta",
      sessionId: "s1",
      text: "Hi",
    });
    expect(events).toContainEqual({
      type: "tool_call_started",
      sessionId: "s1",
      toolName: "Bash",
      toolCallId: "tool-1",
    });
    expect(events).toContainEqual({
      type: "tool_call_finished",
      sessionId: "s1",
      toolCallId: "tool-1",
      success: true,
    });
    expect(events[events.length - 1]).toEqual({
      type: "session_completed",
      sessionId: "s1",
    });
    // Bash is not a file-editing tool, so no file_changed event should fire.
    expect(events.find((e) => e.type === "file_changed")).toBeUndefined();
  });

  it("passes the project path through to query() as the SDK's cwd option", async () => {
    queryMock.mockImplementation(async function* () {
      yield { type: "result", subtype: "success" };
    });

    const adapter = new ClaudeProviderAdapter();
    for await (const _ of adapter.sendMessage({
      sessionId: "s1",
      text: "hello",
      projectPath: "C:/proj/foo",
    })) {
      // drain
    }

    expect(queryMock).toHaveBeenCalledWith({
      prompt: "hello",
      options: { cwd: "C:/proj/foo" },
    });
  });

  it("emits a file_changed event for a successful Edit tool_use/tool_result pair", async () => {
    queryMock.mockImplementation(async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-2",
              name: "Edit",
              input: {
                file_path: "C:/proj/src/foo.ts",
                old_string: "a",
                new_string: "b",
              },
            },
          ],
        },
      };
      yield {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-2", is_error: false }],
        },
        tool_use_result: {
          filePath: "C:/proj/src/foo.ts",
          oldString: "a",
          newString: "b",
          originalFile: "a",
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ["-a", "+b"],
            },
          ],
          userModified: false,
          replaceAll: false,
        },
      };
      yield { type: "result", subtype: "success" };
    });

    const adapter = new ClaudeProviderAdapter();
    const events = [];
    for await (const event of adapter.sendMessage({
      sessionId: "s1",
      text: "edit the file",
      projectPath: "C:/proj",
    })) {
      events.push(event);
    }

    const fileChanged = events.find((e) => e.type === "file_changed") as any;
    expect(fileChanged).toBeDefined();
    expect(fileChanged.path).toBe("C:/proj/src/foo.ts");
    expect(fileChanged.changeType).toBe("modified");
    expect(fileChanged.diff).toContain("-a");
    expect(fileChanged.diff).toContain("+b");
  });

  it("emits a file_changed event with changeType 'created' for a new-file Write", async () => {
    queryMock.mockImplementation(async function* () {
      yield {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-3",
              name: "Write",
              input: { file_path: "C:/proj/src/new.ts", content: "x" },
            },
          ],
        },
      };
      yield {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-3", is_error: false }],
        },
        tool_use_result: {
          type: "create",
          filePath: "C:/proj/src/new.ts",
          content: "x",
          structuredPatch: [],
          originalFile: null,
        },
      };
      yield { type: "result", subtype: "success" };
    });

    const adapter = new ClaudeProviderAdapter();
    const events = [];
    for await (const event of adapter.sendMessage({
      sessionId: "s1",
      text: "create the file",
      projectPath: "C:/proj",
    })) {
      events.push(event);
    }

    const fileChanged = events.find((e) => e.type === "file_changed") as any;
    expect(fileChanged).toBeDefined();
    expect(fileChanged.changeType).toBe("created");
  });

  it("does not emit file_changed for a failed Edit tool_result", async () => {
    queryMock.mockImplementation(async function* () {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tool-4", name: "Edit", input: {} }],
        },
      };
      yield {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tool-4", is_error: true }],
        },
        tool_use_result: { filePath: "C:/proj/src/foo.ts" },
      };
      yield { type: "result", subtype: "success" };
    });

    const adapter = new ClaudeProviderAdapter();
    const events = [];
    for await (const event of adapter.sendMessage({
      sessionId: "s1",
      text: "edit the file",
      projectPath: "C:/proj",
    })) {
      events.push(event);
    }

    expect(events.find((e) => e.type === "file_changed")).toBeUndefined();
    expect(events).toContainEqual({
      type: "tool_call_finished",
      sessionId: "s1",
      toolCallId: "tool-4",
      success: false,
    });
  });

  it("reports correct capabilities", () => {
    const adapter = new ClaudeProviderAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      fileEdit: true,
      terminal: true,
      git: true,
    });
  });
});
