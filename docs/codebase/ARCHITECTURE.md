# Architecture

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Baseado em leitura dos arquivos; quando documentação oficial (README/ARCHITECTURE/PROJECT_STATE) e código divergem, o código prevalece e a divergência é registrada.

## Core Sections (Required)

### 1) Architectural Style

- Primary style: aplicativo desktop em camadas (layered) com shell Tauri — renderer React → camada de comandos IPC → serviços Rust → integrações (SQLite/HTTP/processo local).
- Why this classification: separação explícita em `src-tauri/src/` por responsabilidade (agents/skills/storage/chat/providers), com comandos Tauri estreitos como única porta de entrada do renderer (`src-tauri/src/lib.rs` expõe 18 comandos; `src/hooks/useChat.ts`/`useSessions.ts` são as únicas pontes do chat).
- Primary constraints:
  1. Renderer nunca recebe acesso genérico a filesystem/execução — tudo passa por comandos Tauri (`AI_RULES.md` § Segurança; `src-tauri/src/lib.rs`).
  2. Conteúdo de skill é lido/copiado, nunca executado (`SECURITY.md`; `src-tauri/src/skills.rs`).
  3. Deploy é um único `.exe` local para Windows; sem sidecars/binários externos além do `opencode` já instalado na máquina do usuário (`PROJECT_STATE.md` § Decisões técnicas).

### 2) System Flow

```text
UI (src/App.tsx, hooks) -> invoke() Tauri IPC -> comandos Rust (lib.rs / chat.rs)
    -> services (agents.rs, skills.rs, storage.rs, providers/*)
    -> integrações (SQLite %APPDATA%, GitHub REST/zipball, Anthropic API, processo opencode)
    -> resposta/eventos (Dashboard serializado; eventos chat:token/completed/error/file-changed)
```

Fluxo em 5 passos (evidência por arquivo):

1. **Entrada no renderer**: `src/App.tsx` chama `invoke<Dashboard>('get_dashboard')` no load (`src/App.tsx` linhas 399-411); hooks de chat chamam `chat_*` (`src/hooks/useChat.ts`, `src/hooks/useSessions.ts`).
2. **Camada de comandos**: `src-tauri/src/lib.rs` registra comandos não-chat (`get_dashboard`, `rescan`, `inspect_github`, `install_github`, `batch_install_github`, `check_updates`, etc.) e delega para `agents::`, `skills::`, `storage::`; `src-tauri/src/chat.rs` registra os 7 comandos de chat.
3. **Lógica de domínio**: `skills.rs` (download/validação ZIP, inspeção, hash, Vault, instalação), `agents.rs` (detecção por convenções de paths), `providers/claude.rs` e `providers/opencode.rs` (streaming).
4. **Persistência/integração**: `storage.rs` — SQLite em `%APPDATA%\Axis\axis.db` via `rusqlite` bundled (`storage.rs` linhas 6-56); GitHub via `reqwest::blocking` (`skills.rs`); Anthropic via `reqwest` async + SSE (`claude.rs`); OpenCode via `tokio::process::Command` (`opencode.rs`).
5. **Saída**: comandos retornam `Dashboard`/tipos serializados; chat emite eventos Tauri consumidos por `useChat.ts` (streaming token a token, cancelamento via `chat_cancel` + `ActiveSessions`).

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| Renderer (`src/`) | UI, navegação (8 abas + settings), estado local, chamadas IPC | filesystem/execução direta | `src/App.tsx`; `AI_RULES.md` |
| `lib.rs` | registro de comandos Tauri, snapshot do dashboard, restrição de pastas gerenciadas (`open_managed_folder`) | lógica de negócio de skills/chat | `src-tauri/src/lib.rs` |
| `agents.rs` | detecção de Codex/Claude/OpenCode/Antigravity por executável/config/paths | executar os agentes detectados | `src-tauri/src/agents.rs` (comentário em `detect`) |
| `skills.rs` | GitHub público, ZIP seguro, inspeção heurística, hash, Vault, backup, instalação/atualização | execução de conteúdo | `src-tauri/src/skills.rs`; `SECURITY.md` |
| `storage.rs` | schema e CRUD SQLite | regras de domínio | `src-tauri/src/storage.rs` |
| `chat.rs` | sessões ativas (cancelamento), streaming para eventos Tauri, persistência de mensagens | chamadas HTTP ao provider | `src-tauri/src/chat.rs` |
| `providers/` | trait `ChatProvider` + implementações (Claude HTTP/SSE; OpenCode spawn CLI) | UI e persistência | `src-tauri/src/providers/mod.rs`, `claude.rs`, `opencode.rs` |
| `models.rs` | tipos compartilhados (serde, camelCase) | I/O | `src-tauri/src/models.rs` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Trait + registro (Strategy/Adapter) | `AgentAdapter` (`agents.rs`), `ChatProvider` + `provider_registry()` (`providers/mod.rs`) | ponto de extensão por agente/provider; mesma forma documentada em `PROJECT_STATE.md` |
| Estado compartilhado (Arc<Mutex<HashMap>>) | `ActiveSessions.cancel_tokens` (`chat.rs`) | cancelamento de streaming entre comandos async |
| Streaming via Tauri Events | `chat.rs` emite `chat:token/completed/error/file-changed`; `useChat.ts` escuta | desacopla backend/frontend e permite cancelamento (decisão em `PROJECT_STATE.md`) |
| Comando Tauri -> snapshot() -> Dashboard | `lib.rs` (quase todos os comandos retornam `snapshot()`) | resposta consistente após mutação |
| `CREATE TABLE IF NOT EXISTS` na conexão | `storage.rs::connect()` | schema criado sob demanda; sem sistema de migrations versionado |

### 5) Known Architectural Risks

- **`chat_send_message` executa `get_sessions(0)?` e descarta o resultado** (`chat.rs` linha 43) — chamada morta antes da consulta real da sessão; risco de confusão e custo desnecessário.
- **`storage::connect()` abre nova conexão a cada função** (`storage.rs`) — em fluxos de chat (que chamam `connect()` várias vezes por mensagem) pode haver overhead; `[TODO]`: medir se há impacto real.
- **`batch_install_github` montado no frontend com dados não-URL** — `src/App.tsx` (`batchInstall`) usa `url: skill?.source` e `skills: [skill?.name]`; `skill.source` é `"Axis Vault"`/`"Source unknown"`, não uma URL GitHub, então o fluxo de batch install tende a falhar em runtime (ver `CONCERNS.md`).
- **CSP atual não lista `api.anthropic.com`** — `src-tauri/tauri.conf.json` (connect-src `self ipc: http://ipc.localhost`), enquanto `PROJECT_STATE.md` afirma "mais o host da Anthropic API quando o chat Claude está em uso". Como o backend Rust faz o HTTP diretamente (não o renderer), o CSP atual não bloqueia o chat; a divergência é documental (registrada no resumo final).
- **`StreamEvent::ToolCallStarted/Finished/FileChanged` existem mas não são produzidos por nenhum provider** — mantidos de propósito para trabalho futuro de tool calls (`PROJECT_STATE.md`), porém `FileChanged` também nunca é emitido hoje (nenhum provider envia esse evento).

### 6) Evidence

- `src-tauri/src/lib.rs` (comandos, run(), `snapshot`)
- `src-tauri/src/chat.rs` (orquestrador, eventos, cancelamento)
- `src-tauri/src/providers/mod.rs`, `claude.rs`, `opencode.rs`
- `src-tauri/src/skills.rs`, `src-tauri/src/storage.rs`, `src-tauri/src/agents.rs`
- `src/App.tsx`, `src/hooks/useChat.ts`, `src/hooks/useSessions.ts`
- `src-tauri/tauri.conf.json`
