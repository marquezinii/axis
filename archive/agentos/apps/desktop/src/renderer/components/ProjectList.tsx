// apps/desktop/src/renderer/components/ProjectList.tsx
import type { ProjectDTO } from "@agentos/shared";

export interface ProjectListProps {
  projects: ProjectDTO[];
  selectedProjectId: string | null;
  onSelect: (project: ProjectDTO) => void;
  onAddProject: () => void;
}

export function ProjectList({
  projects,
  selectedProjectId,
  onSelect,
  onAddProject,
}: ProjectListProps) {
  return (
    <div data-testid="project-list">
      <button onClick={onAddProject}>+ Add project</button>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <button
              aria-current={project.id === selectedProjectId}
              onClick={() => onSelect(project)}
            >
              {project.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
