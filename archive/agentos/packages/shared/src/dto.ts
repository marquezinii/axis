export interface ProjectDTO {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string | null;
  createdAt: string;
}

export type SessionStatus =
  | "created"
  | "executing"
  | "completed"
  | "failed"
  | "interrupted";

export interface SessionDTO {
  id: string;
  projectId: string;
  providerId: string;
  model: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDTO {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface FileChangeDTO {
  id: string;
  sessionId: string;
  path: string;
  changeType: "created" | "modified" | "deleted";
  diff: string;
  createdAt: string;
}
