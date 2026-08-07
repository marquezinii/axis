import { useSessions } from '../../hooks/useSessions';
import { Trash2, MessageSquare } from 'lucide-react';

type Props = {
  workspaceId: number;
  onSelectSession: (id: string) => void;
};

export function SessionList({ workspaceId, onSelectSession }: Props) {
  const { sessions, deleteSession } = useSessions(workspaceId);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
  };

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <MessageSquare size={30} />
        <h3>No sessions yet</h3>
        <p>Start a chat to see your history here.</p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((s) => (
        <button
          key={s.id}
          className="session-row"
          onClick={() => onSelectSession(s.id)}
        >
          <MessageSquare size={16} />
          <span>
            <strong>{s.title || 'Untitled session'}</strong>
            <small>
              {s.provider} · {new Date(s.updatedAt).toLocaleDateString()}
            </small>
          </span>
          <button
            className="icon-button danger"
            onClick={(e) => handleDelete(s.id, e)}
            aria-label="Delete session"
          >
            <Trash2 size={14} />
          </button>
        </button>
      ))}
    </div>
  );
}