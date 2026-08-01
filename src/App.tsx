import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import {
  Activity, AlertTriangle, Bot, Check, ChevronRight, Command, Copy, Database,
  Download, FileCode2, Folder, FolderOpen, HeartPulse, Home, Info,
  LoaderCircle, Menu, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles,
  Trash2, X,
} from "lucide-react";
import "./App.css";

type Agent = { id:string; displayName:string; status:string; version?:string; executable?:string; configPaths:string[]; skillPaths:string[]; capabilities:string[] };
type Skill = { id:string; name:string; description:string; path:string; source:string; agents:string[]; managed:boolean; modified:boolean; risk:string; riskReasons:string[]; files:string[]; markdown:string; contentHash:string };
type ActivityItem = { id:number; kind:string; message:string; createdAt:string };
type Workspace = { id:number; path:string; createdAt:string };
type Source = { id:number; url:string; createdAt:string };
type Dashboard = { agents:Agent[]; skills:Skill[]; activities:ActivityItem[]; workspaces:Workspace[]; sources:Source[]; firstRun:boolean; dataPath:string };
type GithubSkill = { relativePath:string; name:string; description:string; risk:string; riskReasons:string[] };
type Inspection = { repository:string; repositoryUrl:string; trackedRef:string; commit:string; skills:GithubSkill[] };
type Update = { name:string; repositoryUrl:string; installedCommit:string; availableCommit?:string; status:string };
type View = "home"|"agents"|"skills"|"sources"|"workspaces"|"activity"|"settings";

const empty: Dashboard = { agents:[], skills:[], activities:[], workspaces:[], sources:[], firstRun:true, dataPath:"Desktop runtime required" };
const nav = [
  ["home",Home,"Home"],["agents",Bot,"Agents"],["skills",FileCode2,"Skills"],["sources",Database,"Sources"],
  ["workspaces",Folder,"Workspaces"],["activity",Activity,"Activity"],
] as const;

function shortSha(value?:string){ return value ? value.slice(0,7) : "—"; }
function relativeDate(value:string){ const d=new Date(value.endsWith("Z")?value:`${value}Z`); return Number.isNaN(d.valueOf())?value:new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(d); }
function statusTone(status:string){ return status==="Confirmed"||status==="Up to date"||status==="Low risk"?"good":status.includes("available")||status.includes("Review")||status.includes("Likely")?"warn":status.includes("Not")||status.includes("unavailable")||status.includes("Elevated")?"bad":"neutral"; }

function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:string}){ return <span className={`badge ${tone}`}>{children}</span>; }
function EmptyState({icon:Icon,title,body,action}:{icon:typeof Info;title:string;body:string;action?:React.ReactNode}){ return <div className="empty"><Icon size={30}/><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Button({children,kind="secondary",busy=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{kind?:"primary"|"secondary"|"ghost"|"danger";busy?:boolean}){ return <button className={`button ${kind}`} {...props} disabled={busy||props.disabled}>{busy?<LoaderCircle className="spin" size={16}/>:null}{children}</button>; }

function InstallDialog({open,onClose,onDone,notify}:{open:boolean;onClose:()=>void;onDone:(d:Dashboard)=>void;notify:(s:string)=>void}){
  const ref=useRef<HTMLDialogElement>(null); const [url,setUrl]=useState(""); const [inspection,setInspection]=useState<Inspection>();
  const [selected,setSelected]=useState<string[]>([]); const [targets,setTargets]=useState<string[]>(["codex"]); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{ if(open) ref.current?.showModal(); else ref.current?.close(); },[open]);
  const inspect=async()=>{setBusy(true);setError("");try{const result=await invoke<Inspection>("inspect_github",{url});setInspection(result);setSelected(result.skills.map(s=>s.relativePath));}catch(e){setError(String(e))}finally{setBusy(false)}};
  const install=async()=>{setBusy(true);setError("");try{const result=await invoke<Dashboard>("install_github",{request:{url,skills:selected,agents:targets}});onDone(result);notify("Skills installed and verified");onClose();}catch(e){setError(String(e))}finally{setBusy(false)}};
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="install-title">
    <div className="dialog-head"><div><h2 id="install-title">Install Skill</h2><p>Public GitHub repositories only. Axis never executes skill scripts.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X/></button></div>
    {!inspection?<form onSubmit={e=>{e.preventDefault();inspect()}} className="dialog-body"><label>GitHub repository or skill URL<input autoFocus required value={url} onChange={e=>setUrl(e.target.value)} placeholder="owner/repository or github.com/…" /></label><div className="security-note"><ShieldCheck/><span>Downloaded to staging, path-checked and statically inspected before installation.</span></div>{error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button kind="primary" type="submit" busy={busy}><Search size={16}/> Inspect repository</Button></div></form>:
      <div className="dialog-body"><div className="repo-line"><div><strong>{inspection.repository}</strong><span>{inspection.trackedRef} · {shortSha(inspection.commit)}</span></div><Badge tone="good">{inspection.skills.length} found</Badge></div>
        <fieldset><legend>Choose skills</legend><div className="check-list">{inspection.skills.map(skill=><label className="check-row" key={skill.relativePath}><input type="checkbox" checked={selected.includes(skill.relativePath)} onChange={()=>setSelected(v=>v.includes(skill.relativePath)?v.filter(x=>x!==skill.relativePath):[...v,skill.relativePath])}/><span><strong>{skill.name}</strong><small>{skill.description}</small></span><Badge tone={statusTone(skill.risk)}>{skill.risk}</Badge></label>)}</div></fieldset>
        <fieldset><legend>Install for</legend><div className="target-grid">{[["codex","Codex"],["claude","Claude Code"],["opencode","OpenCode"],["antigravity","Antigravity"]].map(([id,name])=><label key={id}><input type="checkbox" checked={targets.includes(id)} onChange={()=>setTargets(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}/>{name}</label>)}</div></fieldset>
        {error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><Button onClick={()=>setInspection(undefined)}>Back</Button><Button kind="primary" busy={busy} disabled={!selected.length||!targets.length} onClick={install}><Download size={16}/> Install selected</Button></div>
      </div>}
  </dialog>;
}

function App(){
  const [data,setData]=useState<Dashboard>(); const [view,setView]=useState<View>("home"); const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const [toast,setToast]=useState(""); const [installOpen,setInstallOpen]=useState(false); const [palette,setPalette]=useState(false); const [sidebar,setSidebar]=useState(false);
  const [agent,setAgent]=useState<Agent>(); const [skill,setSkill]=useState<Skill>(); const [updates,setUpdates]=useState<Update[]>([]); const [filter,setFilter]=useState("All"); const [query,setQuery]=useState("");
  const notify=useCallback((message:string)=>{setToast(message);window.setTimeout(()=>setToast(""),2800)},[]);
  const load=useCallback(async()=>{setLoading(true);setError("");try{setData(await invoke<Dashboard>("get_dashboard"))}catch(e){setData(empty);if("__TAURI_INTERNALS__" in window)setError(`Axis desktop backend unavailable: ${String(e)}`)}finally{setLoading(false)}},[]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setPalette(v=>!v)}if(e.key==="Escape")setPalette(false)};addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey)},[]);
  const rescan=async()=>{setBusy(true);setError("");try{setData(await invoke<Dashboard>("rescan"));notify("Scan complete")}catch(e){setError(String(e))}finally{setBusy(false)}};
  const go=(next:View)=>{setView(next);setAgent(undefined);setSkill(undefined);setSidebar(false)};
  const dashboard=data??empty; const detected=dashboard.agents.filter(a=>a.status!=="Not installed").length; const available=updates.filter(u=>u.status==="Update available").length;
  const visibleSkills=useMemo(()=>dashboard.skills.filter(s=>(!query||`${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()))&&(filter==="All"||(filter==="Managed"&&s.managed)||(filter==="Unmanaged"&&!s.managed)||(filter==="Modified"&&s.modified)||(filter==="Risk"&&s.risk!=="Low risk")||s.agents.some(a=>a.toLowerCase().includes(filter.toLowerCase())))),[dashboard.skills,filter,query]);
  const checkUpdates=async()=>{setBusy(true);try{const result=await invoke<Update[]>("check_updates");setUpdates(result);notify("Update check complete")}catch(e){setError(String(e))}finally{setBusy(false)}};
  const copy=async(value:string)=>{await navigator.clipboard.writeText(value);notify("Path copied")};
  const openPath=(path:string)=>invoke("open_path",{path}).catch(e=>setError(String(e)));
  const addWorkspace=async()=>{const path=await invoke<string|undefined>("choose_workspace");if(path)setData(await invoke<Dashboard>("add_workspace",{path}))};
  const removeWorkspace=async(id:number)=>setData(await invoke<Dashboard>("remove_workspace",{id}));
  const addSource=async()=>{const url=prompt("Public GitHub repository URL");if(url)try{setData(await invoke<Dashboard>("add_source",{url}));notify("Source added")}catch(e){setError(String(e))}};
  const removeSource=async(id:number)=>setData(await invoke<Dashboard>("remove_source",{id}));

  const content=()=>{
    if(loading)return <div className="skeleton-page" aria-label="Loading"><div/><div/><div/></div>;
    if(view==="home")return <>
      <div className="stat-strip">
        <div><Bot/><span>Agents<strong>{detected}</strong><small>{detected?"detected":"none detected"}</small></span></div>
        <div><FileCode2/><span>Skills<strong>{dashboard.skills.length}</strong><small>unique skills</small></span></div>
        <div><Download/><span>Updates<strong>{updates.length?available:"—"}</strong><small>{updates.length?"available":"not checked"}</small></span></div>
        <div><HeartPulse/><span>Health<strong>{dashboard.skills.filter(s=>s.risk==="Elevated risk").length}</strong><small>elevated risks</small></span></div>
      </div>
      {dashboard.firstRun&&<section className="welcome"><div className="welcome-mark"><Sparkles/></div><div><h2>Welcome to Axis</h2><p>Scan your AI tools, skills and local configuration. No account required.</p></div><Button kind="primary" busy={busy} onClick={rescan}><Search size={17}/> Scan your AI tools</Button></section>}
      <div className="home-grid"><section className="panel span-two"><header><h2>Detected Agents</h2><button onClick={()=>go("agents")}>View all <ChevronRight/></button></header>{dashboard.agents.map(a=><button className="agent-row" key={a.id} onClick={()=>{setAgent(a);setView("agents")}}><span className="agent-icon"><Bot/></span><span><strong>{a.displayName}</strong><small>{a.version||"Version unavailable"}</small></span><Badge tone={statusTone(a.status)}>{a.status}</Badge><ChevronRight/></button>)}</section>
        <section className="panel"><header><h2>Recent Updates</h2><button onClick={checkUpdates}>Check</button></header>{updates.length?updates.slice(0,5).map(u=><div className="plain-row" key={u.name}><span><strong>{u.name}</strong><small>{shortSha(u.installedCommit)} → {shortSha(u.availableCommit)}</small></span><Badge tone={statusTone(u.status)}>{u.status}</Badge></div>):<EmptyState icon={Download} title="Updates not checked" body="Check managed sources for new commits." action={<Button onClick={checkUpdates} busy={busy}>Check updates</Button>}/>}</section>
        <section className="panel"><header><h2>Recent Activity</h2><button onClick={()=>go("activity")}>View all</button></header>{dashboard.activities.length?dashboard.activities.slice(0,5).map(a=><div className="activity-row" key={a.id}><span className="dot"/><div><strong>{a.message}</strong><small>{relativeDate(a.createdAt)}</small></div></div>):<EmptyState icon={Activity} title="No activity yet" body="Scans and skill operations will appear here."/>}</section>
      </div></>;
    if(view==="agents")return agent?<Detail title={agent.displayName} subtitle={agent.status} onBack={()=>setAgent(undefined)} actions={<Button busy={busy} onClick={rescan}><RefreshCw size={16}/> Rescan</Button>}>
      <div className="detail-grid"><section className="panel"><h2>Overview</h2><Key label="Status" value={agent.status}/><Key label="Version" value={agent.version||"Unavailable"}/><Key label="Executable" value={agent.executable||"Not found"}/></section><section className="panel"><h2>Capabilities</h2><div className="tag-list">{agent.capabilities.map(c=><Badge key={c}>{c}</Badge>)}</div></section></div>
      <section className="panel"><h2>Configuration & skill paths</h2>{[...agent.configPaths,...agent.skillPaths].map(path=><div className="path-row" key={path}><code>{path}</code><button onClick={()=>copy(path)} aria-label="Copy path"><Copy/></button><button onClick={()=>openPath(path)} aria-label="Open folder"><FolderOpen/></button></div>)}</section>
    </Detail>:<><SectionTitle title="Agents" body="Detected from executables, configuration and skill paths."/><div className="agent-grid">{dashboard.agents.map(a=><button className="agent-card" key={a.id} onClick={()=>setAgent(a)}><span className="agent-icon large"><Bot/></span><span><strong>{a.displayName}</strong><small>{a.version||"No executable version"}</small></span><Badge tone={statusTone(a.status)}>{a.status}</Badge><ChevronRight/></button>)}</div></>;
    if(view==="skills")return skill?<Detail title={skill.name} subtitle={skill.description} onBack={()=>setSkill(undefined)} actions={<><Button onClick={()=>copy(skill.path)}><Copy size={16}/> Copy path</Button><Button onClick={()=>openPath(skill.path)}><FolderOpen size={16}/> Open folder</Button></>}>
      <div className="detail-grid"><section className="panel"><h2>Overview</h2><Key label="Source" value={skill.source}/><Key label="Agents" value={skill.agents.join(", ")}/><Key label="State" value={skill.managed?(skill.modified?"Local changes":"Managed by Axis"):"Unmanaged"}/><Key label="Content hash" value={skill.contentHash.slice(0,16)}/></section><section className="panel"><h2>Security</h2><Badge tone={statusTone(skill.risk)}>{skill.risk}</Badge>{skill.riskReasons.length?<ul>{skill.riskReasons.map(r=><li key={r}>{r}</li>)}</ul>:<p className="muted">No heuristic flags found. This is not a guarantee of safety.</p>}</section></div>
      <section className="panel skill-content"><div><h2>Files</h2><div className="file-tree">{skill.files.map(f=><code key={f}>{f}</code>)}</div></div><div><h2>SKILL.md</h2><article className="markdown"><ReactMarkdown>{skill.markdown}</ReactMarkdown></article></div></section>
    </Detail>:<><SectionTitle title="Skills" body="One inventory across every supported agent." actions={<Button kind="primary" onClick={()=>setInstallOpen(true)}><Plus size={16}/> Install Skill</Button>}/><div className="toolbar"><div className="search"><Search/><input aria-label="Search skills" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search skills"/></div><div className="filters">{["All","Managed","Unmanaged","Modified","Risk","Codex","Claude","OpenCode","Antigravity"].map(x=><button className={filter===x?"active":""} key={x} onClick={()=>setFilter(x)}>{x}</button>)}</div></div>{visibleSkills.length?<div className="skill-list">{visibleSkills.map(s=><button key={s.id} onClick={()=>setSkill(s)}><span className="skill-logo"><FileCode2/></span><span className="skill-copy"><strong>{s.name}</strong><small>{s.description}</small><em>{s.agents.join(" · ")||"No agent"}</em></span><Badge tone={s.managed?"good":"neutral"}>{s.managed?"Managed":"Unmanaged"}</Badge>{s.modified&&<Badge tone="warn">Modified</Badge>}<Badge tone={statusTone(s.risk)}>{s.risk}</Badge><ChevronRight/></button>)}</div>:<EmptyState icon={FileCode2} title="No skills found" body="Add a source, install from GitHub, or rescan your agent folders." action={<Button kind="primary" onClick={()=>setInstallOpen(true)}>Install Skill</Button>}/>}</>;
    if(view==="sources")return <><SectionTitle title="Sources" body="Local catalogs backed by public GitHub repositories." actions={<Button kind="primary" onClick={addSource}><Plus size={16}/> Add source</Button>}/>{dashboard.sources.length?<div className="list-panel">{dashboard.sources.map(s=><div className="source-row" key={s.id}><Database/><span><strong>{s.url}</strong><small>Added {relativeDate(s.createdAt)}</small></span><Button onClick={()=>{setInstallOpen(true)}}>Browse & install</Button><button className="icon-button danger" onClick={()=>removeSource(s.id)} aria-label="Remove source"><Trash2/></button></div>)}</div>:<EmptyState icon={Database} title="No sources yet" body="Add a GitHub repository to browse its skills." action={<Button kind="primary" onClick={addSource}>Add source</Button>}/>}</>;
    if(view==="workspaces")return <><SectionTitle title="Workspaces" body="Only folders you choose are scanned for project skills." actions={<Button kind="primary" onClick={addWorkspace}><FolderOpen size={16}/> Add workspace</Button>}/>{dashboard.workspaces.length?<div className="list-panel">{dashboard.workspaces.map(w=><div className="source-row" key={w.id}><Folder/><span><strong>{w.path}</strong><small>Added {relativeDate(w.createdAt)}</small></span><Button onClick={()=>openPath(w.path)}>Open</Button><button className="icon-button danger" onClick={()=>removeWorkspace(w.id)} aria-label="Remove workspace"><Trash2/></button></div>)}</div>:<EmptyState icon={Folder} title="No workspaces yet" body="Axis never scans your entire disk. Add projects explicitly." action={<Button kind="primary" onClick={addWorkspace}>Choose folder</Button>}/>}</>;
    if(view==="activity")return <><SectionTitle title="Activity" body="Local audit trail for scans and skill operations."/><section className="panel activity-list">{dashboard.activities.length?dashboard.activities.map(a=><div className="activity-row" key={a.id}><span className={`event-icon ${a.kind}`}><Activity/></span><div><strong>{a.message}</strong><small>{a.kind} · {relativeDate(a.createdAt)}</small></div></div>):<EmptyState icon={Activity} title="No activity yet" body="Your local operation history will appear here."/>}</section></>;
    return <><SectionTitle title="Settings" body="Axis stays local and uses your system preferences."/><div className="settings-grid"><section className="panel"><h2>Appearance</h2><label>Theme<select defaultValue={localStorage.getItem("axis-theme")||"system"} onChange={e=>{localStorage.setItem("axis-theme",e.target.value);document.documentElement.dataset.theme=e.target.value}}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label></section><section className="panel"><h2>Storage</h2><div className="path-row"><code>{dashboard.dataPath}</code><button onClick={()=>copy(dashboard.dataPath)}><Copy/></button><button onClick={()=>openPath(dashboard.dataPath)}><FolderOpen/></button></div><p className="muted">Vault, staging, backups, cache and the SQLite database live here.</p></section><section className="panel danger-zone"><h2>Advanced</h2><Button busy={busy} onClick={rescan}><RefreshCw size={16}/> Rescan everything</Button><p className="muted">Automatic updates remain off. Axis will never overwrite local changes without a backup.</p></section></div></>;
  };

  const paletteActions=[{label:"Install skill",icon:Download,run:()=>setInstallOpen(true)},{label:"Check updates",icon:RefreshCw,run:checkUpdates},{label:"Rescan agents",icon:Bot,run:rescan},...nav.map(([id,Icon,label])=>({label:`Go to ${label}`,icon:Icon,run:()=>go(id)})),{label:"Open settings",icon:Settings,run:()=>go("settings")}];
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className={sidebar?"open":""}><div className="brand"><img src="/axis-icon.png" alt=""/><span>AXIS</span><button className="icon-button mobile-close" onClick={()=>setSidebar(false)} aria-label="Close navigation"><X/></button></div><nav aria-label="Main navigation">{nav.map(([id,Icon,label])=><button key={id} onClick={()=>go(id)} className={view===id?"active":""} aria-current={view===id?"page":undefined}><Icon/><span>{label}</span>{id==="skills"&&dashboard.skills.length>0?<em>{dashboard.skills.length}</em>:null}</button>)}</nav><button className={`settings-nav ${view==="settings"?"active":""}`} onClick={()=>go("settings")}><Settings/><span>Settings</span></button></aside>
    <div className="main-wrap"><header className="topbar"><button className="icon-button menu" onClick={()=>setSidebar(true)} aria-label="Open navigation"><Menu/></button><div><h1>{agent?.displayName||skill?.name||nav.find(n=>n[0]===view)?.[2]||"Axis"}</h1><p>{view==="home"?"Local control center for AI coding agents":""}</p></div><button className="command-hint" onClick={()=>setPalette(true)}><Command/> <kbd>Ctrl K</kbd><span>Command palette</span></button><Button busy={busy} onClick={rescan}><RefreshCw size={16}/> Rescan</Button></header>
      <main id="main">{error&&<div className="error-banner" role="alert"><AlertTriangle/><span>{error}</span><button onClick={()=>setError("")}><X/></button></div>}{content()}</main><footer><span><span className="ready-dot"/>Ready</span><span>{dashboard.skills.length} skills indexed · Local only</span></footer>
    </div>
    <InstallDialog open={installOpen} onClose={()=>setInstallOpen(false)} onDone={setData} notify={notify}/>
    {palette&&<div className="palette-backdrop" onMouseDown={()=>setPalette(false)}><div className="palette" onMouseDown={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette"><div><Search/><input autoFocus placeholder="Type a command…" aria-label="Command search"/></div>{paletteActions.map(({label,icon:Icon,run})=><button key={label} onClick={()=>{setPalette(false);run()}}><Icon/><span>{label}</span><kbd>↵</kbd></button>)}</div></div>}
    {toast&&<div className="toast" role="status"><Check/>{toast}</div>}
  </div>;
}

function SectionTitle({title,body,actions}:{title:string;body:string;actions?:React.ReactNode}){return <div className="section-title"><div><h2>{title}</h2><p>{body}</p></div>{actions}</div>}
function Detail({title,subtitle,onBack,actions,children}:{title:string;subtitle:string;onBack:()=>void;actions?:React.ReactNode;children:React.ReactNode}){return <><div className="detail-head"><button onClick={onBack}>← Back</button><div><h2>{title}</h2><p>{subtitle}</p></div><div>{actions}</div></div>{children}</>}
function Key({label,value}:{label:string;value:string}){return <div className="key"><span>{label}</span><strong>{value}</strong></div>}

export default App;
