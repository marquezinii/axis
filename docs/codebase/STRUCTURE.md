# Codebase Structure

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Estrutura verificada por `docs/codebase/.codebase-scan.txt` (saída do `scan.py`) e leitura direta dos arquivos.

## Core Sections (Required)

### 1) Top-Level Map

| Path | Purpose | Evidence |
|------|---------|----------|
| `src/` | Frontend React + TypeScript (renderer Tauri). Contém `main.tsx`, `App.tsx`, `App.css` (design system custom, sem Tailwind), `hooks/`, `components/workspace/` | `src/main.tsx`, `src/App.tsx`, `package.json` |
| `src-tauri/` | Backend Rust (crate `axis` / lib `axis_lib`). Contém `src/{lib,main,models,agents,skills,storage,chat}.rs`, `src/providers/`, `tests/`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `icons/` | `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` |
| `scripts/` | Scripts de distribuição local (`sync-desktop-shortcut.ps1` atualiza o atalho da Área de Trabalho após `tauri build`) | `scripts/sync-desktop-shortcut.ps1`, `package.json` (`release:local`) |
| `public/` | Assets estáticos servidos pelo Vite (`axis-icon.png`) | `public/axis-icon.png`, `index.html` |
| `archive/` | Referência somente-leitura dos projetos absorvidos no v2 (AgentOS Electron+Fastify; SkillDrop Python+PySide6). Não desenvolvidos | `archive/README.md`, `PROJECT_STATE.md` (§ Atualizações integradas recentes) |
| `docs/` | Documentação: `docs/codebase/` (este conjunto), `docs/superpowers/` (spec e plano do Axis v2) | `docs/superpowers/specs/2026-08-06-axis-v2-unified-design.md`, `docs/superpowers/plans/2026-08-06-axis-v2-implementation.md` |
| `.github/` | CI (`workflows/ci.yml`), Dependabot, templates de issue/PR | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| `.superpowers/` | Ledger de tarefas/commits/vereditos da implementação do v2 (histórico do processo, não runtime) | `.superpowers/sdd/2026-08-06-axis-v2-implementation/progress.md` |
| `.ai/` | Estado de tarefas para agentes de IA (vazio atualmente, só `.gitkeep`) | `.ai/tasks/.gitkeep`, `PROJECT_STATE.md` |
| `.vscode/` | Recomendações de extensões (tauri-vscode, rust-analyzer) | `.vscode/extensions.json` |
| Arquivos raiz | `AI_RULES.md` (governança de agentes), `PROJECT_STATE.md` (estado oficial), `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vite.config.ts`, `tsconfig*.json`, `.prettierrc.json`, `.editorconfig`, `.gitignore`, `.gitattributes`, `index.html` | raiz do repositório |

### 2) Entry Points

- Main runtime entry (backend): `src-tauri/src/main.rs` → `axis_lib::run()` em `src-tauri/src/lib.rs` (registra comandos Tauri, inicializa `storage::connect()` e `ActiveSessions`).
- Main runtime entry (renderer): `index.html` → `src/main.tsx` → `src/App.tsx`.
- Secondary entry points: nenhum CLI/job separado. `[TODO]`: não há processo worker/background além dos `tokio::spawn` internos ao chat (`src-tauri/src/chat.rs`).
- How entry is selected: `tauri.conf.json` (`build.beforeDevCommand` = `pnpm dev`, `devUrl` porta 1420, `frontendDist` = `../dist`; binário Rust via `src-tauri/src/main.rs`).

### 3) Module Boundaries

| Boundary | What belongs here | What must not be here |
|----------|-------------------|------------------------|
| `src/` (renderer) | UI React, estado local, chamadas `invoke()`/`listen()` estreitas | acesso genérico a filesystem ou execução de comandos (regra em `AI_RULES.md` § Segurança) |
| `src-tauri/src/lib.rs` | composição de comandos Tauri, `snapshot()` do dashboard | lógica de negócio de skills/chat (delegada aos módulos) |
| `src-tauri/src/agents.rs` | convenções de descoberta por agente (Codex, Claude, OpenCode, Antigravity) | execução de binários detectados |
| `src-tauri/src/skills.rs` | GitHub público, download/ZIP, inspeção heurística, hash, Vault, backup, instalação/atualização | execução de conteúdo de skill (regra de segurança permanente, `SECURITY.md`) |
| `src-tauri/src/storage.rs` | schema e CRUD SQLite (`workspaces`, `sources`, `activities`, `installations`, `settings`, `chat_sessions`, `chat_messages`, `file_changes`) | lógica de domínio de skills/chat |
| `src-tauri/src/chat.rs` | orquestrador de sessões de chat, cancelamento, eventos Tauri | chamadas HTTP diretas (delegadas a `providers/`) |
| `src-tauri/src/providers/` | trait `ChatProvider`, `StreamEvent`, `ProviderError`, registros `claude.rs`/`opencode.rs` | conhecimento de UI |
| `src-tauri/src/models.rs` | tipos compartilhados serializáveis (camelCase via serde) | I/O |

### 4) Naming and Organization Rules

- File naming pattern:
  - Frontend: componentes PascalCase (`.tsx`), hooks camelCase com prefixo `use` (`useChat.ts`, `useSessions.ts`), `main.tsx`/`App.tsx`; CSS global único (`App.css`). Ex.: `src/components/workspace/ChatView.tsx`, `src/hooks/useChat.ts`.
  - Backend Rust: arquivos e funções `snake_case` (`chat.rs`, `chat_send_message`); structs/enums PascalCase (`ClaudeProvider`, `StreamEvent`); teste em `tests/` snake_case.
  - Pastas de skills instaladas: `safe_name()` em `src-tauri/src/skills.rs` (lowercase ascii + `-`/`_`, sem espaços).
- Directory organization pattern: por camada no backend (`providers/`, `tests/`) e por área no frontend (`hooks/`, `components/workspace/`). Não é feature-based.
- Import aliasing or path conventions: frontend usa imports relativos (`../../hooks/useChat`); não há `paths` em `tsconfig.json` (sem aliases `@/`). Rust usa `mod`/`crate::` (declarados em `lib.rs`).

### 5) Evidence

- `docs/codebase/.codebase-scan.txt` (árvore de diretórios, entry points)
- `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`
- `index.html`, `src/main.tsx`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/agents.rs`, `src-tauri/src/skills.rs`, `src-tauri/src/storage.rs`, `src-tauri/src/chat.rs`, `src-tauri/src/providers/mod.rs`
- `tsconfig.json`, `package.json`
