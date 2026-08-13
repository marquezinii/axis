# Tarefa: corrigir batch install da UI (origem GitHub de skills) - reaplicacao local

## Agente, branch e objetivo

- Agente: executor
- Branch: `ai/executor/fix-batch-install-source-local` (base `1ab1aa6`, HEAD atual)
- Status: pronto para integracao (commit local unico, sem push, sem merge)
- Objetivo: fazer o botao "Install to all agents" funcionar para skills gerenciadas com origem GitHub conhecida; nunca enviar rotulos ("Axis Vault"/"Source unknown") ou caminhos arbitrarios como URL; falhar claramente no frontend para skills sem origem, sem instalacao parcial.

## Root cause

- `src/App.tsx` montava `InstallRequest { url: skill.source, skills: [skill.name] }`.
- `skills::discover` preenchia `DetectedSkill.source` com rotulos ("Axis Vault"/"Source unknown"), nao URL.
- O backend `install()` chama `parse_github_url` (skills.rs:491-499), que rejeita rotulos, e cada request do batch falha.
- Alem disso, `skills: [skill.name]` nao e o caminho relativo no repositorio; a proveniencia correta (`relative_path`) estava persistida na tabela `installations`, mas nao era exposta ao frontend.

## Mudancas

- `src-tauri/src/storage.rs`: novo helper `installation_provenance(path) -> Option<(repository_url, relative_path)>` consultando a tabela `installations` existente (sem mudanca de schema/migrations).
- `src-tauri/src/models.rs`: `DetectedSkill` ganhou campo `source_relative_path` (serializado camelCase).
- `src-tauri/src/skills.rs` (`discover`): `source` passa a ser a `repository_url` persistida quando ha proveniencia; rotulos ficam apenas para skills sem proveniencia; `source_relative_path` vem da proveniencia.
- `src/App.tsx`: helper `isGithubUrl`; `batchInstall` valida todas as skills selecionadas antes de chamar `batch_install_github` (erro claro no frontend, sem chamada ao backend, sem instalacao parcial) e envia `url: skill.source` + `skills: [skill.sourceRelativePath]`.

## Testes / validacoes

- `cargo test --manifest-path src-tauri/Cargo.toml` -> PASS (inclui novo `test_installation_provenance_roundtrip` em `tests/storage_tests.rs`).
- `pnpm check` (`tsc --noEmit && vite build`) -> PASS.
- `pnpm format:check`, `cargo fmt --check`, `cargo clippy -D warnings` -> registrados abaixo com falhas preexistentes; nenhuma reformatacao fora de escopo foi aplicada.

## Limitacoes / observacoes para integracao

- HEAD atual (1ab1aa6) ja nao passa `cargo fmt --check`, `cargo clippy -D warnings` nem `pnpm format:check` com as toolchains locais atuais (rustfmt, rustc/clippy, prettier): lints/reformatacoes novos sobre codigo preexistente. Nao foi corrigido por estar fora do escopo (evitar reformatacao massiva). Se o CI `stable` atual falhar por isso, recomenda-se tarefa separada de alinhamento de formatacao/lint.
- Batch install de skill na raiz do repositorio envia `skills: [""]` (caminho relativo vazio e valido para SKILL.md na raiz; `download.root.join("")` resolve para a raiz).
- Projeto nao possui testes de frontend (padrao atual); escopo pediu apenas teste Rust no seam de storage, atendido.

## Commits

- Commit local unico na branch `ai/executor/fix-batch-install-source-local` (sem push, sem merge em dev/main).
