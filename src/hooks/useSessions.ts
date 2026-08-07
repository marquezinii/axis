import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type SessionInfo = {
  id: string;
  workspaceId: number;
  provider: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export function useSessions(workspaceId: number | null) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (workspaceId === null) return;
    try {
      const result = await invoke<SessionInfo[]>('chat_get_sessions', {
        workspaceId,
      });
      setSessions(result);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  }, [workspaceId]);

  const createSession = useCallback(
    async (provider: string): Promise<SessionInfo | null> => {
      if (workspaceId === null) return null;
      setBusy(true);
      try {
        const session = await invoke<SessionInfo>('chat_create_session', {
          workspaceId,
          provider,
        });
        await refresh();
        return session;
      } catch (e) {
        console.error('Failed to create session:', e);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, refresh],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await invoke('chat_delete_session', { sessionId });
        await refresh();
      } catch (e) {
        console.error('Failed to delete session:', e);
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sessions, createSession, deleteSession, refresh, busy };
}