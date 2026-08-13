# Testing Patterns

Documento gerado pelo workflow acquire-codebase-knowledge (Phase 1-4). Baseado em `src-tauri/tests/`, módulos `#[cfg(test)]` e `.github/workflows/ci.yml`.

## Core Sections (Required)

### 1) Test Stack and Commands

- Primary test framework: Rust — `cargo test` (harness padrão, sem framework externo; usa `assert_eq!`/`assert!`). Versão: Rust stable (toolchain do CI).
- Assertion/mocking tools: nenhum framework de mocking; testes usam o SQLite real.
- Commands:

```bash
cargo test --manifest-path src-tauri/Cargo.toml      # todos os testes (Rust)
pnpm check                                           # typecheck+build frontend (sem testes)
pnpm format:check                                    # formatação (CI)
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Não existem comandos para testes frontend, E2E ou coverage (confirmado em `AI_RULES.md` § Validações: "Não existem testes E2E, testes de UI automatizados ou testes de frontend neste projeto hoje").

### 2) Test Layout

- Test file placement pattern: testes unitários inline em `#[cfg(test)] mod tests` dentro dos módulos (`src-tauri/src/agents.rs`, `src-tauri/src/skills.rs`) + testes de integração em `src-tauri/tests/` (`chat_tests.rs`, `storage_tests.rs`).
- Naming convention: `test_*`/nomes descritivos (`test_session_lifecycle`, `parses_supported_github_urls`).
- Setup files and where they run: sem setup compartilhado; cada teste chama `storage::connect()`/`add_workspace` diretamente (usa o banco real de LocalAppData — ver 5).

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | yes (parcial) | parse de URLs GitHub, hash de conteúdo, unicidade de adapters | 4 testes inline: 1 em `agents.rs`, 3 em `skills.rs` |
| Integration | yes (parcial) | SQLite storage e ciclo de vida de sessão/mensagem | 2 em `src-tauri/tests/storage_tests.rs`, 2 em `src-tauri/tests/chat_tests.rs` |
| E2E | no | — | não existem testes de UI/E2E (`AI_RULES.md`) |
| Frontend | no | — | nenhum runner/asserção configurado em `package.json` |

Total conhecido: **8 testes** (`PROJECT_STATE.md` § Validação e handoff atual; código confere: 1+3+2+2). Não reexecutados nesta sessão de documentação (mudança só em `docs/codebase/`).

### 4) Mocking and Isolation Strategy

- Main mocking approach: nenhum mocking; testes de storage/chat operam sobre o SQLite real (mesmo `%APPDATA%\Axis\axis.db` de produção).
- Isolation guarantees: nenhuma — os testes inserem workspaces/sessões com IDs UUID únicos para evitar colisão, mas **não isolam o banco** (risco de estado persistente entre execuções; ver `CONCERNS.md`).
- Common failure mode in tests: dependência de banco real pode poluir dados locais do usuário; `chat_tests.rs` adiciona workspace `C:\` ao banco real durante a execução. `[TODO]`: considerar `tempfile`/DB em memória para isolar.

### 5) Coverage and Quality Signals

- Coverage tool + threshold: nenhum (sem tarpaulin/llvm-cov configurado; CI não gera coverage).
- Current reported coverage: `[TODO]` (desconhecida; não há relatório no repositório).
- Known gaps/flaky areas: sem testes para `providers/` (claude/opencode — exigiriam mocks de rede/processo), sem testes para a UI, sem testes de ZIP malicioso/multi-skill (pendência em `PROJECT_STATE.md` § Dívida técnica, item 4), sem testes de `batch_install_github`.

### 6) Evidence

- `src-tauri/tests/chat_tests.rs`, `src-tauri/tests/storage_tests.rs`
- `src-tauri/src/agents.rs` (mod tests), `src-tauri/src/skills.rs` (mod tests)
- `.github/workflows/ci.yml` (job `rust` roda `cargo test`)
- `package.json` (scripts — sem script de teste frontend)
- `PROJECT_STATE.md` (§ Validação e handoff atual; § Limitações), `AI_RULES.md` (§ Validações)
