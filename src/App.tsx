import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  Command,
  Copy,
  Database,
  Download,
  FileCode2,
  Folder,
  FolderOpen,
  HeartPulse,
  Home,
  Info,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { WorkspacePanel } from './components/workspace/WorkspacePanel';
import { SessionList } from './components/workspace/SessionList';

type Agent = {
  id: string;
  displayName: string;
  status: string;
  version?: string;
  executable?: string;
  configPaths: string[];
  skillPaths: string[];
  capabilities: string[];
};
type Skill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
  agents: string[];
  managed: boolean;
  modified: boolean;
  risk: string;
  riskReasons: string[];
  files: string[];
  markdown: string;
  contentHash: string;
};
type ActivityItem = { id: number; kind: string; message: string; createdAt: string };
type Workspace = { id: number; path: string; createdAt: string };
type Source = { id: number; url: string; createdAt: string };
type Dashboard = {
  agents: Agent[];
  skills: Skill[];
  activities: ActivityItem[];
  workspaces: Workspace[];
  sources: Source[];
  firstRun: boolean;
  dataPath: string;
};
type GithubSkill = {
  relativePath: string;
  name: string;
  description: string;
  risk: string;
  riskReasons: string[];
};
type Inspection = {
  repository: string;
  repositoryUrl: string;
  trackedRef: string;
  commit: string;
  skills: GithubSkill[];
};
type Update = {
  name: string;
  repositoryUrl: string;
  installedCommit: string;
  availableCommit?: string;
  status: string;
};
type View = 'home' | 'agents' | 'skills' | 'sources' | 'workspaces' | 'activity' | 'settings' | 'workspace' | 'history';

const empty: Dashboard = {
  agents: [],
  skills: [],
  activities: [],
  workspaces: [],
  sources: [],
  firstRun: true,
  dataPath: 'Runtime desktop necessário',
};
const nav = [
  ['home', Home, 'Início'],
  ['agents', Bot, 'Agentes'],
  ['skills', FileCode2, 'Skills'],
  ['sources', Database, 'Fontes'],
  ['workspaces', Folder, 'Projetos'],
  ['activity', Activity, 'Atividade'],
  ['workspace', Bot, 'Workspace'],
  ['history', Activity, 'History'],
] as const;

const portuguese: Record<string, string> = {
  Confirmed: 'Confirmado',
  'Configuration only': 'Somente configuração',
  'Not installed': 'Não instalado',
  Likely: 'Provável',
  'Up to date': 'Atualizada',
  'Update available': 'Atualização disponível',
  'Local changes': 'Alterações locais',
  'Source unavailable': 'Fonte indisponível',
  'Low risk': 'Baixo risco',
  'Review recommended': 'Revisão recomendada',
  'Elevated risk': 'Risco elevado',
  'Axis Vault': 'Cofre do Axis',
  'Source unknown': 'Fonte desconhecida',
  'Managed by Axis': 'Gerenciada pelo Axis',
  Unmanaged: 'Não gerenciada',
  'Not found': 'Não encontrado',
  Unavailable: 'Indisponível',
};
function t(value: string) {
  return portuguese[value] ?? value;
}

function shortSha(value?: string) {
  return value ? value.slice(0, 7) : '—';
}
function relativeDate(value: string) {
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isNaN(d.valueOf())
    ? value
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
function statusTone(status: string) {
  return status === 'Confirmed' || status === 'Up to date' || status === 'Low risk'
    ? 'good'
    : status.includes('available') || status.includes('Review') || status.includes('Likely')
      ? 'warn'
      : status.includes('Not') || status.includes('unavailable') || status.includes('Elevated')
        ? 'bad'
        : 'neutral';
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`badge ${tone}`}>{typeof children === 'string' ? t(children) : children}</span>
  );
}
function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Info;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Button({
  children,
  kind = 'secondary',
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button className={`button ${kind}`} {...props} disabled={busy || props.disabled}>
      {busy ? <LoaderCircle className="spin" size={16} /> : null}
      {children}
    </button>
  );
}

function InstallDialog({
  open,
  onClose,
  onDone,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (d: Dashboard) => void;
  notify: (s: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<Inspection>();
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>(['codex']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  const inspect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await invoke<Inspection>('inspect_github', { url });
      setInspection(result);
      setSelected(result.skills.map((s) => s.relativePath));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await invoke<Dashboard>('install_github', {
        request: { url, skills: selected, agents: targets },
      });
      onDone(result);
      notify('Skills instaladas e verificadas');
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby="install-title">
      <div className="dialog-head">
        <div>
          <h2 id="install-title">Instalar skill</h2>
          <p>Apenas repositórios públicos do GitHub. O Axis nunca executa scripts de skills.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
      </div>
      {!inspection ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            inspect();
          }}
          className="dialog-body"
        >
          <label>
            Repositório ou URL de skill no GitHub
            <input
              autoFocus
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="owner/repository ou github.com/…"
            />
          </label>
          <div className="security-note">
            <ShieldCheck />
            <span>
              Baixada para staging, validada contra paths inseguros e analisada estaticamente antes
              da instalação.
            </span>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button kind="primary" type="submit" busy={busy}>
              <Search size={16} /> Inspecionar repositório
            </Button>
          </div>
        </form>
      ) : (
        <div className="dialog-body">
          <div className="repo-line">
            <div>
              <strong>{inspection.repository}</strong>
              <span>
                {inspection.trackedRef} · {shortSha(inspection.commit)}
              </span>
            </div>
            <Badge tone="good">{inspection.skills.length} encontradas</Badge>
          </div>
          <fieldset>
            <legend>Escolha as skills</legend>
            <div className="check-list">
              {inspection.skills.map((skill) => (
                <label className="check-row" key={skill.relativePath}>
                  <input
                    type="checkbox"
                    checked={selected.includes(skill.relativePath)}
                    onChange={() =>
                      setSelected((v) =>
                        v.includes(skill.relativePath)
                          ? v.filter((x) => x !== skill.relativePath)
                          : [...v, skill.relativePath],
                      )
                    }
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description}</small>
                  </span>
                  <Badge tone={statusTone(skill.risk)}>{skill.risk}</Badge>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Instalar para</legend>
            <div className="target-grid">
              {[
                ['codex', 'Codex'],
                ['claude', 'Claude Code'],
                ['opencode', 'OpenCode'],
                ['antigravity', 'Antigravity'],
              ].map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={targets.includes(id)}
                    onChange={() =>
                      setTargets((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={() => setInspection(undefined)}>Voltar</Button>
            <Button
              kind="primary"
              busy={busy}
              disabled={!selected.length || !targets.length}
              onClick={install}
            >
              <Download size={16} /> Instalar selecionadas
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

function App() {
  const [data, setData] = useState<Dashboard>();
  const [view, setView] = useState<View>('home');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [installOpen, setInstallOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [agent, setAgent] = useState<Agent>();
  const [skill, setSkill] = useState<Skill>();
  const [updates, setUpdates] = useState<Update[]>([]);
  const [filter, setFilter] = useState('Todos');
  const [query, setQuery] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await invoke<Dashboard>('get_dashboard'));
    } catch (e) {
      setData(empty);
      if ('__TAURI_INTERNALS__' in window)
        setError(`Axis desktop backend unavailable: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = 'pt-BR';
    load();
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === 'Escape') setPalette(false);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const rescan = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await invoke<Dashboard>('rescan'));
      notify('Varredura concluída');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const go = (next: View) => {
    setView(next);
    setAgent(undefined);
    setSkill(undefined);
    setSidebar(false);
  };
  const dashboard = data ?? empty;
  const detected = dashboard.agents.filter((a) => a.status !== 'Not installed').length;
  const available = updates.filter((u) => u.status === 'Update available').length;
  const visibleSkills = useMemo(
    () =>
      dashboard.skills.filter(
        (s) =>
          (!query || `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())) &&
          (filter === 'Todos' ||
            (filter === 'Gerenciadas' && s.managed) ||
            (filter === 'Não gerenciadas' && !s.managed) ||
            (filter === 'Modificadas' && s.modified) ||
            (filter === 'Risco' && s.risk !== 'Low risk') ||
            s.agents.some((a) => a.toLowerCase().includes(filter.toLowerCase()))),
      ),
    [dashboard.skills, filter, query],
  );
  const checkUpdates = async () => {
    setBusy(true);
    try {
      const result = await invoke<Update[]>('check_updates');
      setUpdates(result);
      notify('Verificação de atualizações concluída');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    notify('Caminho copiado');
  };
  const openPath = (path: string) =>
    invoke('open_managed_folder', { path }).catch((e) => setError(String(e)));
  const addWorkspace = async () => {
    const path = await invoke<string | undefined>('choose_workspace');
    if (path) setData(await invoke<Dashboard>('add_workspace', { path }));
  };
  const removeWorkspace = async (id: number) =>
    setData(await invoke<Dashboard>('remove_workspace', { id }));
  const addSource = async () => {
    const url = prompt('URL do repositório público no GitHub');
    if (url)
      try {
        setData(await invoke<Dashboard>('add_source', { url }));
        notify('Fonte adicionada');
      } catch (e) {
        setError(String(e));
      }
  };
  const removeSource = async (id: number) =>
    setData(await invoke<Dashboard>('remove_source', { id }));

  const batchInstall = async () => {
    setBusy(true);
    setError('');
    try {
      const requests = selectedSkills.map((id) => {
        const skill = dashboard.skills.find((s) => s.id === id);
        return { url: skill?.source || '', skills: [skill?.name || ''], agents: ['codex', 'claude', 'opencode'] };
      });
      await invoke<Dashboard>('batch_install_github', { requests });
      setSelectedSkills([]);
      notify('Batch install completed');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const content = () => {
    if (loading)
      return (
        <div className="skeleton-page" aria-label="Carregando">
          <div />
          <div />
          <div />
        </div>
      );
    if (view === 'home')
      return (
        <>
          <section className="command-deck">
            <div className="command-deck-copy">
              <span className="eyebrow">
                <span className="live-pulse" /> Central local
              </span>
              <h2>
                Seu ambiente de IA,
                <br />
                sob controle.
              </h2>
              <p>
                Descubra agentes, acompanhe skills e mantenha tudo organizado sem enviar seus dados
                para a nuvem.
              </p>
              <div className="deck-actions">
                <Button kind="primary" busy={busy} onClick={rescan}>
                  <Search size={17} /> Executar análise
                </Button>
                <Button onClick={() => setInstallOpen(true)}>
                  <Plus size={17} /> Adicionar skill
                </Button>
              </div>
            </div>
            <div className="command-deck-status" aria-label="Estado do ambiente">
              <span className="status-orbit">
                <ShieldCheck size={25} />
              </span>
              <strong>Ambiente protegido</strong>
              <small>Skills não são executadas durante a análise.</small>
              <div>
                <span>LOCAL</span>
                <span>PRIVADO</span>
                <span>PRONTO</span>
              </div>
            </div>
          </section>
          <div className="stat-strip">
            <div>
              <Bot />
              <span>
                Agentes<strong>{detected}</strong>
                <small>{detected ? 'detectados' : 'nenhum detectado'}</small>
              </span>
            </div>
            <div>
              <FileCode2 />
              <span>
                Skills<strong>{dashboard.skills.length}</strong>
                <small>skills únicas</small>
              </span>
            </div>
            <div>
              <Download />
              <span>
                Atualizações<strong>{updates.length ? available : '—'}</strong>
                <small>{updates.length ? 'disponíveis' : 'não verificadas'}</small>
              </span>
            </div>
            <div>
              <HeartPulse />
              <span>
                Saúde
                <strong>{dashboard.skills.filter((s) => s.risk === 'Elevated risk').length}</strong>
                <small>riscos elevados</small>
              </span>
            </div>
          </div>
          {dashboard.firstRun && (
            <section className="welcome">
              <div className="welcome-mark">
                <Sparkles />
              </div>
              <div>
                <h2>Boas-vindas ao Axis</h2>
                <p>
                  Analise suas ferramentas de IA, skills e configuração local. Não é necessária uma
                  conta.
                </p>
              </div>
              <Button kind="primary" busy={busy} onClick={rescan}>
                <Search size={17} /> Analisar ferramentas de IA
              </Button>
            </section>
          )}
          <div className="home-grid">
            <section className="panel span-two">
              <header>
                <h2>Agentes detectados</h2>
                <button onClick={() => go('agents')}>
                  Ver todos <ChevronRight />
                </button>
              </header>
              {dashboard.agents.map((a) => (
                <button
                  className="agent-row"
                  key={a.id}
                  onClick={() => {
                    setAgent(a);
                    setView('agents');
                  }}
                >
                  <span className="agent-icon">
                    <Bot />
                  </span>
                  <span>
                    <strong>{a.displayName}</strong>
                    <small>{a.version || 'Versão indisponível'}</small>
                  </span>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  <ChevronRight />
                </button>
              ))}
            </section>
            <section className="panel">
              <header>
                <h2>Atualizações recentes</h2>
                <button onClick={checkUpdates}>Verificar</button>
              </header>
              {updates.length ? (
                updates.slice(0, 5).map((u) => (
                  <div className="plain-row" key={u.name}>
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        {shortSha(u.installedCommit)} → {shortSha(u.availableCommit)}
                      </small>
                    </span>
                    <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={Download}
                  title="Atualizações não verificadas"
                  body="Verifique novos commits nas fontes gerenciadas."
                  action={
                    <Button onClick={checkUpdates} busy={busy}>
                      Verificar atualizações
                    </Button>
                  }
                />
              )}
            </section>
            <section className="panel">
              <header>
                <h2>Atividade recente</h2>
                <button onClick={() => go('activity')}>Ver todos</button>
              </header>
              {dashboard.activities.length ? (
                dashboard.activities.slice(0, 5).map((a) => (
                  <div className="activity-row" key={a.id}>
                    <span className="dot" />
                    <div>
                      <strong>{a.message}</strong>
                      <small>{relativeDate(a.createdAt)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={Activity}
                  title="Ainda não há atividade"
                  body="Análises e operações de skills aparecerão aqui."
                />
              )}
            </section>
          </div>
        </>
      );
    if (view === 'agents')
      return agent ? (
        <Detail
          title={agent.displayName}
          subtitle={t(agent.status)}
          onBack={() => setAgent(undefined)}
          actions={
            <Button busy={busy} onClick={rescan}>
              <RefreshCw size={16} /> Analisar novamente
            </Button>
          }
        >
          <div className="detail-grid">
            <section className="panel">
              <h2>Visão geral</h2>
              <Key label="Status" value={agent.status} />
              <Key label="Versão" value={agent.version || 'Unavailable'} />
              <Key label="Executável" value={agent.executable || 'Not found'} />
            </section>
            <section className="panel">
              <h2>Recursos</h2>
              <div className="tag-list">
                {agent.capabilities.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </div>
            </section>
          </div>
          <section className="panel">
            <h2>Configuração e caminhos de skills</h2>
            {[...agent.configPaths, ...agent.skillPaths].map((path) => (
              <div className="path-row" key={path}>
                <code>{path}</code>
                <button onClick={() => copy(path)} aria-label="Copiar caminho">
                  <Copy />
                </button>
                <button onClick={() => openPath(path)} aria-label="Abrir pasta">
                  <FolderOpen />
                </button>
              </div>
            ))}
          </section>
        </Detail>
      ) : (
        <>
          <SectionTitle
            title="Agentes"
            body="Detectados por executáveis, configuração e caminhos de skills."
          />
          <div className="agent-grid">
            {dashboard.agents.map((a) => (
              <button className="agent-card" key={a.id} onClick={() => setAgent(a)}>
                <span className="agent-icon large">
                  <Bot />
                </span>
                <span>
                  <strong>{a.displayName}</strong>
                  <small>{a.version || 'Versão do executável indisponível'}</small>
                </span>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                <ChevronRight />
              </button>
            ))}
          </div>
        </>
      );
    if (view === 'skills')
      return skill ? (
        <Detail
          title={skill.name}
          subtitle={skill.description}
          onBack={() => setSkill(undefined)}
          actions={
            <>
              <Button onClick={() => copy(skill.path)}>
                <Copy size={16} /> Copiar caminho
              </Button>
              <Button onClick={() => openPath(skill.path)}>
                <FolderOpen size={16} /> Abrir pasta
              </Button>
            </>
          }
        >
          <div className="detail-grid">
            <section className="panel">
              <h2>Visão geral</h2>
              <Key label="Fonte" value={skill.source} />
              <Key label="Agentes" value={skill.agents.join(', ')} />
              <Key
                label="Estado"
                value={
                  skill.managed
                    ? skill.modified
                      ? 'Local changes'
                      : 'Managed by Axis'
                    : 'Unmanaged'
                }
              />
              <Key label="Hash do conteúdo" value={skill.contentHash.slice(0, 16)} />
            </section>
            <section className="panel">
              <h2>Segurança</h2>
              <Badge tone={statusTone(skill.risk)}>{skill.risk}</Badge>
              {skill.riskReasons.length ? (
                <ul>
                  {skill.riskReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  Nenhum sinal heurístico encontrado. Isso não é garantia de segurança.
                </p>
              )}
            </section>
          </div>
          <section className="panel skill-content">
            <div>
              <h2>Arquivos</h2>
              <div className="file-tree">
                {skill.files.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </div>
            </div>
            <div>
              <h2>SKILL.md</h2>
              <article className="markdown">
                <ReactMarkdown>{skill.markdown}</ReactMarkdown>
              </article>
            </div>
          </section>
        </Detail>
      ) : (
        <>
          <SectionTitle
            title="Skills"
            body="Um inventário para todos os agentes compatíveis."
            actions={
              <Button kind="primary" onClick={() => setInstallOpen(true)}>
                <Plus size={16} /> Instalar skill
              </Button>
            }
          />
          <div className="toolbar">
            <div className="search">
              <Search />
              <input
                aria-label="Buscar skills"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar skills"
              />
            </div>
            <div className="filters">
              {[
                'Todos',
                'Gerenciadas',
                'Não gerenciadas',
                'Modificadas',
                'Risco',
                'Codex',
                'Claude',
                'OpenCode',
                'Antigravity',
              ].map((x) => (
                <button
                  className={filter === x ? 'active' : ''}
                  key={x}
                  onClick={() => setFilter(x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          {visibleSkills.length ? (
            <>
              {selectedSkills.length > 0 && (
                <div className="batch-actions">
                  <span>{selectedSkills.length} selected</span>
                  <Button kind="primary" onClick={batchInstall}>Install to all agents</Button>
                </div>
              )}
              <div className="skill-list">
                {visibleSkills.map((s) => (
                  <button key={s.id} onClick={() => setSkill(s)}>
                    <input
                      type="checkbox"
                      className="skill-checkbox"
                      checked={selectedSkills.includes(s.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.checked) {
                          setSelectedSkills((v) => [...v, s.id]);
                        } else {
                          setSelectedSkills((v) => v.filter((x) => x !== s.id));
                        }
                      }}
                    />
                    <span className="skill-logo">
                      <FileCode2 />
                    </span>
                    <span className="skill-copy">
                      <strong>{s.name}</strong>
                      <small>{s.description}</small>
                      <em>{s.agents.join(' · ') || 'Nenhum agente'}</em>
                    </span>
                    <Badge tone={s.managed ? 'good' : 'neutral'}>
                      {s.managed ? 'Gerenciada' : 'Unmanaged'}
                    </Badge>
                    {s.modified && <Badge tone="warn">Modificada</Badge>}
                    <Badge tone={statusTone(s.risk)}>{s.risk}</Badge>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={FileCode2}
              title="Nenhuma skill encontrada"
              body="Adicione uma fonte, instale do GitHub ou analise novamente as pastas dos agentes."
              action={
                <Button kind="primary" onClick={() => setInstallOpen(true)}>
                  Instalar skill
                </Button>
              }
            />
          )}
        </>
      );
    if (view === 'sources')
      return (
        <>
          <SectionTitle
            title="Fontes"
            body="Catálogos locais baseados em repositórios públicos do GitHub."
            actions={
              <Button kind="primary" onClick={addSource}>
                <Plus size={16} /> Adicionar fonte
              </Button>
            }
          />
          {dashboard.sources.length ? (
            <div className="list-panel">
              {dashboard.sources.map((s) => (
                <div className="source-row" key={s.id}>
                  <Database />
                  <span>
                    <strong>{s.url}</strong>
                    <small>Adicionada em {relativeDate(s.createdAt)}</small>
                  </span>
                  <Button
                    onClick={() => {
                      setInstallOpen(true);
                    }}
                  >
                    Navegar e instalar
                  </Button>
                  <button
                    className="icon-button danger"
                    onClick={() => removeSource(s.id)}
                    aria-label="Remover fonte"
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Database}
              title="Ainda não há fontes"
              body="Adicione um repositório do GitHub para navegar pelas suas skills."
              action={
                <Button kind="primary" onClick={addSource}>
                  Adicionar fonte
                </Button>
              }
            />
          )}
        </>
      );
    if (view === 'workspaces')
      return (
        <>
          <SectionTitle
            title="Projetos"
            body="Apenas as pastas que você escolher são analisadas em busca de skills de projeto."
            actions={
              <Button kind="primary" onClick={addWorkspace}>
                <FolderOpen size={16} /> Adicionar projeto
              </Button>
            }
          />
          {dashboard.workspaces.length ? (
            <div className="list-panel">
              {dashboard.workspaces.map((w) => (
                <div className="source-row" key={w.id}>
                  <Folder />
                  <span>
                    <strong>{w.path}</strong>
                    <small>Adicionado em {relativeDate(w.createdAt)}</small>
                  </span>
                  <Button onClick={() => openPath(w.path)}>Abrir</Button>
                  <button
                    className="icon-button danger"
                    onClick={() => removeWorkspace(w.id)}
                    aria-label="Remover projeto"
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Folder}
              title="Ainda não há projetos"
              body="O Axis nunca analisa o disco inteiro. Adicione projetos explicitamente."
              action={
                <Button kind="primary" onClick={addWorkspace}>
                  Escolher pasta
                </Button>
              }
            />
          )}
        </>
      );
    if (view === 'activity')
      return (
        <>
          <SectionTitle
            title="Atividade"
            body="Histórico local de análises e operações de skills."
          />
          <section className="panel activity-list">
            {dashboard.activities.length ? (
              dashboard.activities.map((a) => (
                <div className="activity-row" key={a.id}>
                  <span className={`event-icon ${a.kind}`}>
                    <Activity />
                  </span>
                  <div>
                    <strong>{a.message}</strong>
                    <small>
                      {a.kind} · {relativeDate(a.createdAt)}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon={Activity}
                title="Ainda não há atividade"
                body="O histórico local de operações aparecerá aqui."
              />
            )}
          </section>
        </>
      );
    if (view === 'workspace')
      return (
        <>
          {dashboard.workspaces.length === 0 ? (
            <EmptyState
              icon={Folder}
              title="Add a project first"
              body="Add a workspace folder to start chatting with AI."
              action={
                <Button kind="primary" onClick={addWorkspace}>
                  <FolderOpen size={16} /> Add project
                </Button>
              }
            />
          ) : (
            <div className="panel-fill"><WorkspacePanel workspaceId={dashboard.workspaces[0].id} /></div>
          )}
        </>
      );
    if (view === 'history')
      return (
        <>
          {dashboard.workspaces.length === 0 ? (
            <EmptyState
              icon={Folder}
              title="Add a project first"
              body="Add a workspace to see session history."
              action={
                <Button kind="primary" onClick={addWorkspace}>
                  <FolderOpen size={16} /> Add project
                </Button>
              }
            />
          ) : (
            <div className="panel-fill">
              <SectionTitle title="Session History" body="Past chat sessions in this workspace." />
              <SessionList
                workspaceId={dashboard.workspaces[0].id}
                onSelectSession={(_id) => {
                  setView('workspace');
                }}
              />
            </div>
          )}
        </>
      );
    return (
      <>
        <SectionTitle
          title="Configurações"
          body="O Axis permanece local e usa as preferências do seu sistema."
        />
        <div className="settings-grid">
          <section className="panel">
            <h2>Aparência</h2>
            <label htmlFor="theme">Tema</label>
            <select
              id="theme"
              defaultValue={localStorage.getItem('axis-theme') || 'system'}
              onChange={(e) => {
                localStorage.setItem('axis-theme', e.target.value);
                document.documentElement.dataset.theme = e.target.value;
              }}
            >
              <option value="system">Sistema</option>
              <option value="dark">Escuro</option>
              <option value="light">Claro</option>
            </select>
            <label htmlFor="language">Idioma</label>
            <select id="language" value="pt-BR" disabled>
              <option value="pt-BR">Português (Brasil)</option>
            </select>
          </section>
          <section className="panel">
            <h2>Armazenamento</h2>
            <div className="path-row">
              <code>{dashboard.dataPath}</code>
              <button onClick={() => copy(dashboard.dataPath)} aria-label="Copiar caminho">
                <Copy />
              </button>
              <button onClick={() => openPath(dashboard.dataPath)} aria-label="Abrir pasta">
                <FolderOpen />
              </button>
            </div>
            <p className="muted">Cofre, staging, backups, cache e o banco SQLite ficam aqui.</p>
          </section>
          <section className="panel danger-zone">
            <h2>Avançado</h2>
            <Button busy={busy} onClick={rescan}>
              <RefreshCw size={16} /> Analisar tudo novamente
            </Button>
            <p className="muted">
              Atualizações automáticas ficam desativadas. O Axis nunca sobrescreve alterações locais
              sem backup.
            </p>
          </section>
        </div>
      </>
    );
  };

  const paletteActions = [
    { label: 'Instalar skill', icon: Download, run: () => setInstallOpen(true) },
    { label: 'Verificar atualizações', icon: RefreshCw, run: checkUpdates },
    { label: 'Analisar agentes novamente', icon: Bot, run: rescan },
    ...nav.map(([id, Icon, label]) => ({
      label: `Ir para ${label}`,
      icon: Icon,
      run: () => go(id),
    })),
    { label: 'Abrir configurações', icon: Settings, run: () => go('settings') },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
      <aside className={sidebar ? 'open' : ''}>
        <div className="brand">
          <img src="/axis-icon.png" alt="" />
          <span>AXIS</span>
          <button
            className="icon-button mobile-close"
            onClick={() => setSidebar(false)}
            aria-label="Fechar navegação"
          >
            <X />
          </button>
        </div>
        <nav aria-label="Navegação principal">
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              onClick={() => go(id)}
              className={view === id ? 'active' : ''}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {id === 'skills' && dashboard.skills.length > 0 ? (
                <em>{dashboard.skills.length}</em>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          className={`settings-nav ${view === 'settings' ? 'active' : ''}`}
          onClick={() => go('settings')}
        >
          <Settings />
          <span>Configurações</span>
        </button>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button menu"
            onClick={() => setSidebar(true)}
            aria-label="Abrir navegação"
          >
            <Menu />
          </button>
          <div>
            <h1>
              {agent?.displayName || skill?.name || nav.find((n) => n[0] === view)?.[2] || 'Axis'}
            </h1>
            <p>
              {view === 'home'
                ? 'Central de controle local para agentes de programação com IA'
                : ''}
            </p>
          </div>
          <button className="command-hint" onClick={() => setPalette(true)}>
            <Command /> <kbd>Ctrl K</kbd>
            <span>Paleta de comandos</span>
          </button>
          <Button busy={busy} onClick={rescan}>
            <RefreshCw size={16} /> Analisar novamente
          </Button>
        </header>
        <main id="main">
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle />
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Fechar erro">
                <X />
              </button>
            </div>
          )}
          {content()}
        </main>
        <footer>
          <span>
            <span className="ready-dot" />
            Pronto
          </span>
          <span>{dashboard.skills.length} skills indexadas · Somente local</span>
        </footer>
      </div>
      <InstallDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onDone={setData}
        notify={notify}
      />
      {palette && (
        <div className="palette-backdrop" onMouseDown={() => setPalette(false)}>
          <div
            className="palette"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Paleta de comandos"
          >
            <div>
              <Search />
              <input autoFocus placeholder="Digite um comando…" aria-label="Buscar comando" />
            </div>
            {paletteActions.map(({ label, icon: Icon, run }) => (
              <button
                key={label}
                onClick={() => {
                  setPalette(false);
                  run();
                }}
              >
                <Icon />
                <span>{label}</span>
                <kbd>↵</kbd>
              </button>
            ))}
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check />
          {toast}
        </div>
      )}
    </div>
  );
}

function SectionTitle({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {actions}
    </div>
  );
}
function Detail({
  title,
  subtitle,
  onBack,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="detail-head">
        <button onClick={onBack}>← Voltar</button>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div>{actions}</div>
      </div>
      {children}
    </>
  );
}
function Key({ label, value }: { label: string; value: string }) {
  return (
    <div className="key">
      <span>{t(label)}</span>
      <strong>{t(value)}</strong>
    </div>
  );
}

export default App;
