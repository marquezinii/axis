# External Integrations

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Integrações identificadas nos manifestos (`src-tauri/Cargo.toml`, `package.json`) e no código (`skills.rs`, `providers/*.rs`, `storage.rs`).

## Core Sections (Required)

### 1) Integration Inventory

| System | Type (API/DB/Queue/etc) | Purpose | Auth model | Criticality | Evidence |
|--------|---------------------------|---------|------------|-------------|----------|
| GitHub REST API (`api.github.com`) | API HTTP | resolver repositório, commit (ref) e status de updates | nenhuma (somente públicos) | high | `src-tauri/src/skills.rs` (`download_repo`, `remote_commit`) |
| GitHub zipball (`/zipball/{ref}`) | Download HTTP | baixar repositório para staging/inspeção | nenhuma (somente públicos) | high | `src-tauri/src/skills.rs` |
| Anthropic Messages API (`https://api.anthropic.com/v1/messages`) | API HTTP + SSE | chat streaming (provider Claude) | `ANTHROPIC_API_KEY` (env var, header `x-api-key`) | high | `src-tauri/src/providers/claude.rs` |
| OpenCode CLI | processo local | chat via CLI local (provider OpenCode) | credenciais do próprio OpenCode (fora do Axis) | high | `src-tauri/src/providers/opencode.rs` |
| SQLite (embarcado) | DB local | persistência (dashboard + chat) | nenhuma (arquivo local) | high | `src-tauri/src/storage.rs` |
| Filesystem OS (paths de agentes/skills) | FS | descoberta/instalação de skills nos agentes | permissões do usuário | high | `src-tauri/src/agents.rs`, `src-tauri/src/skills.rs` |

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| SQLite `axis.db` | dashboard (workspaces, sources, activities, installations, settings) + chat (chat_sessions, chat_messages, file_changes) | `src-tauri/src/storage.rs` (rusqlite bundled, WAL, FK ON) | schema criado via `CREATE TABLE IF NOT EXISTS`; mudanças de coluna não migradas automaticamente | `src-tauri/src/storage.rs` linhas 17-56 |
| Vault (`data_dir()/vault`) | cópia imutável por commit de skills instaladas | `skills.rs::install` (`copy_tree` para `vault/{folder}/{commit}`) | crescimento ilimitado por commit `[TODO]` | `src-tauri/src/storage.rs` (data_dir), `src-tauri/src/skills.rs` |
| Backups (`data_dir()/backups`) | estado anterior antes de substituir instalação | `skills.rs::install` | sem fluxo de Restore na UI | `src-tauri/src/skills.rs`; `PROJECT_STATE.md` § Limitações |
| Staging/sources/cache/logs (`data_dir()/...`) | diretórios auxiliares criados no connect | `storage::data_dir()` | sem uso explícito de cache/logs no código atual `[TODO]` | `src-tauri/src/storage.rs` linhas 10-14 |

### 3) Secrets and Credentials Handling

- Credential sources: `ANTHROPIC_API_KEY` via variável de ambiente em runtime (`src-tauri/src/providers/claude.rs` linha 17). GitHub: sem credenciais — somente repositórios públicos (`SECURITY.md` § Network; `skills.rs`).
- Hardcoding checks: nenhum secret hardcoded encontrado nos arquivos de código lidos; `.gitignore` exclui `.env*`; `AI_RULES.md`/`PROJECT_STATE.md` proíbem persistir a chave.
- Rotation or lifecycle notes: não há UI para gerenciar a chave (pendência registrada em `PROJECT_STATE.md` § Dívida técnica, item 9); `[TODO]`.

### 4) Reliability and Failure Behavior

- Retry/backoff behavior: não implementado — chamadas HTTP únicas (timeout de 45s em `skills.rs::client()`; reqwest default no provider Claude). `[TODO]`
- Timeout policy: `skills.rs` — 45s (client builder); ClaudeProvider — sem timeout explícito configurado (usa `reqwest::Client::new()`, mapeia `e.is_timeout()` → `ProviderUnavailable`); OpenCode — spawn sem timeout.
- Circuit-breaker or fallback behavior: nenhum; erros propagam como `Result`/`ProviderError`/eventos `chat:error`.

### 5) Observability for Integrations

- Logging around external calls: não há logging estruturado; erros retornam mensagens de texto (UI mostra `chat:error`/`setError`).
- Metrics/tracing coverage: nenhuma telemetria/APM (decisão de privacidade, `PROJECT_STATE.md` — zero phone-home).
- Missing visibility gaps: sem log central de chamadas externas, sem tracing de sessões de chat, sem métricas de uso GitHub/Anthropic. `[TODO]`

### 6) Evidence

- `src-tauri/src/skills.rs` (GitHub REST + zipball, limites MAX_ARCHIVE/MAX_EXTRACTED/MAX_FILES)
- `src-tauri/src/providers/claude.rs` (Anthropic API, headers, mapeamento de status)
- `src-tauri/src/providers/opencode.rs` (spawn CLI, kill_on_drop)
- `src-tauri/src/storage.rs` (SQLite, data_dir, schema)
- `SECURITY.md`, `PROJECT_STATE.md` (§ Integrações e serviços externos, § Segurança e privacidade)
