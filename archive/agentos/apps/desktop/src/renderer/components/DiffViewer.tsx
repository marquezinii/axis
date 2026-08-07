// apps/desktop/src/renderer/components/DiffViewer.tsx
import type { FileChangeDTO } from "@agentos/shared";

export interface DiffViewerProps {
  fileChanges: FileChangeDTO[];
}

export function DiffViewer({ fileChanges }: DiffViewerProps) {
  return (
    <div data-testid="diff-viewer">
      {fileChanges.length === 0 && <p>No file changes yet.</p>}
      {fileChanges.map((change) => (
        <details key={change.id} open>
          <summary>
            {change.changeType.toUpperCase()} — {change.path}
          </summary>
          <pre>{change.diff}</pre>
        </details>
      ))}
    </div>
  );
}
