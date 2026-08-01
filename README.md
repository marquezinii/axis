# Axis

> Central de controle local, segura e em português para skills de agentes de programação com IA.

Axis is a Windows desktop application that detects Codex, Claude Code, OpenCode and Antigravity, inventories their skills, and provides a safe local workflow for installing and tracking public GitHub skills.

## O que o Axis faz

- Detecção de agentes por executáveis, configuração e pastas conhecidas de skills, sem executar os binários detectados
- Deduplicated global and workspace skill inventory
- YAML frontmatter and Markdown inspection
- Public GitHub repository and deep skill URL parsing
- Multi-skill repository discovery and multi-agent installation
- Staging, archive limits, path validation, static risk inspection and atomic writes
- Local Vault, SHA-256 content tracking, backups and local-change protection
- Managed skill update checks against the tracked GitHub ref
- Explicit workspaces, sources, activity history and local settings
- Keyboard navigation and `Ctrl+K` command palette

## Stack

Tauri 2, Rust, React 19, TypeScript, Vite and SQLite.

## Desenvolvimento

Prerequisites: Node.js, pnpm, Rust stable MSVC, Visual Studio C++ Build Tools and WebView2.

```powershell
pnpm install
pnpm tauri dev
```

Validação e empacotamento:

```powershell
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

Use `pnpm release:local` para as próximas versões locais. Ele recompila o executável estável e atualiza o atalho da Área de Trabalho. O atalho aponta para `src-tauri/target/release/axis.exe`; cada build bem-sucedida atualiza o app aberto por ele.

## Documentação

- [Arquitetura](ARCHITECTURE.md)
- [Contribuição](CONTRIBUTING.md)
- [Segurança](SECURITY.md)
- [Estado do projeto](PROJECT_STATE.md)

## Arquitetura

The React frontend only calls narrow Tauri commands. Rust adapters own agent conventions; the skills module owns discovery, GitHub staging, validation, hashing, installation and update checks; SQLite stores sources, workspaces, operations and managed installation provenance. App data is resolved through the operating system under LocalAppData—no personal path is hardcoded.

## Filosofia de segurança

Skills are untrusted content. Axis never runs scripts found in a skill during discovery or installation. Archives are size-limited and extracted only through enclosed relative paths; links are rejected; existing unmanaged folders are never overwritten; managed local changes block replacement. See [SECURITY.md](SECURITY.md).

## Build

`pnpm tauri build` creates signed-ready NSIS and MSI artifacts under `src-tauri/target/release/bundle`. Code signing is not configured for the development build.
