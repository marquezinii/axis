# Regras para IAs

## Princípio de operação

Axis pode ser desenvolvido simultaneamente por pessoas e por múltiplos agentes
de IA. O usuário não deve precisar administrar Git manualmente para o fluxo
normal: ao receber uma tarefa de desenvolvimento, correção, refatoração, UI,
segurança ou equivalente, o agente descobre e executa automaticamente os
passos mecânicos abaixo. Só peça orientação quando houver uma decisão real de
produto, comportamento, segurança, uma credencial/permissão necessária, ou uma
ambiguidade que não possa ser resolvida com segurança pelo estado do projeto.

Código-fonte e Git são a fonte principal da verdade; a documentação (incluindo
`README.md`, `ARCHITECTURE.md`, `SECURITY.md` e este par de arquivos) fornece
contexto e pode estar defasada. Preserve sempre o trabalho já existente, mesmo
que não tenha sido produzido pelo agente atual.

Ao iniciar qualquer tarefa, leia integralmente, nesta ordem:

1. `AI_RULES.md` (este arquivo);
2. `PROJECT_STATE.md`;
3. `git status`, histórico recente relevante, branches e worktrees existentes.

## Branches e isolamento

- `main` contém exclusivamente o estado público/estável já publicado (é
  também a branch protegida por CI, `.github/workflows/ci.yml`) e só é
  alterada durante uma **publicação oficial** (ver seção Publicação).
- `dev/proxima-versao` é a branch oficial de **integração** da próxima
  versão. Agentes de tarefas normais não desenvolvem diretamente nela.
- `ai/<agente>/<tarefa>` é uma branch temporária e exclusiva de uma tarefa,
  criada a partir de `dev/proxima-versao`. Formato: `ai/claude/chat-provider-
codex` ou `ai/codex/fix-vault-hash`. Use a identidade conhecida do agente; se
  não puder ser determinada, use `ai/agent/<tarefa>`. Gere um slug curto; se
  já existir, gere uma variante única sem perguntar.

Para cada nova tarefa normal:

1. identifique a raiz do repositório e leia `AI_RULES.md` e `PROJECT_STATE.md`;
2. verifique `git status`, histórico recente, branches e worktrees;
3. use `dev/proxima-versao` (atualizada com `origin/dev/proxima-versao`) como
   base, criando a branch exclusiva `ai/*`;
4. crie um Git worktree exclusivo em um diretório irmão do repositório
   principal (`git worktree add ../axis-<slug> ai/<agente>/<tarefa>`);
5. faça alterações, testes e commits somente nesse worktree, sem trocar a
   branch do checkout compartilhado.

Se o agente já estiver em um worktree exclusivo da própria tarefa, reutilize-o.
Se um worktree não for tecnicamente possível, preserve o checkout
compartilhado, evite trocar sua branch e informe a limitação antes de
prosseguir por uma alternativa segura.

## Segurança no trabalho concorrente

Assuma sempre que outros agentes podem estar trabalhando simultaneamente.

- Nunca apagar, resetar, descartar, sobrescrever ou sincronizar trabalho de
  outra branch. Nunca usar `git reset --hard` sobre trabalho que possa
  pertencer a outro agente, nem force push.
- Nunca modificar arquivos sem relação com a tarefa por limpeza estética;
  evite reformatações massivas e refatorações oportunistas fora de escopo.
- Limite as mudanças ao escopo solicitado; preserve comportamento existente
  fora dele.
- Resolva conflitos conscientemente durante a integração; nunca os oculte com
  `ours`, `theirs` ou sobrescrita indiscriminada — analise semanticamente e
  preserve os dois objetivos quando forem compatíveis.
- Preserve os limites de segurança descritos em `SECURITY.md` e a separação
  de responsabilidades descrita em `ARCHITECTURE.md`. Em especial:
  - o renderer (`src/`) nunca recebe acesso genérico a filesystem ou execução
    de comandos — toda operação passa por comandos Tauri estreitos
    (`src-tauri/src/lib.rs`);
  - conteúdo de skill (`.ps1`, `.bat`, `.cmd`, `.exe`, `.py`, `.js`, `.sh`,
    hooks) é lido e copiado — **nunca executado** por `skills.rs`;
  - instalação de skills preserva os limites de arquivo/ZIP, checagem de
    traversal e de symlink, e a proteção contra sobrescrita de alterações
    locais não commitadas (hash SHA-256 antes de substituir);
  - `ANTHROPIC_API_KEY` (usada por `providers/claude.rs`) nunca é persistida
    em SQLite, arquivo de configuração ou log — só existe como env var em
    tempo de execução.
- Antes de alterar código ou documentação relacionada, inspecione os arquivos
  e testes afetados. Nunca desfaça uma decisão anterior sem entender por que
  ela existe (ver `PROJECT_STATE.md` § Decisões técnicas).

## Relatório e conclusão da tarefa

`PROJECT_STATE.md` é o estado **oficial** do projeto e não deve ser alterado
por tarefas paralelas — nem mesmo para registrar o próprio progresso ou um
achado de auditoria. Um agente em tarefa isolada que editar
`PROJECT_STATE.md` diretamente cometeu um erro de processo; o agente
integrador não deve levar essa edição adiante (mesmo que o conteúdo seja
válido) — o conteúdo técnico deve ser reincorporado via `.ai/tasks/` e só
chega a `PROJECT_STATE.md` pela mão do integrador.

Durante uma tarefa isolada, crie ou atualize somente
`.ai/tasks/<identificador-da-tarefa>.md` (identificador curto derivado da
tarefa, ex.: `chat-provider-codex.md`). Registre, de forma curta:

- agente, branch, objetivo e status;
- resumo das mudanças e arquivos/áreas principais alterados;
- testes/validações executados e resultados;
- decisões relevantes, bugs ou limitações restantes;
- commits criados e observações importantes para integração.

Uma tarefa concluída termina automaticamente, sem pedido adicional do usuário:

1. revise as mudanças (`git diff`) e confirme que não há arquivos acidentais,
   segredos, `ANTHROPIC_API_KEY`, builds (`dist/`, `src-tauri/target/`),
   caches ou dados locais (`%APPDATA%\Axis\axis.db`) no commit;
2. execute as validações aplicáveis à área tocada (ver seção Validações);
3. corrija os erros introduzidos pela própria tarefa;
4. atualize `.ai/tasks/<tarefa>.md`;
5. crie um único commit Git local, claro e profissional;
6. deixe a branch pronta para integração e informe branch, commit, testes e o
   status **pronto para integração**.

Commits locais são obrigatórios e não exigem autorização remota. Não crie
commits para experimentos ou trabalho incompleto. Não faça merge automático em
`dev/proxima-versao` ao concluir uma tarefa isolada.

### Padrão de mensagens de commit

Este repositório já usa [Conventional Commits](https://www.conventionalcommits.org/)
de forma consistente (`feat:`, `fix:`, `chore:`, `docs:`, `build:` — ver
`git log`). Mantenha o padrão: `tipo(escopo opcional): descrição curta no
imperativo`, por exemplo `feat(providers): adiciona suporte a Codex` ou
`fix(chat): corrige leak de cancel_tokens`.

- Nunca gere mensagens genéricas (`update`, `WIP`, `fix stuff`, `final`).
- Não invente número de versão em commits normais; `version` em
  `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` só muda
  durante uma publicação explicitamente solicitada.
- Sem menção a nomes de agente de IA, prompt ou ferramenta interna no commit.
- Não reescreva commits já publicados em `origin/main` ou
  `origin/dev/proxima-versao`.

## Integração das tarefas

Frases como "integrar trabalhos", "integrar as IAs", "integrar branches",
"integrar tarefas concluídas" ou "preparar a dev com os trabalhos concluídos"
ativam o **modo integrador**. Nesse modo, o agente deve:

1. ler `AI_RULES.md` e `PROJECT_STATE.md`;
2. inspecionar `dev/proxima-versao` (local e `origin/dev/proxima-versao`),
   branches `ai/*` e worktrees existentes;
3. ler os relatórios em `.ai/tasks/`;
4. determinar quais tarefas estão efetivamente concluídas e prontas;
5. determinar ordem segura quando houver dependências entre tarefas;
6. integrar uma branch por vez em `dev/proxima-versao`, analisando conflitos
   semanticamente e preservando mudanças válidas dos dois lados;
7. após integrações relevantes, rodar as validações de `CONTRIBUTING.md`
   (`pnpm format:check`, `pnpm check`, `cargo fmt --check`, `cargo clippy -D
warnings`, `cargo test`) e corrigir incompatibilidades;
8. atualizar `PROJECT_STATE.md` com o estado oficial já integrado;
9. marcar no relatório de cada tarefa integrada que ela foi incorporada;
10. criar o(s) commit(s) de integração necessários.

Quando o usuário pedir para integrar em `origin/dev/proxima-versao` (ou
expressão equivalente), isso também autoriza explicitamente enviar somente
`dev/proxima-versao` ao remoto após os testes, sem afetar `main`.

Se duas tarefas conflitarem conceitualmente, analise os dois objetivos e
preserve ambos sempre que for seguro e coerente.

Após uma tarefa estar comprovadamente integrada e validada, seu worktree pode
ser removido e sua branch local temporária removida se não for mais
necessária (`git worktree remove`, `git branch -d`). Nunca remova trabalho não
integrado nem branch remota sem autorização explícita.

## Operações remotas

Um commit local nunca autoriza por si só push, release ou deploy. Toda
operação remota exige autorização explícita do usuário nesta tarefa, exceto o
push automático descrito abaixo.

### Push automático da branch exclusiva

Ao concluir uma tarefa em `ai/<agente>/<tarefa>`, o agente pode enviar
automaticamente essa branch para `origin` sem autorização explícita adicional,
desde que:

- a branch siga o padrão `ai/<agente>/<tarefa>` e seja exclusiva da tarefa
  atual;
- todos os passos de conclusão (testes, lint, commit, relatório) tenham sido
  executados;
- o push envie somente essa branch, sem alterar refs remotas de outras
  branches;
- em caso de falha (conflito, rejeição, erro de rede), informe o usuário e não
  force o push.

### Push de desenvolvimento

Disparado por "push de desenvolvimento" ou equivalente inequívoco, ou
automaticamente ao concluir uma tarefa na branch exclusiva (ver acima).

- Se o agente estiver em `ai/*`, envie somente essa branch.
- Se estiver no modo integrador em `dev/proxima-versao`, envie somente
  `dev/proxima-versao`.
- Nunca envie ou altere `main`, crie Pull Request, tag ou release nesse fluxo.
- Nunca altere versão ou artefatos de distribuição nesse fluxo.
- Preserve integralmente o histórico: sem squash, sem reescrever commits, sem
  descartar trabalho já commitado sem pedido explícito e inequívoco.

Esse push serve para backup remoto, sincronização entre agentes e
continuidade do desenvolvimento; nunca é publicação.

### Push para `main`

Só ocorre durante uma **publicação oficial** explicitamente solicitada (ver
seção abaixo). Como `main` é protegida por CI e é a branch pública, sempre
rode as validações completas antes.

Nunca use force push em `main` ou `dev/proxima-versao`. Nunca crie tags ou
GitHub Releases sem pedido explícito.

## Publicação / distribuição

Investigado: Axis **não usa GitHub Releases nem CI de build de artefatos**.
Não existem tags Git no repositório. A distribuição atual é local:
`pnpm release:local` roda `tauri build` e depois
`scripts/sync-desktop-shortcut.ps1`, que atualiza o atalho **Axis** na Área de
Trabalho do usuário para apontar ao executável recém-buildado em
`src-tauri/target/release/`. Não há updater, não há assinatura de código, não
há instalador público, não há site, não há GitHub Releases.

Ela é disparada somente por frase como "publicar versão", "lançar versão" ou
"publicar atualização", e sempre parte do estado já integrado e consistente
de `dev/proxima-versao`; branches `ai/*` nunca são publicadas diretamente e
tarefas incompletas não entram na publicação. Ao ser disparada:

1. revisar `dev/proxima-versao`, validar build e testes completos
   (`CONTRIBUTING.md`) e corrigir falhas antes de prosseguir;
2. se o usuário pedir versionamento, sincronizar `package.json`,
   `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` na mesma versão
   SemVer (`MAJOR.MINOR.PATCH`), refletindo o conjunto real de mudanças desde
   a última versão registrada — nunca incremente versão fora deste fluxo;
3. fazer merge de `dev/proxima-versao` para `main`, salvo se ambas já forem
   idênticas;
4. publicar `main`;
5. rodar `pnpm release:local` (ou orientar o usuário a rodar, se o ambiente
   não permitir build Tauri completo) para atualizar o executável e o atalho
   local;
6. sincronizar `dev/proxima-versao` com a `main` publicada para iniciar o
   próximo ciclo.

Não invente checagens de updater, assinatura ou release pública — elas não
existem neste projeto. Não crie essa infraestrutura (workflow de release,
tags, GitHub Releases) a menos que explicitamente solicitado como nova
decisão de produto — isso é mudança arquitetural, não tarefa de rotina.

## Validações

Comandos reais deste projeto (confirmados em `CONTRIBUTING.md` e
`.github/workflows/ci.yml`):

```powershell
pnpm install                # instalar dependências (pnpm, ver pnpm-lock.yaml)
pnpm dev                    # ou: pnpm tauri dev — desenvolvimento com hot reload
pnpm format:check           # Prettier — obrigatório antes de integrar mudanças em src/
pnpm check                  # tsc --noEmit && vite build — obrigatório para mudanças em src/
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

- **Mudança só em `src/` (React/TS)**: rode `pnpm format:check` e
  `pnpm check` no mínimo.
- **Mudança só em `src-tauri/` (Rust)**: rode `cargo fmt --check`, `cargo
clippy -D warnings` e `cargo test` no mínimo.
- **Mudança que toca os dois lados** (ex.: novo comando Tauri + novo hook):
  rode a suíte completa acima.
- **Mudança só em documentação/governança** (`*.md`, `.ai/`): validações de
  código não se aplicam; apenas revise o `git diff`.
- `pnpm release:local` é uma validação/ação **de distribuição**, não de
  tarefa comum — só rode quando a tarefa pedir explicitamente uma build local
  ou uma publicação (ver seção acima). Ele gera um build Rust `release`, que é
  lento e não deve ser disparado a cada tarefa pequena.
- Não existem testes E2E, testes de UI automatizados ou testes de frontend
  neste projeto hoje. Não invente comandos para eles.

## Fluxo de trabalho

```text
main
→ versão pública, protegida por CI

dev/proxima-versao
→ integração oficial da próxima versão

ai/<agente>/<tarefa>
→ trabalho isolado de uma tarefa

Nova tarefa
→ leitura de AI_RULES.md + PROJECT_STATE.md
→ branch ai/* criada a partir de dev/proxima-versao
→ worktree exclusivo criado ou reutilizado
→ implementação e validações da área tocada
→ relatório .ai/tasks/<tarefa>.md
→ commit local
→ push automático da branch exclusiva (sem permissão explícita)
→ pronta para integração

Integração solicitada
→ integrar branches ai/* concluídas em dev/proxima-versao
→ resolver conflitos semanticamente
→ validações completas (CONTRIBUTING.md)
→ atualizar PROJECT_STATE.md
→ commit(s) de integração
→ push de dev/proxima-versao se solicitado

Publicação oficial solicitada explicitamente
→ validações completas em dev/proxima-versao
→ versão (se pedida) + merge dev/proxima-versao → main
→ push de main
→ pnpm release:local (tauri build + atalho da Área de Trabalho)
→ sincronizar dev/proxima-versao com main
→ nenhuma tag, release pública ou updater — não existem neste projeto
```
