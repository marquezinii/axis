// apps/backend/src/core/event-bus.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./event-bus";
import type { AgentEvent } from "@agentos/shared";

describe("EventBus", () => {
  it("delivers published events only to subscribers of the matching session", () => {
    const bus = new EventBus();
    const receivedA: AgentEvent[] = [];
    const receivedB: AgentEvent[] = [];

    bus.subscribe("session-a", (e) => receivedA.push(e));
    bus.subscribe("session-b", (e) => receivedB.push(e));

    const event: AgentEvent = {
      type: "text_delta",
      sessionId: "session-a",
      text: "hello",
    };
    bus.publish(event);

    expect(receivedA).toEqual([event]);
    expect(receivedB).toEqual([]);
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("session-a", handler);

    unsubscribe();
    bus.publish({ type: "text_delta", sessionId: "session-a", text: "x" });

    expect(handler).not.toHaveBeenCalled();
  });
});
