# AgentOS v1 — Design

> Status: APPROVED. This is the first buildable slice of the long-term AgentOS
> vision described in `PROJETO_ORQUESTRADOR_MULTI_IA_EXTREME.md`.

## Source

Full product vision: `C:\Users\felip\Downloads\PROJETO_ORQUESTRADOR_MULTI_IA_EXTREME.md`
(long-term roadmap; this doc scopes the FIRST buildable slice only).

## Scope of this first slice (v1)

Not the whole vision — a minimal but real end-to-end product:
- Desktop app shell (Electron)
- Register/open local projects
- One working AI provider end-to-end (Claude, via Claude Agent SDK), built behind
  a generic multi-provider abstraction so more providers can be added later
  without rewriting the core
- Chat/conversation UI with streaming
- File-change diff viewer for edits the agent makes
- Session persistence (SQLite)
- Private GitHub repo, versioned from the start
- Official app icon everywhere + auto-updating desktop shortcut

Explicitly deferred to future specs: multi-provider failover, intelligent
routing, multi-agent role coordination, RAG/vector memory, plugin marketplace,
other provider adapters (Codex, Gemini, etc.), team/collab features, automatic
retry of transient provider failures, Electron E2E beyond the baseline
Playwright setup described below.

## Decisions locked in during brainstorming

- Desktop shell: **Electron + TypeScript + React**
- First provider: **Claude, via Claude Agent SDK** (reuses existing authenticated
  Claude Code session), wrapped as `ClaudeProviderAdapter`
- Storage: **SQLite**, with migrations, WAL mode, foreign keys, schema versioning
- Diff viewer for file changes is in scope for v1
- Error handling is fully manual/transparent in v1 — no silent automatic retries
- Testing includes automated Electron E2E via Playwright, in addition to unit/
  integration tests
- GitHub: private repo `AgentOS`, created via authenticated `gh` CLI
  (account: marquezinii)
- App icon: `C:\Users\felip\Downloads\AgentOS_icone_sem_fundo_CORRIGIDO_recortado.png`
  — official icon, used everywhere (app icon, installer, window icon, desktop
  shortcut). The desktop shortcut always points at the latest build and is
  regenerated automatically on every build.

## 1. Architecture

Core principle: nothing above the Provider Adapter layer knows Claude exists.
Session Manager, Orchestrator, Router, Event Bus, and Memory all talk to a
`ProviderAdapter` interface (`startSession`, `sendMessage`, `streamEvents`,
`listModels`, `getCapabilities`, `cancel`). `ClaudeProviderAdapter` is the only
adapter implemented in v1; adding Codex/Gemini later means writing a new
adapter, not touching the core.

```
Electron Renderer (React + TS, sandboxed, contextIsolation, no nodeIntegration)
        │  preload (minimal, typed, no credentials exposed)
        ▼  WebSocket + HTTP → 127.0.0.1:<dynamic port>, per-launch session token
Electron Main (window lifecycle + backend process supervisor: spawn, health-check,
                graceful shutdown, restart-on-crash)
        │
        ▼
AgentOS Backend (standalone Node.js process, Fastify)
    ├── Project Manager
    ├── Session Manager (provider-agnostic)
    ├── Task/Agent Orchestrator
    ├── Provider Router
    ├── Provider Adapters  → ClaudeProviderAdapter (Claude Agent SDK) [only one in v1]
    ├── Provider Authentication Manager
    ├── Tool Manager
    ├── Context/Memory Manager
    ├── Event Bus
    └── SQLite (migrations, WAL, FK constraints, schema versioning)
```

Local transport security requirements:
- backend listens on **127.0.0.1 only**, never LAN-exposed
- **dynamic port** chosen at startup
- **per-launch session token** required to authenticate both HTTP and WebSocket
- transport layer kept abstract enough to support future web/mobile/remote clients

Electron security requirements:
- `nodeIntegration` disabled
- `contextIsolation` enabled
- renderer sandboxed
- preload script minimal and typed
- no credentials ever reachable from the renderer

## 2. Data model (SQLite)

Migrations, WAL, FK constraints, schema versioning required.

- `projects` — id, name, path, git_remote, default_branch, created_at, settings_json
- `providers` — id, name, kind, capabilities_json, enabled
- `provider_credentials` — provider_id, encrypted_payload, added_at
  (OS keychain-backed encryption, not plain SQLite text)
- `sessions` — id, project_id, provider_id, model, status, created_at, updated_at
- `messages` — id, session_id, role, content, tool_events_json, created_at
- `tasks` — id, project_id, session_id, title, status, created_at, updated_at
- `file_changes` — id, session_id, path, change_type, diff, created_at
- `memory_entries` — id, project_id (nullable = global), type, content, created_at, tags
- `schema_migrations` — version, applied_at

## 3. Runtime flows

**Flow A — Register/open project**
1. User selects a local folder in Electron.
2. Renderer calls `POST /projects` on the backend.
3. Project Manager detects git remote/branch, writes to `projects`, returns the record.
4. Renderer lists the project in the sidebar.

**Flow B — Chat turn (streaming)**
1. User sends a request in a project's conversation area.
2. Renderer opens/reuses a session (`sessions`) over authenticated WebSocket
   (session token).
3. Session Manager asks the Provider Router for a compatible adapter (only
   `ClaudeProviderAdapter` exists in v1, but the call path already goes
   through the Router).
4. `ClaudeProviderAdapter.sendMessage()` starts the call to the Claude Agent
   SDK, reusing the authenticated Claude Code session.
5. SDK events (incremental text, tool-call started, tool-call finished, file
   changed) are normalized by the adapter into standardized internal events
   and published on the Event Bus.
6. Event Bus streams events over WebSocket to the renderer, which updates the
   chat in real time.
7. Relevant events are persisted: messages in `messages`, file changes in
   `file_changes` (with diff).
8. At the end of the turn, `sessions.updated_at` and status are updated.

**Flow C — Diff viewer**
1. Whenever the adapter reports a file-changed event, the Tool Manager
   captures the before/after diff and writes it to `file_changes`.
2. Renderer queries `GET /sessions/:id/file-changes` or receives it via a
   real-time event, and renders it in the diff panel (side-by-side or unified).
3. User can browse the session's change history at any time, even after the
   turn has completed.

**Flow D — Backend restart / recovery**
1. Electron Main detects a backend process crash (PID monitoring + periodic
   HTTP healthcheck).
2. Backend is restarted; a new session token is generated; renderer
   reconnects and re-authenticates automatically.
3. Sessions with `status = executing` at crash time are marked
   `interrupted`; the user can resume manually (resuming a session is in
   scope, but automatically resuming an in-flight AI call is not — it
   restarts from scratch if the user asks to continue).

## 4. Error handling

Even with a single provider in v1, the adapter contract models failures
generically now, because multi-provider failover is central to the long-term
vision — the v1 contract must not need to be redesigned later.

**Error categories in `ProviderAdapter`:**
- `AUTH_EXPIRED` — Claude Code CLI session not authenticated/expired
- `RATE_LIMITED` / `QUOTA_EXCEEDED` — limit reached (even without failover,
  must be detected and clearly reported)
- `PROVIDER_UNAVAILABLE` — SDK process didn't respond, timeout, crash
- `TOOL_ERROR` — a tool (file edit, terminal) failed during the turn
- `CONTEXT_EXCEEDED` — session exceeded context limit
- `CANCELLED` — user cancelled the turn
- `UNKNOWN` — fallback

**v1 behavior (no real failover yet, fully manual/transparent):**
1. Error is captured by the adapter, normalized into one of these
   categories, and published on the Event Bus as `session.error`.
2. Session moves to `status = failed` (or `interrupted` if user-cancelled)
   in `sessions`.
3. Renderer shows the error clearly in the conversation (does not freeze the
   UI), with a "try again" button that opens a new turn in the same session.
4. No automatic silent retry — v1 is transparent: if it failed, the user
   sees it and decides.
5. `TOOL_ERROR` does not kill the whole session — the turn continues, the
   tool error is recorded as an event and shown inline (Claude Code already
   handles most of this internally).

## 5. Testing

- **Backend (Node/Fastify)**: unit tests for Provider Router, Session
  Manager, and `ClaudeProviderAdapter` (mocking the Claude Agent SDK — no
  real calls in CI), using Vitest.
- **SQLite migrations**: test that runs all migrations from scratch and
  validates the resulting schema.
- **Error contract**: tests ensuring each adapter error category is
  normalized and propagated correctly to the Event Bus.
- **HTTP/WS integration**: contract tests against the local Fastify server
  (spin up on an ephemeral port, authenticate with token, exercise main
  routes).
- **Renderer (React)**: component tests for chat, project list, and diff
  viewer with Vitest + Testing Library.
- **Electron E2E**: automated end-to-end tests with Playwright covering the
  golden path (open project → send message → see streaming response → see
  diff).
- **Manual smoke test**: before considering v1 "done", run the real app,
  open a real project, send a real request, watch streaming, watch the
  diff — automated tests alone are not sufficient sign-off for a new
  desktop UI.

## 6. Repository bootstrap and icon/shortcut automation

**Folder structure:**
```
AgentOS/
├── apps/
│   ├── desktop/        (Electron main + preload + renderer React)
│   └── backend/         (Fastify backend standalone)
├── packages/
│   └── shared/          (shared types: ProviderAdapter, events, DTOs)
├── docs/
│   └── superpowers/specs/
├── assets/
│   └── icon/            (official icon in multiple sizes/formats)
├── scripts/
│   └── update-desktop-shortcut.ps1
├── package.json (workspaces)
└── README.md
```

**GitHub:** create a **private** repo `AgentOS` on the `marquezinii` account
via `gh repo create`, with a first commit containing the base structure plus
this design doc.

**Icon:** convert
`AgentOS_icone_sem_fundo_CORRIGIDO_recortado.png` to `.ico` (Windows) and
store it in `assets/icon/`, referenced by the Electron build (app icon,
window icon, installer icon).

**Desktop shortcut:** a script (`scripts/update-desktop-shortcut.ps1`)
creates/updates a `.lnk` on the desktop pointing at the latest built
executable, using the official icon. This script runs automatically as part
of the build process (`npm run build` triggers a `postbuild` step that
updates the shortcut) — so every rebuild automatically repoints the desktop
shortcut at the new build, with no manual step required.
