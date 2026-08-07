import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

export type FileChangeEvent = {
  sessionId: string;
  path: string;
  diff: string | null;
  changeType: string;
};

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChangeEvent[]>([]);
  const pendingAssistant = useRef<string>('');

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;
      setError(null);
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Add placeholder assistant message for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      try {
        await invoke('chat_send_message', { sessionId, message: content });
      } catch (e) {
        setError(String(e));
        setIsStreaming(false);
      }
    },
    [sessionId, isStreaming],
  );

  const cancel = useCallback(async () => {
    try {
      await invoke('chat_cancel', { sessionId });
    } catch (e) {
      setError(String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const u1 = await listen<{ sessionId: string; delta: string }>(
        'chat:token',
        (e) => {
          if (e.payload.sessionId !== sessionId) return;
          pendingAssistant.current += e.payload.delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.isStreaming
                ? { ...m, content: pendingAssistant.current }
                : m,
            ),
          );
        },
      );

      const u2 = await listen('chat:completed', (e: any) => {
        if (e.payload.sessionId !== sessionId) return;
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false } : m,
          ),
        );
        pendingAssistant.current = '';
      });

      const u3 = await listen<{
        sessionId: string;
        code: string;
        message: string;
      }>('chat:error', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        setError(e.payload.message);
        setIsStreaming(false);
      });

      const u4 = await listen<FileChangeEvent>('chat:file-changed', (e) => {
        if (e.payload.sessionId !== sessionId) return;
        setFileChanges((prev) => [...prev, e.payload]);
      });

      unlisteners = [u1, u2, u3, u4];
    };

    setup();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [sessionId]);

  return { messages, send, cancel, isStreaming, error, fileChanges };
}