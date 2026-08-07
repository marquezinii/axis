# Axis Project State

## Atualizações integradas recentes

- **v0.2.0 — Axis v2 (2026-08-06/07, commits `9b0de94`…`e96c15e` em `main`)**:
  absorção do AgentOS (Electron + Fastify) e do SkillDrop (Python + PySide6)
  para dentro do binário Tauri único. Adiciona chat multi-provider (Claude via
  HTTP/SSE, OpenCode via spawn de CLI) com streaming, persistência SQLite de
  sessões/mensagens/diffs, painéis Workspace e History, e instalação de
  skills em lote (`batch_install_github`). AgentOS e SkillDrop originais
  preservados em `archive/` como referência somente-leitura, não mais
  desenvolvidos. Todos os testes (8) e `pnpm check`/`cargo clippy` passando
  ao final da integração (`e96c15e`).

## Visão geral e objetivo

Axis é um **workspace de desenvolvimento com IA local-first**, distribuído
como aplicativo Windows Tauri 2 (Rust + React), com dois focos que convivem no
mesmo binário:

1. **Descoberta e governança de skills/agentes**: detecta agentes de IA
   instalados na máquina (Codex, Claude Code, OpenCode, Antigravity),
   inventaria `SKILL.md` locais e de repositórios GitHub públicos, inspeciona
   antes de instalar (heurística de risco, nunca executa conteúdo), e instala
   com proveniência, hash e backup.
2. **Chat multi-provider com IA**: sessões de chat persistidas com streaming
   real via Claude (Anthropic API) ou OpenCode (CLI local), histórico
   navegável e diffs de arquivos modificados pelo agente durante a sessão.

Princípio central: tudo roda local, sem telemetria, sem enviar configuração
ou conversas para serviços de terceiros além do provider de IA escolhido
explicitamente pelo usuário (Claude → Anthropic API; OpenCode → processo
local).

## Estado atual

- Versão declarada em `package.json`, `src-tauri/Cargo.toml` e
  `src-tauri/tauri.conf.json`: **0.2.0**.
- Branches: `main` (pública/estável) e `dev/proxima-versao` (integração
  oficial da próxima versão — ver [`AI_RULES.md`](AI_RULES.md)). Sem tags
  Git, sem GitHub Releases.
- CI (`.github/workflows/ci.yml`) roda em push/PR para `main` e
  `dev/proxima-versao`: frontend (`pnpm format:check`, `pnpm check`) e Rust
  (`cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`).
- Distribuição: build local via `pnpm release:local` (`tauri build` +
  `scripts/sync-desktop-shortcut.ps1`, que atualiza o atalho **Axis** na Área
  de Trabalho). Sem instalador público, sem updater, sem assinatura de
  código, sem site.

## Tecnologias

- **Tauri 2** — shell desktop, binário único Windows, IPC entre React e Rust.
- **Rust (edition 2024)** — backend: `rusqlite` (SQLite embarcado, feature
  `bundled`), `reqwest` (HTTP/SSE, `rustls-tls`), `tokio` (`full`, runtime
  async), `async-trait`, `eventsource-stream`, `futures-util` (streaming),
  `zip`, `walkdir`, `sha2`/`hex` (hashing), `directories` (paths OS), `chrono`,
  `uuid`, `thiserror`, `rfd` (diálogos nativos), `serde`/`serde_json`/
  `serde_yaml`.
- **React 19 + Vite 7 + TypeScript** — frontend, sem framework de estado
  externo; hooks próprios (`useChat`, `useSessions`) sobre `@tauri-apps/api`.
- **CSS custom** (`src/App.css`, ~1700 linhas) — sem Tailwind, sem CSS-in-JS.
- **pnpm** — package manager do frontend (`pnpm-lock.yaml`,
  `pnpm-workspace.yaml`).
- **Prettier** — formatação do frontend. **rustfmt + clippy** — Rust.

## Arquitetura

```
React (src/) → invoke() Tauri IPC → comandos Rust (src-tauri/src/lib.rs, chat.rs)
                                          ↓
                        agents.rs · skills.rs · storage.rs · providers/*
                                          ↓
                    OS paths (agentes/skills) · GitHub HTTP · SQLite (LocalAppData) · Anthropic API / processo OpenCode
```

- O renderer **não** tem acesso genérico a filesystem ou execução de
  comandos — só os comandos Tauri expostos em `lib.rs`/`chat.rs`.
- `agents.rs`: convenções de detecção por agente (Codex, Claude Code,
  OpenCode, Antigravity).
- `skills.rs`: download de repositório público, validação de ZIP
  (traversal/symlink/limites), inspeção heurística, hash SHA-256, Vault,
  backup, instalação (individual e em lote via `batch_install_github`).
- `storage.rs`: schema e CRUD SQLite — dashboard (agentes/skills/sources/
  workspaces/activities) e chat (`chat_sessions`, `chat_messages`,
  `file_changes`, com FK + `CASCADE`).
- `chat.rs`: orquestrador de sessões de chat — `ActiveSessions`
  (`Arc<Mutex<HashMap>>`), 7 comandos Tauri (`chat_create_session`,
  `chat_send_message`, `chat_cancel`, `chat_get_sessions`,
  `chat_get_messages`, `chat_get_file_changes`, `chat_delete_session`),
  emite eventos `chat:token` / `chat:completed` / `chat:error` /
  `chat:file-changed` consumidos por `src/hooks/useChat.ts`.
- `providers/mod.rs`: trait `ChatProvider` (`async_trait`), `StreamEvent`,
  `ProviderError`, `provider_registry()` — ponto de extensão para novos
  providers.
- `providers/claude.rs`: POST `https://api.anthropic.com/v1/messages` com
  streaming SSE via `bytes_stream()`; mapeia 401→`AuthExpired`,
  429→`RateLimited`, 529→`ProviderUnavailable`.
- `providers/opencode.rs`: `tokio::process::Command` spawn de
  `opencode chat --message "..." --project <path>`, streaming linha a linha
  via `BufReader::lines()`, `kill_on_drop(true)`.
- `src/hooks/useChat.ts` e `useSessions.ts`: única ponte do frontend para o
  chat — escutam eventos Tauri e chamam os comandos IPC.
- `src/components/workspace/`: `ChatView`, `ProviderSelector`,
  `WorkspacePanel`, `SessionList` — UI das abas Workspace/History.

## Estrutura relevante do repositório

```
src/
  hooks/            useChat.ts, useSessions.ts
  components/workspace/   ChatView, ProviderSelector, WorkspacePanel, SessionList
  App.tsx           root — navegação por abas (8), inclui Workspace/History
  App.css           design system (dark-only, Catppuccin-ish)
src-tauri/src/
  lib.rs            comandos Tauri não-chat (dashboard/agents/skills/sources)
  chat.rs           orquestrador de chat + 7 comandos Tauri
  storage.rs        schema + CRUD SQLite
  models.rs         tipos compartilhados
  providers/         mod.rs (trait/registry), claude.rs, opencode.rs
  agents.rs         detecção de agentes instalados
  skills.rs         descoberta/instalação de skills GitHub
archive/
  agentos/          AgentOS original (referência, não editar)
  skilldrop/        SkillDrop original (referência, não editar)
docs/superpowers/    plano mestre e spec do design unificado do Axis v2
.superpowers/sdd/    ledger de tasks/commits/vereditos da implementação do v2
scripts/
  sync-desktop-shortcut.ps1   atualiza atalho da Área de Trabalho após build
```

## Decisões técnicas e padrões

- **Skill content nunca é executado** — decisão de segurança permanente (ver
  `SECURITY.md`). Discovery e instalação só leem/copiam arquivos.
- **Sem sidecars/binários externos** — OpenCode roda via spawn de processo
  (`tokio::process::Command`), Claude via HTTP direto. Isso foi decisão
  deliberada para manter o deploy como um único `.exe`.
- **`ANTHROPIC_API_KEY` só existe como env var em runtime** — nunca é
  persistida em SQLite, config ou log. Não implementado ainda: UI para
  gerenciar a chave (listado como próxima prioridade).
- **Streaming via Tauri Events**, não via retorno direto do `invoke` — decisão
  para desacoplar backend/frontend e permitir cancelamento (`chat_cancel`)
  e futura UI de aprovação de tool calls.
- **`crypto.randomUUID()`** para IDs de mensagem no frontend — evita
  dependência `uuid` no lado JS (o lado Rust já usa a crate `uuid`).
- **CSS custom sem Tailwind** — decisão de manter bundle pequeno e controle
  total; não introduza Tailwind/CSS-in-JS sem decisão explícita nova.
- **Somente repositórios GitHub públicos são suportados** — autenticação
  privada não é implementada; Axis não pede nem armazena credenciais GitHub.
- **Rejeitado/não feito por decisão, não por esquecimento**: updater
  automático, assinatura de código, GitHub Releases — a distribuição é local
  por design nesta fase (ver `AI_RULES.md` § Publicação).
- Variantes `StreamEvent::ToolCallStarted/Finished/FileChanged` existem no
  enum mas ainda não são construídas em nenhum fluxo — mantidas de propósito
  para o próximo trabalho de tool calls (não é código morto acidental).

## Funcionalidades presentes no código atual

- Detecção de Codex, Claude Code, OpenCode e Antigravity.
- Inventário global e por workspace de skills, com deduplicação.
- Inspeção de `SKILL.md` (frontmatter, arquivos, sinais heurísticos de risco)
  antes de instalar.
- Instalação individual (`install_github`) e em lote
  (`batch_install_github`) de skills de repositórios GitHub públicos, para um
  ou mais agentes.
- Proveniência, hash SHA-256, Vault local e backup antes de substituir uma
  instalação gerenciada; bloqueio se houver alteração local não commitada.
- Checagem de atualização por commit (`check_updates`).
- Registro de sources, workspaces e activities em SQLite.
- Chat multi-provider (Claude, OpenCode) com streaming token-a-token,
  cancelamento, histórico persistido, diffs de arquivo por sessão.
- Navegação por 8 abas: Home, Agentes, Skills, Fontes, Projetos, Atividade,
  Workspace, History.
- Paleta de comandos e atalhos de teclado (interface em Português do Brasil).

## Integrações e serviços externos

- **Anthropic API** (`api.anthropic.com/v1/messages`) — usada por
  `providers/claude.rs` quando o usuário escolhe o provider Claude. Requer
  `ANTHROPIC_API_KEY` como variável de ambiente; nunca persistida.
- **GitHub REST + zipball** — usada por `skills.rs` para inspecionar e baixar
  repositórios públicos de skills. Sem autenticação, sem suporte a
  repositórios privados.
- **OpenCode CLI** — processo local invocado via spawn; não é um serviço de
  rede administrado pelo Axis.

## Dados, persistência e migrations

- SQLite embarcado (`rusqlite`, feature `bundled`) em
  `%APPDATA%\Axis\axis.db` (Windows `data_dir()`).
- Tabelas de dashboard: agentes/skills/sources/workspaces/activities (schema
  em `storage.rs`).
- Tabelas de chat: `chat_sessions`, `chat_messages`, `file_changes`, com
  chaves estrangeiras e `ON DELETE CASCADE`.
- Não há sistema de migrations versionado explícito — `storage.rs` cria o
  schema via `CREATE TABLE IF NOT EXISTS` na conexão. Mudanças de schema
  precisam ser compatíveis com bancos já existentes de usuários (não há
  processo de migração automática para renomear/remover colunas).
- Vault e backups de skills instaladas ficam em `LocalAppData`, fora do
  SQLite.

## Segurança e privacidade

Ver `SECURITY.md` para o texto oficial. Resumo relevante para
desenvolvimento:

- Zero telemetria/phone-home.
- Skills são tratadas como não confiáveis; nunca executadas durante
  descoberta ou instalação.
- ZIPs de GitHub têm limites de tamanho/expansão; entradas com traversal ou
  symlink são rejeitadas na extração.
- Instalações gerenciadas comparam hash antes de substituir; alteração local
  detectada interrompe a operação; backup atômico antes de substituir.
- CSP do Tauri: `default-src 'self'; connect-src 'self' ipc:
http://ipc.localhost` (mais o host da Anthropic API quando o chat Claude
  está em uso — confirme em `src-tauri/tauri.conf.json` antes de alterar).

## Distribuição / build local

Não há deploy, release pública ou instalador distribuído neste momento.
`pnpm release:local` executa `tauri build` (build Rust `release`, mais lento)
e depois `scripts/sync-desktop-shortcut.ps1`, que aponta o atalho **Axis** da
Área de Trabalho para `src-tauri/target/release/axis.exe`. Não invente
infraestrutura de release/updater/assinatura que não existe — ver
`AI_RULES.md` § Publicação.

## Limitações e cuidados conhecidos

- Preview de atualização de skill expõe estado do commit, mas ainda não tem
  diff textual completo por arquivo.
- Backups são criados e retidos, mas não há fluxo visual de Restore ainda.
- Sources são catálogos armazenados; indexação em background e navegação
  por-source ainda são básicas.
- Repositórios GitHub privados, updates automáticos confiáveis, "Linked
  Mode", watchers de filesystem e início automático com o Windows não estão
  implementados.
- Builds de desenvolvimento não são assinadas (podem disparar aviso de
  reputação do Windows).
- Reenvio de sessão de chat (carregar histórico existente de volta no
  `ChatView` para continuar) ainda não está implementado — `SessionList`
  navega para a sessão mas o hidratar de mensagens antigas no `useChat` é
  trabalho futuro.
- `StreamEvent::ToolCallStarted/Finished/FileChanged` não têm UI de aprovação
  de tool call ainda — variantes existem, fluxo não está completo.
- Sem testes de frontend, E2E ou de integração de skills maliciosas reais —
  só cobertura Rust unitária/integração (8 testes).
- `display_name` em `providers/mod.rs` não é usado atualmente pela UI
  (provider display name ainda hardcoded em `ProviderSelector.tsx`).

## Dívida técnica e pendências relevantes

1. Preview de diff textual por arquivo em updates de skill.
2. Fluxo visual de Restore a partir de backup.
3. Indexação em cache das sources e detalhes de refresh.
4. Testes de integração com arquivos ZIP maliciosos/multi-skill locais.
5. Suporte a mais providers (Codex/OpenAI Responses API, Antigravity,
   Gemini) — extensão natural via `ChatProvider` trait.
6. Implementar `ToolCallStarted/Finished` de fato + UI de aprovação.
7. Resume de sessão (hidratar histórico), renomear sessão, exportar
   JSON/MD.
8. `DiffViewer.tsx` completo (hoje é preview simples em `ChatView`).
9. UI para gerenciar `ANTHROPIC_API_KEY` (hoje só env var).
10. Busca full-text no histórico (FTS5).
11. Workspace switcher (hoje usa `workspaces[0]` implicitamente).
12. Signing, CI de release e updater confiável — dependem de decisão de
    produto explícita antes de virar trabalho de rotina.

## Comandos de desenvolvimento

```powershell
pnpm install                 # instalar dependências
pnpm dev                     # ou: pnpm tauri dev — dev com hot reload
pnpm build                   # tsc && vite build → dist/
pnpm check                   # tsc --noEmit && vite build
pnpm format / format:check   # Prettier
pnpm release:local           # tauri build + atualiza atalho da Área de Trabalho

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Pré-requisitos: Node.js 22, pnpm, Rust stable com MSVC, Visual Studio Build
Tools, WebView2 (ver `CONTRIBUTING.md`).

## Validação e handoff atual

- Última validação oficial conhecida: `cargo test --manifest-path
src-tauri/Cargo.toml` → **8 passed, 0 failed** (4 lib: `agents.rs` +
  `skills.rs`; 2 `tests/chat_tests.rs`; 2 `tests/storage_tests.rs`),
  confirmado nesta sessão de bootstrap de governança.
- `pnpm format:check`/`pnpm check`/`cargo fmt`/`cargo clippy` não foram
  reexecutados nesta sessão (mudança foi exclusivamente documental, sem
  tocar `src/` ou `src-tauri/src/`); a última execução conhecida com sucesso
  é a da integração `e96c15e` (ver dossiê do projeto).
- Estado para a próxima IA: `main` e `dev/proxima-versao` sincronizadas nesta
  mudança de governança; sem branches `ai/*` abertas; sem worktrees além do
  principal; sem tarefas pendentes em `.ai/tasks/`.
