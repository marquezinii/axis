# AgentOS

Multi-provider AI development orchestrator. v1 scope: Electron desktop app +
Fastify backend + Claude provider adapter. See
`docs/superpowers/specs/2026-07-28-agentos-v1-design.md` for the full design.

## Development

    npm install

Run the backend and desktop app in dev mode (each in its own terminal):

    npm run dev --workspace=apps/backend
    npm run dev --workspace=apps/desktop

## Build

Full pipeline — builds `packages/shared`, then `apps/backend` (typecheck +
esbuild bundle to `dist/index.mjs`), then `apps/desktop` (typecheck + vite
build), then packages the Electron app with electron-builder into
`apps/desktop/release/` (`win-unpacked/AgentOS.exe` plus an NSIS installer),
and finally regenerates the `%USERPROFILE%\Desktop\AgentOS.lnk` shortcut to
point at the unpacked app (see `scripts/update-desktop-shortcut.ps1`):

    npm run build

## Test

Runs each workspace's test suite (Vitest):

    npm run test --workspaces --if-present

## Structure

- `apps/desktop` — Electron main/preload/renderer
- `apps/backend` — standalone Fastify backend, bundled with esbuild to a
  single self-contained `dist/index.mjs` so the packaged desktop app can run
  it without needing `node_modules` alongside it (see
  `apps/backend/esbuild.config.js` for why)
- `packages/shared` — shared TypeScript types (ProviderAdapter, events, DTOs)
