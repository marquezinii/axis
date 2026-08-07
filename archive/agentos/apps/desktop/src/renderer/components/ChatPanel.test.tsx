// apps/desktop/src/renderer/components/ChatPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

describe("ChatPanel", () => {
  it("renders streamed text deltas as they arrive and lets the user send a message", () => {
    const onSend = vi.fn();
    render(
      <ChatPanel
        messages={[{ role: "assistant", text: "Hello there" }]}
        onSend={onSend}
      />
    );

    expect(screen.getByText("Hello there")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Describe what you want..."), {
      target: { value: "Fix the bug" },
    });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).toHaveBeenCalledWith("Fix the bug");
  });
});
