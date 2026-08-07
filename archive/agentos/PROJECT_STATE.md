# Estado do Projeto

## Visão geral e objetivo

AgentOS é um workspace de desenvolvimento desktop multi-IA com continuidade
automática: um aplicativo Electron que centraliza diferentes provedores de
IA (inicialmente só Claude) atrás de um núcleo agnóstico de provedor, com
memória/persistência própria, terminal/arquivos/git como ferramentas, e
failover entre provedores como visão de longo prazo. Esta primeira versão
(v1) é uma fatia funcional e real, não a visão completa: projeto registrado
localmente, chat com streaming, visualizador de diff de arquivos alterados,
persistência de sessão, e um provider (Claude) já funcionando de ponta a
ponta — multi-provider real, roteamento inteligente, RAG/memória vetorial e
coordenação multiagente ficam para versões futuras.

O checkout de desenvolvimento canônico fica em `C:\Projetos\AgentOS`, branch
`main`. Repositório privado no GitHub: `https://github.com/marquezinii/AgentOS`.
O atalho de área de trabalho **AgentOS** é recriado automaticamente pelo
`postbuild` de `npm run build` (`scripts/update-desktop-shortcut.ps1`),
apontando sempre para `apps/desktop/release/win-unpacked/AgentOS.exe` (o app
real já empacotado, nunca o instalador NSIS).

Documento de design completo:
`docs/superpowers/specs/2026-07-28-agentos-v1-design.md`.
Plano de implementação completo, com histórico de todas as revisões e
decisões tomadas durante a implementação:
`docs/superpowers/plans/2026-07-29-agentos-v1.md`.

## Tecnologias

- TypeScript em todo o monorepo (npm workspaces: `apps/desktop`,
  `apps/backend`, `packages/shared`);
- Electron **43.2.0** (pino no `apps/desktop/package.json`, versão exata
  exigida pelo electron-builder) — traz Node ~24.x embutido;
- React 18 + Vite para o renderer;
- Fastify 4 + `@fastify/websocket` para o backend HTTP/WS;
- `@anthropic-ai/claude-agent-sdk` (`^0.3.0`) como único provider real do v1;
- `node:sqlite` (módulo embutido do Node, sem dependência nativa compilada)
  atrás de uma interface `StorageProvider` própria;
- esbuild para empacotar o backend num único arquivo ESM auto-contido
  (`apps/backend/esbuild.config.js`);
- electron-builder `^26.15.7` (target NSIS, Windows) para empacotar o app;
- Vitest para testes unitários/integração, Playwright (`_electron`) para o
  E2E do app real empacotado.

## Arquitetura

Renderer Electron (React, sandboxed) fala HTTP/WebSocket autenticado com um
processo backend Fastify standalone, rodando em `127.0.0.1:<porta
dinâmica>`. Nada acima da camada de Provider Adapter (Session Manager,
Event Bus, Tool Manager) conhece Claude ou `node:sqlite` diretamente — só
depende das interfaces `ProviderAdapter` e `StorageProvider`, ambas em
`packages/shared`.

```text
Electron Renderer (React, sandboxed: nodeIntegration:false,
                    contextIsolation:true, sandbox:true)
        │ preload mínimo e tipado (window.agentos.getConnectionInfo())
        ▼ WS/HTTP → 127.0.0.1:<porta dinâmica>, token de sessão por lançamento
Electron Main (ciclo de vida da janela + supervisor do processo backend:
               spawn via ELECTRON_RUN_AS_NODE=1, health-check via linha
               "ready" no stdout, reinício em crash, rejeita a Promise de
               start() se o processo morrer antes de "ready")
        │
        ▼
Backend Node.js standalone (Fastify)
    ├── Project Manager       (registra projeto, detecta git)
    ├── Session Manager       (provider-agnóstico; resolve projectPath)
    ├── Event Bus             (pub/sub por sessionId)
    ├── Provider Adapters     → ClaudeProviderAdapter (único em v1)
    ├── Auth (token por lançamento)
    └── StorageProvider → SqliteStorageProvider (node:sqlite; migrations,
        WAL, foreign_keys, busy_timeout, backup antes de migration
        destrutiva, sem suporte a transação aninhada)
```

`apps/backend` é empacotado pelo esbuild num único `dist/index.mjs` ESM
(inclui todas as dependências reais — fastify, o SDK, `@agentos/shared` —
mantendo só builtins reais do Node como `node:sqlite`/`node:fs` externos).
Isso é necessário porque o electron-builder copia `apps/backend/dist` como
`extraResources`, fora do `app.asar`, onde a resolução normal de
`node_modules` do Node não alcança. O banner do bundle também define
`__dirname`/`__filename` manualmente (esbuild não faz isso para saída ESM),
já que `migrate.ts` lê os arquivos `.sql` de migração relativos a
`__dirname`.

## Estrutura relevante

```text
apps/desktop/          Electron main + preload + renderer React
apps/backend/           Backend Fastify standalone (empacotado com esbuild)
packages/shared/        Tipos compartilhados: ProviderAdapter, StorageProvider,
                         AgentEvent, DTOs — nada aqui importa node:sqlite ou o SDK
assets/icon/            Ícone oficial (icon.png fonte + icon.ico gerado)
scripts/                update-desktop-shortcut.ps1 (roda no postbuild)
docs/superpowers/specs/ Spec de design do v1
docs/superpowers/plans/ Plano de implementação (com histórico de revisões)
```

## Decisões técnicas e padrões

- **Núcleo agnóstico de provedor**: `SessionManager`, `ProjectManager`, as
  rotas HTTP/WS e o `EventBus` só conhecem `ProviderAdapter`/
  `StorageProvider` (`packages/shared`). `ClaudeProviderAdapter` é a única
  implementação de provider em v1; `SqliteStorageProvider` é a única
  implementação de storage. Trocar de provider ou de motor de
  armazenamento no futuro não deve exigir tocar no núcleo.
- **`better-sqlite3` → `node:sqlite`** (decisão tomada em 29/07/2026, meio
  da implementação): a máquina de desenvolvimento não tem Visual Studio
  Build Tools, então `better-sqlite3` (dependência nativa compilada) não
  instalava. O usuário aprovou explicitamente trocar para `node:sqlite`
  (embutido no Node, zero compilação nativa) atrás de uma interface
  `StorageProvider` própria, para manter o motor de armazenamento
  substituível no futuro (Postgres, outro SQLite, storage remoto).
- **Electron 31 → 43.2.0** (mesma etapa): o backend é lançado via
  `ELECTRON_RUN_AS_NODE=1` usando o próprio binário do Electron como Node,
  para o app nunca depender de um Node instalado pelo usuário. O Electron
  31 traz Node 20.18, que não tem `node:sqlite` (exige Node 22.5+) — o
  backend crashava com `ERR_UNKNOWN_BUILTIN_MODULE` ao subir. O usuário
  aprovou explicitamente atualizar para a versão estável mais recente do
  Electron (43.2.0, traz Node ~24.x) em vez de empacotar um segundo runtime
  Node ou voltar para uma lib nativa compilada.
- **`signExecutable: false`, não `signAndEditExecutable: false`**: o v1
  não assina o `.exe` (sem certificado Authenticode), mas
  `signAndEditExecutable: false` pula TODA a edição de recursos do `.exe`,
  inclusive a gravação do ícone — o próprio electron-builder avisa isso no
  log de build. Usar a chave errada foi a causa real de um bug em que o
  app empacotado mostrava o ícone genérico do Electron em vez do ícone
  oficial do AgentOS.
- **Atalho da área de trabalho aponta explicitamente para
  `win-unpacked\AgentOS.exe`**, nunca por heurística de "arquivo mais
  recente" — o instalador NSIS (`AgentOS Setup *.exe`) é sempre gravado
  *depois* do app já empacotado, então qualquer lógica de "pega o `.exe`
  mais recente" acaba sempre escolhendo o instalador por engano (bug real
  encontrado pelo usuário: o atalho abria o instalador, que reinstalava o
  app e trocava o ícone do atalho para o genérico do Electron).
- **`BackendSupervisor.start()` rejeita se o processo morrer antes da linha
  "ready"** — antes só resolvia em "ready" ou rejeitava em erro de spawn;
  um crash do backend durante a subida deixava a Promise original pendurada
  para sempre, travando a janela com um cursor de carregamento infinito
  sem erro visível. `main.ts` também captura a rejeição de `createWindow()`
  e encerra com log em vez de ficar preso silenciosamente.
- **Todas as escritas multi-statement passam por transação explícita**
  (`StorageProvider.transaction()`), nunca statements sequenciais soltos.
  `transaction()` não é reentrante — chamar de dentro de outra transação já
  aberta lança erro claro em vez de um erro genérico do SQLite.
- **Migrations com backup automático**: antes de aplicar uma migration cuja
  SQL contenha `DROP TABLE`/`ALTER TABLE`/`DELETE FROM` como statement real
  (não `ON DELETE CASCADE` em FK), o runner copia o arquivo do banco para
  `<dbfile>.bak-<versão>`. A migration `001_init.sql` é puramente aditiva,
  então nenhum backup dispara em v1 — mas a checagem já existe de forma
  genérica.
- **Erros de provider seguem o conjunto fechado do spec**: `AUTH_EXPIRED`,
  `RATE_LIMITED`, `QUOTA_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `TOOL_ERROR`,
  `CONTEXT_EXCEEDED`, `CANCELLED`, `UNKNOWN`. `TOOL_ERROR` nunca mata a
  sessão (o turno continua); nenhum retry automático silencioso em v1 —
  erro vira evento `session_error`, visível no chat, com "tentar de novo"
  manual.
- **Sessão é sempre escoada para a pasta do projeto**: `SessionManager`
  resolve `session → project.path` e passa como `cwd` para o SDK do Claude
  (`query({ options: { cwd } })`) — sem isso o agente trabalhava no diretório
  de trabalho do processo backend, não no projeto selecionado pelo usuário.
- **Segurança do Electron mantida constante em todo o histórico**:
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  preload mínimo tipado, nenhuma credencial alcançável do renderer. Backend
  só escuta em `127.0.0.1`, porta dinâmica, token de sessão por
  lançamento obrigatório em HTTP e WS (via query string no WS, já que o
  `WebSocket` do browser não permite headers customizados no handshake — o
  `onRequest` do Fastify tem um bypass estreito, com regex ancorada, só
  para a rota `/ws/sessions/:id`, sem afrouxar auth de nenhuma outra rota).

## Funcionalidades presentes no código atual

- Registro de projetos locais com detecção de branch/remote git
  (`ProjectManager`, `git symbolic-ref --short HEAD` — não
  `rev-parse --abbrev-ref`, que falha num repo recém-criado sem commits).
- Chat com streaming real via WebSocket (`text_delta`, `tool_call_started`,
  `tool_call_finished`, `session_completed`, `session_error` — todos os
  cinco chegam até a UI e são tratados).
- Visualizador de diff de arquivos alterados: `ClaudeProviderAdapter` mapeia
  os eventos reais do SDK (`assistant`/`user` messages com
  `tool_use_result` estruturado — não o formato "tool_use"/"tool_result"
  de nível superior que a implementação original assumia por engano) para
  eventos `file_changed`, usando `gitDiff.patch` ou `structuredPatch`
  quando disponíveis. Cobre ferramentas `Edit`/`Write`;
  `NotebookEdit` e exclusão de arquivo (`changeType: "deleted"`) ainda não
  são emitidos — ver Limitações.
- Persistência de sessão: projetos, sessões, mensagens e alterações de
  arquivo gravados via `SqliteStorageProvider`, com migrations, WAL,
  foreign keys e backup condicional. (Escrita funciona ponta a ponta;
  leitura/restauração de histórico pelo usuário ainda não tem rota/UI —
  ver Limitações.)
- Ícone oficial do AgentOS aplicado no ícone do app, da janela, do
  instalador e do atalho da área de trabalho (fundo transparente
  preservado — o primeiro `.ico` gerado tinha padding branco opaco em vez
  de transparente; corrigido e verificado pixel a pixel).
- Atalho da área de trabalho recriado automaticamente a cada
  `npm run build` (`postbuild`), sempre apontando para o `.exe`
  já empacotado, nunca o instalador.
- Reinício automático do backend em caso de crash, com propagação de erro
  visível se o reinício também falhar (nunca trava silenciosamente).

## Limitações e cuidados conhecidos

- **Sem histórico de sessão navegável pelo usuário**: o backend persiste
  mensagens/sessões, mas não existe rota `GET /sessions/:id/messages` nem
  UI para listar sessões antigas de um projeto — a UI reseta o chat a cada
  seleção de projeto. Diferido conscientemente para v1.1 (revisão final do
  branch, 29/07/2026).
- **`file_changed` não cobre todos os tipos de alteração**: só `Edit` e
  `Write` emitem evento; `NotebookEdit` (formato de célula sem `filePath`)
  não é mapeado, e `changeType: "deleted"` nunca é alcançado (o SDK do
  Claude não expõe exclusão de arquivo dessa forma nas versões atuais).
  Diffs reconstruídos a partir de `structuredPatch` (quando `gitDiff.patch`
  não vem do SDK) omitem os cabeçalhos `--- /+++`, então não são um diff
  unificado estritamente parseável — apenas exibível.
- **App empacotado é assinado com `signExecutable: false`**: sem
  certificado Authenticode. Windows SmartScreen pode avisar em máquinas
  que não sejam a do desenvolvedor.
- **`normalizeError` usa correspondência de substring**, dependente da
  ordem dos `if` — uma mensagem tipo "authentication rate limit" seria
  classificada como `AUTH_EXPIRED` em vez de `RATE_LIMITED`. Aceitável
  para v1, mas frágil.
- **Nenhum failover real entre provedores** — só Claude existe. A
  abstração `ProviderAdapter`/`StorageProvider` existe justamente para que
  isso seja possível depois sem reescrever o núcleo, mas nenhum outro
  provider foi implementado ainda.
- **`apps/backend`'s `@types/node` fica em `^22.5.0`** mesmo com o runtime
  real sendo Electron 43/Node ~24 — inofensivo (só afeta checagem de tipo
  em build, não o runtime), mas vale atualizar numa próxima limpeza.

## Comandos de desenvolvimento e validação

Na raiz do repositório:

```bash
npm install
npm run build --workspace=packages/shared   # necessário antes de rodar testes/dev pela 1a vez
npm run dev --workspace=apps/backend        # roda o backend standalone (tsx src/index.ts)
npm run dev --workspace=apps/desktop        # watch build do main/preload do Electron
npm run test --workspaces --if-present      # suíte completa (shared + backend + desktop)
npm run test:e2e --workspace=apps/desktop   # Playwright, requer sessão Claude Code autenticada
npm run build                               # pipeline completo: shared → backend → desktop
                                             # → electron-builder → postbuild (atalho)
```

`npm run build` gera `apps/desktop/release/win-unpacked/AgentOS.exe` (app
real) e `apps/desktop/release/AgentOS Setup *.exe` (instalador NSIS — não
usado pelo atalho de desenvolvimento). O `postbuild` regenera o atalho da
área de trabalho automaticamente.

## Validação e handoff atual

- **v1 está completo, revisado e mesclado em `main`.** Implementado via
  subagent-driven development (14 tasks, cada uma com implementador +
  revisor + ciclo de fix-e-re-revisão), seguido de uma revisão final de
  todo o branch (36 commits) que encontrou e corrigiu 4 bugs críticos
  invisíveis a revisões por task isolada: crash de migration no bundle
  ESM (`__dirname` indefinido), pasta `~/.agentos` nunca criada num
  usuário novo, visualizador de diff nunca populava (adapter usava
  formato de evento errado do SDK) e sessão nunca escopada para a pasta
  do projeto. Todos corrigidos e reverificados, incluindo um smoke test
  real contra `HOME` limpo (sem estado prévio).
- Depois do merge, mais dois bugs reais foram encontrados pelo próprio
  usuário testando o app de verdade na própria máquina (atalho abrindo o
  instalador em vez do app; ícone virando o genérico do Electron) — ambos
  diagnosticados, corrigidos e verificados com o `.exe` real rodando
  (janela "AgentOS" abriu e ficou estável, sem travar) antes do handoff.
- Suíte completa: **33/33 testes passando** (backend 25, desktop 6,
  shared 2) no `main` mesclado.
- Repositório: `https://github.com/marquezinii/AgentOS` (privado), branch
  `main`, push mais recente confirmado sincronizado com o remoto.
- **Nenhuma conversa real de IA foi exercitada** nesta máquina/etapa — não
  há sessão do Claude Code autenticada configurada para o backend usar
  ainda. Toda a validação de streaming/eventos foi feita com adapters
  falsos injetados nos testes; a única verificação com o SDK real foi
  estrutural (mapeamento de eventos conferido contra os `.d.ts` do SDK).
  **Próximo passo natural**: autenticar o Claude Code nesta máquina e
  validar uma conversa real de ponta a ponta.
- Próximos passos sugeridos (não implementados, registrados para não se
  perderem): rota + UI de histórico de sessão; `file_changed` para
  `NotebookEdit`; segundo provider real para validar a abstração; outros
  itens da visão de longo prazo do spec original (roteamento inteligente,
  failover, memória/RAG, multiagente) permanecem fora do escopo do v1.
