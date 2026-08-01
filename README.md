# AXIS

Local control center for AI coding agents.

Axis is a Windows desktop application that detects Codex, Claude Code, OpenCode and Antigravity, inventories their skills, and provides a safe local workflow for installing and tracking public GitHub skills.

## Features

- Agent detection from known executables, configuration and skill locations
- Deduplicated global and workspace skill inventory
- YAML frontmatter and Markdown inspection
- Public GitHub repository and deep skill URL parsing
- Multi-skill repository discovery and multi-agent installation
- Staging, archive limits, path validation, static risk inspection and atomic writes
- Local Vault, SHA-256 content tracking, backups and local-change protection
- Managed skill update checks against the tracked GitHub ref
- Explicit workspaces, sources, activity history and local settings
- Keyboard navigation and `Ctrl+K` command palette

## Screenshots

Screenshots will be added after the first packaged release.

## Stack

Tauri 2, Rust, React 19, TypeScript, Vite and SQLite.

## Development

Prerequisites: Node.js, pnpm, Rust stable MSVC, Visual Studio C++ Build Tools and WebView2.

```powershell
pnpm install
pnpm tauri dev
```

Validation and packaging:

```powershell
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

Use `pnpm release:local` for future local releases. It rebuilds the stable release executable and refreshes the Desktop shortcut. The shortcut targets `src-tauri/target/release/axis.exe`, so every successful rebuild updates the app it opens.

## Architecture

The React frontend only calls narrow Tauri commands. Rust adapters own agent conventions; the skills module owns discovery, GitHub staging, validation, hashing, installation and update checks; SQLite stores sources, workspaces, operations and managed installation provenance. App data is resolved through the operating system under LocalAppData—no personal path is hardcoded.

## Security philosophy

Skills are untrusted content. Axis never runs scripts found in a skill during discovery or installation. Archives are size-limited and extracted only through enclosed relative paths; links are rejected; existing unmanaged folders are never overwritten; managed local changes block replacement. See [SECURITY.md](SECURITY.md).

## Build

`pnpm tauri build` creates signed-ready NSIS and MSI artifacts under `src-tauri/target/release/bundle`. Code signing is not configured for the development build.
