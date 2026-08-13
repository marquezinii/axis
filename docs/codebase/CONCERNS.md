# Codebase Concerns

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Riscos/dívidas identificados em código, scan (`docs/codebase/.codebase-scan.txt`) e documentação oficial. Itens de intenção de time marcados como `[ASK USER]`.

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | **`batch_install_github` no frontend monta request inválido**: `url` recebe `skill?.source` (`"Axis Vault"`/`"Source unknown"`), que não é uma URL GitHub; `skills` recebe o nome da skill, não o `relativePath` esperado por `InstallRequest` | `src/App.tsx` (função `batchInstall`, linhas ~499-515); contrato em `src-tauri/src/models.rs` (`InstallRequest { url, skills, agents }`) | fluxo "Install to all agents" tende a falhar em runtime ou instalar skill errada | corrigir para usar a fonte/URL real do repositório e o caminho relativo; adicionar teste |
| high | **Sem isolamento de banco nos testes de integração**: `chat_tests.rs` adiciona o workspace `C:\` e ambos os arquivos de teste gravam no `axis.db` real de LocalAppData | `src-tauri/tests/chat_tests.rs` (linha 9), `src-tauri/tests/storage_tests.rs`; `storage::connect()` aponta para `data_dir()/axis.db` | testes contaminam dados locais do usuário; suíte não é determinística entre máquinas | usar `tempfile`/DB em memória injetando path no storage |
| medium | **`chat_send_message` executa `get_sessions(0)?` e descarta o resultado** antes de consultar a sessão correta | `src-tauri/src/chat.rs` (linha 43) | chamada morta; risco de confusão; custo de I/O desnecessário | remover a chamada |
| medium | **Sem migrations versionadas no SQLite**; schema via `CREATE TABLE IF NOT EXISTS` | `src-tauri/src/storage.rs` (linhas 17-56); `PROJECT_STATE.md` § Dados, persistência e migrations | mudanças de schema que renomeiem/removam colunas quebram bancos existentes sem migração | adotar migrações incrementais quando o schema evoluir |
| medium | **`src/App.tsx` é monolítico (~1360 linhas) e `src/App.css` ~1700 linhas** | `src/App.tsx`; `PROJECT_STATE.md` (CSS ~1700 linhas) | alta churn e difícil manutenção/leitura | quebrar em componentes; sem Tailwind por decisão (`PROJECT_STATE.md`) |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Resume de sessão não implementado (SessionList navega mas não hidrata mensagens) | v2 entregue com chat básico; hidratação deixada para futuro | `src/App.tsx` (onSelectSession), `src/hooks/useChat.ts` | histórico persistido fica inacessível para continuar conversa | hidratar `chat_get_messages` no `useChat` |
| Preview de diff textual por arquivo em updates incompleto | `DiffViewer.tsx` completo pendente | `PROJECT_STATE.md` § Dívida técnica (itens 1, 8); `ChatView.tsx` (preview simples) | usuário não vê o que mudaria antes de atualizar | implementar diff por arquivo |
| Sem fluxo visual de Restore a partir de backups | backups são criados/retidos sem UI | `src-tauri/src/skills.rs`; `PROJECT_STATE.md` (item 2) | backups inúteis em caso de necessidade real | adicionar UI de restore |
| Sources são catálogos; indexação/refresh básicos | escopo inicial | `PROJECT_STATE.md` (item 3) | navegação por fonte limitada | cache/indexação em background |
| Tool calls: `StreamEvent::ToolCallStarted/Finished/FileChanged` sem fluxo completo | variantes existem de propósito; UI de aprovação pendente | `src-tauri/src/providers/mod.rs`; `PROJECT_STATE.md` (item 6) | providers não emitem tool calls; `FileChanged` nunca emitido | implementar quando tool calls forem suportadas |
| UI para gerenciar `ANTHROPIC_API_KEY` inexistente | chave só via env var (decisão de segurança) | `PROJECT_STATE.md` (item 9); `src-tauri/src/providers/claude.rs` | experiência ruim para usuário não-técnico | `[ASK USER]` sobre UX de chave |
| Sem workspace switcher — usa `workspaces[0]` implicitamente | escopo inicial | `src/App.tsx` (linhas ~1075, ~1097) | chat/history sempre no primeiro workspace | `[ASK USER]` prioridade |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Conteúdo de skill não confiável (scripts, hooks) | A08 (Software/Data Integrity) / Supply chain | `SECURITY.md`; `src-tauri/src/skills.rs` | nunca executado; leitura/cópia apenas; limites de arquivo/ZIP (100MB/250MB/10k files), rejeição de traversal/symlink; inspeção heurística; hash antes de substituir | scanner é heurístico, sem análise de malware/sandbox (limitação assumida em `SECURITY.md`) |
| Exposição de secrets | A02 (Cryptographic Failures) / secret management | `src-tauri/src/providers/claude.rs` (env var); `AI_RULES.md` | `ANTHROPIC_API_KEY` nunca persistida; `.gitignore` cobre `.env*` | sem rotação/UI; `[TODO]` |
| Path traversal em URLs/instalação | A03 (Injection) / path traversal | `src-tauri/src/skills.rs` (`parse_github_url`, `enclosed_name`, canonicalize `starts_with`, `copy_tree` rejects `ParentDir`/`RootDir`/`Prefix`) | validações em múltiplas camadas | cobertura de testes maliciosos inexistente (item 4 da dívida) |
| Segurança de repositórios/junctions | — | `SECURITY.md` § Known limitations | detecção de symlink no Rust | hardening de reparse points depende do OS; revisão manual recomendada |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| `storage::connect()` abre nova conexão SQLite a cada chamada | `src-tauri/src/storage.rs` (todas as funções chamam `connect()`) | overhead de conexão em fluxos de chat com várias operações por mensagem | alto para muitas mensagens/sessões | pool/reutilização de conexão ou `Mutex<Connection>` |
| Modelo Anthropic hardcoded (`claude-sonnet-4-20250514`) e `max_tokens: 4096` fixos | `src-tauri/src/providers/claude.rs` (linhas 44-45) | sem configuração por usuário/sessão | baixo | expor como config quando houver seletor de modelo |
| Download ZIP inteiro em memória (`Vec<u8>`) com limite 100MB | `src-tauri/src/skills.rs` (linhas 135-145) | pico de memória proporcional ao repositório | alto para repos grandes | streamar para disco |
| Hash dir lê todos os arquivos para SHA-256 | `src-tauri/src/skills.rs` (`hash_dir`) | custo O(total bytes) em cada descoberta/instalação | médio com muitos skills | cache de hash por conteúdo (ex.: mtime+size) `[TODO]` |
| `App.tsx` monólito com muitos `setState`/rerender | `src/App.tsx` | UI com filtros/busca recomputados por memo (parcial) | médio com catálogos grandes | memoização adicional/componentização |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `src-tauri/Cargo.toml` + `Cargo.lock` | dependências do núcleo; cada feature nova toca | 7 commits nos últimos 90 dias (scan) | revisar lock com cuidado; CI valida `-D warnings` |
| `src/App.tsx` / `src/App.css` | monólito de UI + design system custom | 5 commits cada (scan) | mudanças pequenas com `pnpm check`; evitar reformatação massiva |
| `src-tauri/src/lib.rs` | todo comando novo é registrado aqui | 5 commits (scan) | adicionar comando + handler no mesmo commit |
| `src-tauri/src/skills.rs` | segurança + lógica de instalação concentradas (645 linhas) | 3 commits (scan) | mexer com `cargo test` e clippy; preservar limites de segurança (`SECURITY.md`) |
| `PROJECT_STATE.md` / `README.md` / `AI_RULES.md` | documentos oficiais frequentemente atualizados | 3/3/2 commits (scan) | não editar em tarefas paralelas (regra `AI_RULES.md` § Relatório) |

### 6) `[ASK USER]` Questions

1. [ASK USER] O fluxo `batch_install_github` (UI "Install to all agents") está quebrado na prática (monta URL a partir de `skill.source`). Deve ser corrigido agora ou documentado como pendência?
2. [ASK USER] Os testes de integração gravam no banco SQLite real do usuário. Adotar isolamento com banco temporário é prioridade aceitável?
3. [ASK USER] Há intenção de adotar logging estruturado (hoje não existe logging em código) ou os erros por `Result`/eventos são o modelo definitivo?
4. [ASK USER] O CSP em `src-tauri/tauri.conf.json` não lista `api.anthropic.com`, divergindo do `PROJECT_STATE.md`. Como o HTTP é feito pelo backend Rust (fora do WebView), manter o CSP atual e corrigir o `PROJECT_STATE.md`, ou adicionar o host?
5. [ASK USER] `src/App.tsx` é monolítico (~1360 linhas). Quebrá-lo em componentes é desejado como trabalho futuro (fora do escopo de uma feature específica)?
6. [ASK USER] `workspaces[0]` é usado implicitamente para Workspace/History. Um workspace switcher está no roadmap da próxima versão?

### 7) Evidence

- `docs/codebase/.codebase-scan.txt` (high-churn files, code metrics, security sections; TODO/FIXME/HACK em produção: **nenhum** — "None found")
- `src/App.tsx`, `src/hooks/useChat.ts`, `src/hooks/useSessions.ts`
- `src-tauri/src/chat.rs`, `src-tauri/src/skills.rs`, `src-tauri/src/storage.rs`, `src-tauri/src/providers/claude.rs`
- `src-tauri/tests/chat_tests.rs`, `src-tauri/tests/storage_tests.rs`
- `SECURITY.md`, `PROJECT_STATE.md` (§ Limitações, § Dívida técnica), `AI_RULES.md`
