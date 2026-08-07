// apps/backend/src/core/event-bus.ts
import type { AgentEvent } from "@agentos/shared";

type Handler = (event: AgentEvent) => void;

export class EventBus {
  private subscribers = new Map<string, Set<Handler>>();

  subscribe(sessionId: string, handler: Handler): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(handler);
    return () => {
      this.subscribers.get(sessionId)?.delete(handler);
    };
  }

  publish(event: AgentEvent): void {
    const handlers = this.subscribers.get(event.sessionId);
    if (!handlers) return;
    for (const handler of handlers) handler(event);
  }
}
