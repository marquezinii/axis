# Axis Project State

## Current status

Version 0.1.0 is an active Windows desktop build. Core local discovery, inventory, public GitHub inspection/installation and update checks are implemented with real data.

## Implemented

- Tauri 2 desktop shell and premium responsive React interface
- Official Axis icon and Windows bundle assets
- Codex, Claude Code, OpenCode and Antigravity adapters
- Global and explicit-workspace skill discovery and deduplication
- Frontmatter parsing, Markdown/files view, hashing and static risk reasons
- SQLite storage, LocalAppData Vault, staging, backups, cache and activity
- Public GitHub URL parsing, multi-skill discovery and multi-agent installation
- Archive abuse limits, traversal/link checks, local-change protection and atomic replacement
- GitHub commit update checks, sources, workspaces, settings and command palette

## Architecture

React → narrow Tauri IPC commands → Rust agent/skill/storage modules → OS paths, GitHub HTTP and SQLite. Skill content is never executed.

## Known limitations

- Update preview exposes commit state but not a full per-file textual diff yet.
- Backups are created and retained; a dedicated visual Restore flow is not yet exposed.
- Sources are stored catalogs; background indexing and per-source browsing are still basic.
- Private GitHub repositories, automatic trusted updates, Linked Mode, watchers and Windows startup are not implemented.
- Development artifacts are not code-signed.

## Next priorities

1. File-level update preview and visual diff.
2. Backup browser and one-click restore.
3. Cached source indexing and refresh details.
4. Integration tests with local malicious and multi-skill archives.
5. Signing, release CI and trusted automatic updates.
