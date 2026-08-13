# Coding Conventions

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Convenções extraídas de configuração (`.editorconfig`, `.prettierrc.json`, `tsconfig.json`, CI) e de amostras representativas de código.

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files (frontend) | componentes PascalCase `.tsx`; hooks camelCase `use*.ts`; estilos único `App.css` | `ChatView.tsx`, `useChat.ts` | `src/components/workspace/`, `src/hooks/` |
| Files (Rust) | `snake_case` `.rs` | `chat.rs`, `skills.rs` | `src-tauri/src/` |
| Functions/methods (TS) | camelCase | `send`, `refresh`, `handleStartSession` | `src/hooks/useChat.ts`, `src/components/workspace/WorkspacePanel.tsx` |
| Functions (Rust) | snake_case | `chat_send_message`, `parse_github_url`, `hash_dir` | `src-tauri/src/chat.rs`, `src-tauri/src/skills.rs` |
| Types/interfaces (TS) | PascalCase; `type` usado (não `interface`) | `Dashboard`, `ChatMessage`, `SessionInfo` | `src/App.tsx`, `src/hooks/useChat.ts` |
| Structs/enums (Rust) | PascalCase | `ClaudeProvider`, `ProviderError`, `StreamEvent` | `src-tauri/src/providers/mod.rs` |
| Constants/env vars | Rust `const` SCREAMING_SNAKE (`MAX_ARCHIVE`, `MAX_EXTRACTED`, `MAX_FILES`); env `ANTHROPIC_API_KEY` | `MAX_ARCHIVE` | `src-tauri/src/skills.rs`, `src-tauri/src/providers/claude.rs` |
| JSON payloads | camelCase via `#[serde(rename_all = "camelCase")]` (Rust) e `type`/props camelCase (TS) | `workspaceId`, `sessionId`, `fileChanges` | `src-tauri/src/models.rs`, `src/hooks/useSessions.ts` |
| Enum de erro | `ProviderError` com `#[serde(rename_all = "SCREAMING_SNAKE_CASE")]` | `AuthExpired`, `RateLimited` | `src-tauri/src/providers/mod.rs` |

### 2) Formatting and Linting

- Formatter: Prettier (frontend) — `printWidth: 100`, `singleQuote: true`, `trailingComma: "all"` (`.prettierrc.json`); rustfmt (Rust) via CI `cargo fmt --check`.
- Linter: `clippy -D warnings` (Rust); TypeScript strict (sem ESLint configurado no repositório — `[TODO]`: nenhum `.eslintrc`/`eslint.config.*` detectado).
- Most relevant enforced rules: TS `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` (`tsconfig.json`); `indent_size 2` (4 para `*.rs`), `charset utf-8`, `end_of_line lf`, `insert_final_newline true`, `trim_trailing_whitespace` (exceto `*.md`) (`.editorconfig`).
- Run commands: `pnpm format:check`, `pnpm check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` (ver `CONTRIBUTING.md`, `.github/workflows/ci.yml`).
- Prettier ignora: `node_modules`, `dist`, `src-tauri/target`, `src-tauri/gen`, `*.png/ico/icns`, `pnpm-lock.yaml` (`.prettierignore`).

### 3) Import and Module Conventions

- Import grouping/order: TS usa imports relativos com extensões omitidas; grupos por tipo (react, libs, componentes/hooks locais) na ordem declarada manualmente — não há lint de imports (`[TODO]`). Rust declara módulos no topo de `lib.rs` (`mod agents; mod chat; ...`) e usa `crate::`/`super::` nos demais.
- Alias vs relative import policy: relativo no frontend (`../../hooks/useChat`); nenhum path alias em `tsconfig.json`.
- Public exports/barrel policy: sem barrel exports; hooks exportam `export type` + função; Rust expõe `pub mod storage` e funções `pub` por módulo; comandos expostos via `tauri::generate_handler!` em `lib.rs`.

### 4) Error and Logging Conventions

- Error strategy by layer:
  - Comandos Tauri (Rust): retornam `Result<T, String>`; erros mapeados para mensagens amigáveis em PT (`skills.rs`, `storage.rs`).
  - Providers: enum fechado `ProviderError` com mapeamento HTTP (401→AuthExpired, 429→RateLimited, 529→ProviderUnavailable) (`claude.rs`).
  - Renderer: `try/catch` em torno de `invoke()` + `setError`/`notify` (toast) (`src/App.tsx`, `useChat.ts`); erros de stream exibidos em `ChatView` via `chat:error`.
- Logging style and required context fields: **não há biblioteca de logging em uso** no código; erros fluem por `Result`/eventos. `storage::data_dir()` cria pasta `logs`, mas nenhum arquivo de log é escrito no código atual. `[TODO]`: confirmar intenção de logging; `[ASK USER]` se logging estruturado é desejado.
- Sensitive-data redaction rules: `ANTHROPIC_API_KEY` nunca é persistida em SQLite/config/log (`AI_RULES.md`, `PROJECT_STATE.md`); `gitignore` exclui `.env*` (exceto `.env.example`, que não existe).

### 5) Testing Conventions

- Test file naming/location rule: Rust — testes unitários inline `#[cfg(test)] mod tests` dentro dos módulos (`agents.rs`, `skills.rs`) + testes de integração em `src-tauri/tests/*_tests.rs`; sem testes frontend.
- Mocking strategy norm: sem mocking explícito; testes de storage/chat usam o SQLite real em LocalAppData (`storage_tests.rs`, `chat_tests.rs` — não usam temp DB; ver `CONCERNS.md`).
- Coverage expectation: nenhum limiar configurado; CI roda `cargo test` sem coverage. `[TODO]`

### 6) Evidence

- `.prettierrc.json`, `.prettierignore`, `.editorconfig`
- `tsconfig.json`, `tsconfig.node.json`
- `.github/workflows/ci.yml`
- `src-tauri/src/lib.rs`, `src-tauri/src/chat.rs`, `src-tauri/src/skills.rs`, `src-tauri/src/providers/claude.rs`, `src-tauri/src/providers/mod.rs`
- `src/hooks/useChat.ts`, `src/App.tsx`
- `CONTRIBUTING.md`, `AI_RULES.md` (padrão de commit Conventional Commits, validações por área)
