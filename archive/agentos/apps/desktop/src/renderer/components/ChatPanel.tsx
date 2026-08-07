// apps/desktop/src/renderer/components/ChatPanel.tsx
import { useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const handleSend = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <div data-testid="chat-panel">
      <div data-testid="chat-messages">
        {messages.map((message, index) => (
          <p
            key={index}
            data-role={message.role}
            style={message.role === "error" ? { color: "#d33", fontWeight: 600 } : undefined}
          >
            {message.text}
          </p>
        ))}
      </div>
      <textarea
        placeholder="Describe what you want..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
