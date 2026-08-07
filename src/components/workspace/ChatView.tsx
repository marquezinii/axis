import { useRef, useEffect, useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { LoaderCircle, Send, Square, FileCode2 } from 'lucide-react';

type Props = {
  sessionId: string;
};

export function ChatView({ sessionId }: Props) {
  const { messages, send, cancel, isStreaming, error, fileChanges } =
    useChat(sessionId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = () => {
    if (!input.trim()) return;
    send(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const sessionFileChanges = fileChanges.filter(
    (fc) => fc.sessionId === sessionId,
  );

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role} ${msg.isStreaming ? 'streaming' : ''}`}
          >
            <div className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div className="chat-message-content">
              {msg.content || (msg.isStreaming ? 'Thinking...' : '')}
              {msg.isStreaming && <LoaderCircle className="spin" size={14} />}
            </div>
          </div>
        ))}
        {sessionFileChanges.length > 0 && (
          <div className="chat-file-changes">
            <h4>
              <FileCode2 size={14} /> Files changed
            </h4>
            {sessionFileChanges.map((fc, i) => (
              <div key={i} className="file-change-item">
                <code>{fc.path}</code>
                {fc.diff && (
                  <pre className="diff-preview">{fc.diff}</pre>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Ctrl+Enter to send)"
          rows={2}
          disabled={isStreaming}
        />
        <div className="chat-actions">
          {isStreaming ? (
            <button
              className="button danger"
              onClick={cancel}
              aria-label="Cancel"
            >
              <Square size={16} /> Stop
            </button>
          ) : (
            <button
              className="button primary"
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}