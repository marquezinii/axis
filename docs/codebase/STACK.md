# Technology Stack

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Conteúdo verificado contra arquivos do repositório em 2026-08-13; nada foi inferido sem evidência. Desconhecidos marcados como `[TODO]`; decisões de intenção como `[ASK USER]`.

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript (frontend) + Rust (backend) | `src/`, `src-tauri/src/` |
| Runtime + version | Aplicativo desktop Windows (Tauri 2). Node 22 + pnpm 10 no CI; Rust stable (rustfmt/clippy) no CI; Rust edition 2024 | `.github/workflows/ci.yml`; `src-tauri/Cargo.toml` (edition = "2024") |
| Package manager | pnpm (lockfile v9), Cargo para Rust | `pnpm-lock.yaml`; `src-tauri/Cargo.toml` |
| Module/build system | Vite 7 + `tsc` (frontend); Cargo (backend, crate `axis_lib` + bin `axis`) | `vite.config.ts`; `package.json`; `src-tauri/Cargo.toml` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| React / react-dom | ^19.1.0 (lock 19.2.8) | UI do renderer | `package.json`; `pnpm-lock.yaml` |
| @tauri-apps/api | ^2 (lock 2.11.1) | ponte IPC (invoke/listen) | `package.json`; `src/hooks/useChat.ts` |
| @tauri-apps/plugin-opener | ^2 (lock 2.5.4) | abrir pastas/arquivos via OS | `package.json`; `src-tauri/src/lib.rs` (plugin init) |
| react-markdown | ^10.1.0 | renderização de SKILL.md | `package.json`; `src/App.tsx` |
| lucide-react | ^1.28.0 | ícones da UI | `package.json`; `src/App.tsx` |
| tauri | 2 | shell desktop + IPC + eventos | `src-tauri/Cargo.toml`; `src-tauri/src/lib.rs` |
| tauri-plugin-opener | 2 | plugin nativo opener | `src-tauri/Cargo.toml` |
| rusqlite (feature `bundled`) | 0.40 | SQLite embarcado | `src-tauri/Cargo.toml`; `src-tauri/src/storage.rs` |
| reqwest | 0.12 (`blocking`, `json`, `rustls-tls`, `stream`) | HTTP GitHub + Anthropic SSE | `src-tauri/Cargo.toml`; `src-tauri/src/skills.rs`; `src-tauri/src/providers/claude.rs` |
| tokio (feature `full`) | 1 | runtime async (chat/providers) | `src-tauri/Cargo.toml`; `src-tauri/src/chat.rs` |
| eventsource-stream / futures-util / async-trait | 0.2 / 0.3 / 0.1 | streaming SSE e trait async | `src-tauri/Cargo.toml` |
| zip (feature `deflate`) / walkdir / tempfile | 8 / 2 / 3 | extração e varredura de repositórios | `src-tauri/Cargo.toml`; `src-tauri/src/skills.rs` |
| sha2 / hex | 0.11 / 0.4 | hash SHA-256 de conteúdo | `src-tauri/Cargo.toml`; `src-tauri/src/skills.rs` |
| directories | 6 | paths OS (home, LocalAppData) | `src-tauri/Cargo.toml`; `src-tauri/src/storage.rs` |
| serde / serde_json / serde_yaml | 1 / 1 / 0.9 | serialização e parse YAML (SKILL.md) | `src-tauri/Cargo.toml`; `src-tauri/src/skills.rs` |
| chrono / uuid / thiserror / rfd | 0.4 / 1 / 2 / 0.17 | timestamps, IDs, erros, diálogo de pasta | `src-tauri/Cargo.toml`; `src-tauri/src/lib.rs` |

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| TypeScript ~7.0.2 (strict) | type-checking do frontend (`pnpm check` = `tsc --noEmit && vite build`) | `package.json`; `tsconfig.json` |
| Vite 7 | build/dev server (porta 1420 fixa) | `package.json`; `vite.config.ts` |
| Prettier | formatação do frontend | `package.json`; `.prettierrc.json`; `.prettierignore` |
| @tauri-apps/cli | comandos `tauri` | `package.json`; `src-tauri/tauri.conf.json` |
| rustfmt + clippy (`-D warnings`) | formatação/lint Rust | `.github/workflows/ci.yml` |
| cargo test | testes Rust | `.github/workflows/ci.yml`; `src-tauri/tests/` |

### 4) Key Commands

```bash
pnpm install                # instalar dependências (pnpm 10)
pnpm tauri dev              # desenvolvimento com hot reload (porta 1420)
pnpm build                  # tsc && vite build -> dist/
pnpm check                  # tsc --noEmit && vite build (gate CI frontend)
pnpm format / format:check  # Prettier
pnpm release:local          # tauri build + scripts/sync-desktop-shortcut.ps1

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Fonte: `package.json` (scripts), `CONTRIBUTING.md`, `.github/workflows/ci.yml`.

### 5) Environment and Config

- Config sources: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `.prettierrc.json`, `.editorconfig`.
- Required env vars: `ANTHROPIC_API_KEY` (runtime, somente para provider Claude; lida em `src-tauri/src/providers/claude.rs` via `std::env::var`; nunca persistida — ver `PROJECT_STATE.md` § Decisões técnicas). `TAURI_DEV_HOST` (dev opcional, `vite.config.ts`).
- Não existe `.env.example` / `.env.template` (confirmado pelo scan: "No .env.example or .env.template found"). `[TODO]`: nenhum template de env documenta `ANTHROPIC_API_KEY` no repositório.
- Deployment/runtime constraints: aplicativo local único `.exe` para Windows; sem updater, sem assinatura de código, sem instalador público (ver `AI_RULES.md` § Publicação). CSP do Tauri definido em `src-tauri/tauri.conf.json`: `default-src 'self'; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost`.

### 6) Evidence

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `.github/workflows/ci.yml`
- `vite.config.ts`, `tsconfig.json`
- `.prettierrc.json`, `.editorconfig`
- `pnpm-lock.yaml` (versões resolvidas)
