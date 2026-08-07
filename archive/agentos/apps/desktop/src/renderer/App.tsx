// apps/desktop/src/renderer/App.tsx
import { useEffect, useRef, useState } from "react";
import type { ProjectDTO, SessionDTO, FileChangeDTO } from "@agentos/shared";
import { AgentosClient } from "./agentos-client";
import { ProjectList } from "./components/ProjectList";
import { ChatPanel, type ChatMessage } from "./components/ChatPanel";
import { DiffViewer } from "./components/DiffViewer";

declare global {
  interface Window {
    agentos: {
      getConnectionInfo: () => { port: number; sessionToken: string };
    };
  }
}

export function App() {
  const [client] = useState(() => new AgentosClient(window.agentos.getConnectionInfo()));
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDTO | null>(null);
  const [session, setSession] = useState<SessionDTO | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [fileChanges, setFileChanges] = useState<FileChangeDTO[]>([]);
  const unsubscribeStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    client.listProjects().then(setProjects);
  }, [client]);

  const handleAddProject = async () => {
    const folderPath = window.prompt("Project folder path:");
    if (!folderPath) return;
    const project = await client.registerProject(folderPath);
    setProjects((prev) => [project, ...prev]);
  };

  const handleSelectProject = async (project: ProjectDTO) => {
    // Close any previously open stream before starting a new one, so
    // switching projects doesn't leak WebSocket connections.
    if (unsubscribeStreamRef.current) {
      unsubscribeStreamRef.current();
      unsubscribeStreamRef.current = null;
    }

    setSelectedProject(project);
    const newSession = await client.createSession(project.id, "claude");
    setSession(newSession);
    setMessages([]);
    setFileChanges([]);

    unsubscribeStreamRef.current = client.streamSession(newSession.id, (event) => {
      if (event.type === "text_delta") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { role: "assistant", text: last.text + event.text },
            ];
          }
          return [...prev, { role: "assistant", text: event.text }];
        });
      }
      if (event.type === "file_changed") {
        setFileChanges((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: newSession.id,
            path: event.path,
            changeType: event.changeType,
            diff: event.diff,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      if (event.type === "session_error") {
        setMessages((prev) => [
          ...prev,
          { role: "error", text: `Error: ${event.message}` },
        ]);
      }
    });
  };

  useEffect(() => {
    return () => {
      if (unsubscribeStreamRef.current) {
        unsubscribeStreamRef.current();
        unsubscribeStreamRef.current = null;
      }
    };
  }, []);

  const handleSend = (text: string) => {
    if (!session) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    client.sendMessage(session.id, text);
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside style={{ width: 260 }}>
        <ProjectList
          projects={projects}
          selectedProjectId={selectedProject?.id ?? null}
          onSelect={handleSelectProject}
          onAddProject={handleAddProject}
        />
      </aside>
      <main style={{ flex: 1 }}>
        <ChatPanel messages={messages} onSend={handleSend} />
      </main>
      <aside style={{ width: 320 }}>
        <DiffViewer fileChanges={fileChanges} />
      </aside>
    </div>
  );
}
