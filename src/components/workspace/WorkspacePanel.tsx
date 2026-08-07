import { useState } from 'react';
import { ChatView } from './ChatView';
import { ProviderSelector } from './ProviderSelector';
import { useSessions } from '../../hooks/useSessions';
import { Plus } from 'lucide-react';

type Props = {
  workspaceId: number;
};

export function WorkspacePanel({ workspaceId }: Props) {
  const [provider, setProvider] = useState('claude');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { sessions, createSession, busy } = useSessions(workspaceId);

  const handleStartSession = async () => {
    const session = await createSession(provider);
    if (session) setActiveSessionId(session.id);
  };

  return (
    <div className="workspace-panel">
      {!activeSessionId ? (
        <div className="workspace-start">
          <ProviderSelector selected={provider} onSelect={setProvider} />
          <button
            className="button primary"
            onClick={handleStartSession}
            disabled={busy}
          >
            <Plus size={16} /> New {provider} session
          </button>
          {sessions.length > 0 && (
            <div className="recent-sessions">
              <h3>Recent sessions</h3>
              {sessions.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  className="session-row"
                  onClick={() => setActiveSessionId(s.id)}
                >
                  <span>{s.title || 'Untitled'}</span>
                  <small>{s.provider}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ChatView sessionId={activeSessionId} />
      )}
    </div>
  );
}