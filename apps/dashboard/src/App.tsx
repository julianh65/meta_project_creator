import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Code2,
  ExternalLink,
  FileText,
  FolderKanban,
  Globe2,
  Inbox,
  LayoutDashboard,
  MessageSquarePlus,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Terminal,
  XCircle
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import type {
  AutonomyLevel,
  DashboardSummary,
  ProjectDetail,
  ProjectDraft,
  ProjectFileName,
  ProjectRecord,
  ProjectType,
  RequestRecord,
  RequestStatus,
  RunRecord
} from "@startup-os/shared";

const projectFiles: ProjectFileName[] = ["PROJECT.md", "QUEUE.md", "AGENTS.md", "LOG.md"];

const navItems = [
  { href: "#/", label: "Dashboard", icon: LayoutDashboard },
  { href: "#/projects", label: "Projects", icon: FolderKanban },
  { href: "#/new", label: "New Project", icon: Plus },
  { href: "#/inbox", label: "Inbox", icon: Inbox },
  { href: "#/ops", label: "Browser/Ops", icon: Globe2 },
  { href: "#/runs", label: "Runs", icon: Activity }
];

type DraftInput = {
  rawPrompt: string;
  name: string;
  type: ProjectType | "";
  autonomy: AutonomyLevel | "";
  preferredStack: string;
  thingsToAvoid: string;
  vibeNotes: string;
};

export function App() {
  const route = useRoute();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const data = await fetchJson<DashboardSummary>("/api/summary");
      if (active) setSummary(data);
    };
    load().catch(console.error);
    const id = window.setInterval(() => load().catch(console.error), 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <CircleDot size={22} />
          <div>
            <strong>Startup OS</strong>
            <span>local project swarm</span>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              route === item.href.slice(1) ||
              (item.href === "#/projects" && route.startsWith("/projects/"));
            return (
              <a className={active ? "nav-item active" : "nav-item"} href={item.href} key={item.href}>
                <Icon size={18} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="worker-card">
          <StatusPill status={summary?.worker.is_online ? "online" : "offline"} />
          <span>{summary?.worker.last_seen_at ? timeAgo(summary.worker.last_seen_at) : "never seen"}</span>
        </div>
      </aside>

      <main className="main-panel">
        {route === "/" && <DashboardView summary={summary} />}
        {route === "/projects" && <ProjectsView />}
        {route === "/new" && <NewProjectView />}
        {route === "/inbox" && <InboxView />}
        {route === "/ops" && <OpsView />}
        {route === "/runs" && <RunsView />}
        {route.startsWith("/projects/") && <ProjectDetailView slug={decodeURIComponent(route.split("/")[2] ?? "")} />}
      </main>
    </div>
  );
}

function DashboardView({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) return <Loading title="Loading dashboard" />;

  return (
    <section className="page-stack">
      <Header
        eyebrow="Overview"
        title="Personal project swarm"
        action={<StatusPill status={summary.worker.is_online ? "online" : "offline"} />}
      />
      <div className="metric-grid">
        <MetricCard label="Active projects" value={summary.activeProjects} icon={<FolderKanban size={18} />} />
        <MetricCard label="Need Julian" value={summary.needsJulian} icon={<AlertCircle size={18} />} tone="amber" />
        <MetricCard label="Stale projects" value={summary.staleProjects} icon={<RefreshCw size={18} />} tone="red" />
        <MetricCard label="Browser/Ops" value={summary.browserOps} icon={<Globe2 size={18} />} tone="blue" />
        <MetricCard label="Approvals" value={summary.approvals} icon={<ClipboardList size={18} />} />
      </div>
      <div className="two-column">
        <Panel title="Projects">
          {summary.projects.length ? (
            <div className="card-list">
              {summary.projects.map((project) => (
                <ProjectRow project={project} key={project.id} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Plus size={24} />} title="No projects yet" body="Create one from a messy prompt." />
          )}
        </Panel>
        <Panel title="Recent runs">
          {summary.recentRuns.length ? (
            <RunList runs={summary.recentRuns} compact />
          ) : (
            <EmptyState icon={<Activity size={24} />} title="No runs yet" body="Queue a heartbeat or feedback job." />
          )}
        </Panel>
      </div>
    </section>
  );
}

function ProjectsView() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setProjects(await fetchJson<ProjectRecord[]>("/api/projects"));
    setLoading(false);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <section className="page-stack">
      <Header
        eyebrow="Projects"
        title="Project folders"
        action={
          <a className="button primary" href="#/new">
            <Plus size={16} /> New
          </a>
        }
      />
      {loading ? (
        <Loading title="Loading projects" />
      ) : projects.length ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard project={project} reload={load} key={project.id} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<FolderKanban size={26} />} title="No projects synced" body="Folders created under projects/ will appear here." />
      )}
    </section>
  );
}

function ProjectCard({ project, reload }: { project: ProjectRecord; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const runHeartbeat = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/projects/${project.slug}/heartbeat`, { method: "POST" });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="project-card">
      <div className="card-head">
        <div>
          <a className="project-title" href={`#/projects/${project.slug}`}>{project.name}</a>
          <p>{project.one_liner || "No one-liner yet."}</p>
        </div>
        <RunBadge status={project.recent_run_status ?? null} />
      </div>
      <div className="meta-row">
        <Tag>{project.type}</Tag>
        <Tag>{project.autonomy}</Tag>
        <Tag>{project.status}</Tag>
      </div>
      <div className="now-task">
        <span>Now</span>
        <strong>{project.current_now_task ?? "No open Now item"}</strong>
      </div>
      <div className="split-counts">
        <span>{project.needs_julian_count ?? 0} need Julian</span>
        <span>{project.browser_ops_count ?? 0} ops</span>
        <span>{project.last_heartbeat_at ? timeAgo(project.last_heartbeat_at) : "no heartbeat"}</span>
      </div>
      <div className="button-row">
        <a className="button" href={`#/projects/${project.slug}`}>
          <ExternalLink size={15} /> Open
        </a>
        <button className="button" type="button" onClick={runHeartbeat} disabled={busy}>
          <PlayCircle size={15} /> Heartbeat
        </button>
      </div>
    </article>
  );
}

function NewProjectView() {
  const [input, setInput] = useState<DraftInput>({
    rawPrompt: "",
    name: "",
    type: "",
    autonomy: "",
    preferredStack: "",
    thingsToAvoid: "",
    vibeNotes: ""
  });
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [scaffold, setScaffold] = useState(false);
  const [runFirstHeartbeat, setRunFirstHeartbeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ProjectRecord | null>(null);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const nextDraft = await fetchJson<ProjectDraft>("/api/projects/proposal", {
        method: "POST",
        body: JSON.stringify(input)
      });
      setDraft(nextDraft);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const project = await fetchJson<ProjectRecord>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ draft, scaffold, runFirstHeartbeat })
      });
      setCreated(project);
      window.location.hash = `/projects/${project.slug}`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-stack">
      <Header eyebrow="Onboarding" title="Create from a messy prompt" />
      <form className="editor-panel" onSubmit={generate}>
        <label className="field full">
          <span>Describe the project however you want</span>
          <textarea
            className="big-textarea"
            value={input.rawPrompt}
            onChange={(event) => setInput({ ...input, rawPrompt: event.target.value })}
            placeholder="Paste the long messy idea dump here..."
            required
          />
        </label>
        <div className="form-grid">
          <TextField label="Name" value={input.name} onChange={(name) => setInput({ ...input, name })} />
          <label className="field">
            <span>Project type</span>
            <select value={input.type} onChange={(event) => setInput({ ...input, type: event.target.value as DraftInput["type"] })}>
              <option value="">Infer</option>
              <option value="web">web</option>
              <option value="mobile-expo">mobile-expo</option>
              <option value="browser-extension">browser-extension</option>
              <option value="cli">cli</option>
              <option value="research">research</option>
              <option value="content">content</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="field">
            <span>Autonomy</span>
            <select value={input.autonomy} onChange={(event) => setInput({ ...input, autonomy: event.target.value as DraftInput["autonomy"] })}>
              <option value="">Infer</option>
              <option value="throwaway">throwaway</option>
              <option value="normal">normal</option>
              <option value="careful">careful</option>
            </select>
          </label>
          <TextField label="Preferred stack" value={input.preferredStack} onChange={(preferredStack) => setInput({ ...input, preferredStack })} />
          <TextField label="Things to avoid" value={input.thingsToAvoid} onChange={(thingsToAvoid) => setInput({ ...input, thingsToAvoid })} />
          <TextField label="Vibe/style notes" value={input.vibeNotes} onChange={(vibeNotes) => setInput({ ...input, vibeNotes })} />
        </div>
        <div className="button-row">
          <button className="button primary" type="submit" disabled={busy || !input.rawPrompt.trim()}>
            <Search size={16} /> Generate proposal
          </button>
        </div>
      </form>

      {draft && (
        <ProposalEditor
          draft={draft}
          setDraft={setDraft}
          scaffold={scaffold}
          setScaffold={setScaffold}
          runFirstHeartbeat={runFirstHeartbeat}
          setRunFirstHeartbeat={setRunFirstHeartbeat}
          create={create}
          busy={busy}
        />
      )}
      {created && <p className="success-line">Created {created.name}. Manual command: <code>cd {created.path} && codex</code></p>}
    </section>
  );
}

function ProposalEditor(props: {
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  scaffold: boolean;
  setScaffold: (value: boolean) => void;
  runFirstHeartbeat: boolean;
  setRunFirstHeartbeat: (value: boolean) => void;
  create: () => Promise<void>;
  busy: boolean;
}) {
  const { draft, setDraft } = props;
  const proposal = draft.proposal;
  const updateProposal = <K extends keyof ProjectDraft["proposal"]>(key: K, value: ProjectDraft["proposal"][K]) => {
    setDraft({ ...draft, proposal: { ...proposal, [key]: value } });
  };
  const updateFile = (file: ProjectFileName, content: string) => {
    setDraft({ ...draft, files: { ...draft.files, [file]: content } });
  };

  return (
    <div className="page-stack">
      <Panel title="Review proposal">
        <div className="form-grid">
          <TextField label="Name" value={proposal.name} onChange={(value) => updateProposal("name", value)} />
          <TextField label="Slug" value={proposal.slug} onChange={(value) => updateProposal("slug", value)} />
          <TextField label="One-liner" value={proposal.oneLiner} onChange={(value) => updateProposal("oneLiner", value)} />
          <label className="field">
            <span>Type</span>
            <select value={proposal.type} onChange={(event) => updateProposal("type", event.target.value as ProjectType)}>
              {["web", "mobile-expo", "browser-extension", "cli", "research", "content", "unknown"].map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Autonomy</span>
            <select value={proposal.autonomy} onChange={(event) => updateProposal("autonomy", event.target.value as AutonomyLevel)}>
              {["throwaway", "normal", "careful"].map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <TextField label="Stack" value={proposal.preferredStack} onChange={(value) => updateProposal("preferredStack", value)} />
        </div>
        <label className="field full">
          <span>MVP</span>
          <textarea value={proposal.mvp} onChange={(event) => updateProposal("mvp", event.target.value)} />
        </label>
        <label className="field full">
          <span>First task</span>
          <textarea value={proposal.firstTask} onChange={(event) => updateProposal("firstTask", event.target.value)} />
        </label>
        <div className="toggle-row">
          <label><input type="checkbox" checked={props.scaffold} onChange={(event) => props.setScaffold(event.target.checked)} /> Scaffold starter code</label>
          <label><input type="checkbox" checked={props.runFirstHeartbeat} onChange={(event) => props.setRunFirstHeartbeat(event.target.checked)} /> Queue first heartbeat</label>
        </div>
      </Panel>

      <Panel title="Edit generated files">
        <div className="file-preview-grid">
          {projectFiles.map((file) => (
            <label className="field file-preview" key={file}>
              <span>{file}</span>
              <textarea value={draft.files[file]} onChange={(event) => updateFile(file, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="button-row">
          <button className="button primary" type="button" onClick={props.create} disabled={props.busy}>
            <CheckCircle2 size={16} /> Create project
          </button>
        </div>
      </Panel>
    </div>
  );
}

function ProjectDetailView({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [selectedFile, setSelectedFile] = useState<ProjectFileName>("PROJECT.md");
  const [fileContent, setFileContent] = useState("");
  const [cadenceHours, setCadenceHours] = useState(168);
  const [autoQueueWhenStale, setAutoQueueWhenStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await fetchJson<ProjectDetail>(`/api/projects/${slug}`);
    setDetail(data);
    setFileContent(data.files[selectedFile]);
    setCadenceHours(data.stale_after_hours ?? 168);
    setAutoQueueWhenStale(Boolean(data.auto_queue_when_stale));
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load().catch(console.error);
  }, [slug]);

  useEffect(() => {
    if (detail) setFileContent(detail.files[selectedFile]);
  }, [selectedFile, detail]);

  const heartbeat = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/projects/${slug}/heartbeat`, { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (!feedback.trim()) return;
    setBusy(true);
    try {
      await fetchJson(`/api/projects/${slug}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback })
      });
      setFeedback("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/projects/${slug}/files/${selectedFile}`, {
        method: "PUT",
        body: JSON.stringify({ content: fileContent })
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading || !detail) return <Loading title="Loading project" />;
  const localAppUrl = findLocalAppUrl(detail.files["PROJECT.md"]);

  const saveCadence = async () => {
    setBusy(true);
    try {
      const nextProjectMd = replaceMarkdownSection(
        detail.files["PROJECT.md"],
        "Heartbeat cadence",
        `stale_after_hours: ${cadenceHours}\nauto_queue_when_stale: ${autoQueueWhenStale ? "true" : "false"}`
      );
      await fetchJson(`/api/projects/${slug}/files/PROJECT.md`, {
        method: "PUT",
        body: JSON.stringify({ content: nextProjectMd })
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page-stack">
      <Header
        eyebrow={detail.type}
        title={detail.name}
        action={
          <div className="button-row">
            <button className="button primary" onClick={heartbeat} disabled={busy} title="Queue heartbeat">
              <PlayCircle size={16} /> Heartbeat
            </button>
            <button className="button" onClick={() => navigator.clipboard?.writeText(detail.manualCommand)} title="Copy manual Codex command">
              <Terminal size={16} /> Copy cd
            </button>
            <button className="button" onClick={() => fetchJson(`/api/projects/${slug}/open-folder`, { method: "POST" })} title="Open folder in Finder">
              <ExternalLink size={16} /> Folder
            </button>
            {localAppUrl ? (
              <a className="button" href={localAppUrl} target="_blank" rel="noreferrer" title="Open local app URL">
                <ExternalLink size={16} /> App
              </a>
            ) : (
              <button className="button" disabled title="No local app URL found in PROJECT.md">
                <ExternalLink size={16} /> App
              </button>
            )}
          </div>
        }
      />
      <div className="overview-band">
        <p>{detail.one_liner}</p>
        <div className="meta-row">
          <Tag>{detail.status}</Tag>
          <Tag>{detail.autonomy}</Tag>
          <Tag>{detail.last_heartbeat_at ? `heartbeat ${timeAgo(detail.last_heartbeat_at)}` : "no heartbeat"}</Tag>
          <Tag>stale after {detail.stale_after_hours}h</Tag>
          <Tag>{detail.path}</Tag>
        </div>
      </div>

      <div className="two-column">
        <Panel title="Queue">
          <QueueSection title="Now" items={detail.queue.now} />
          <QueueSection title="Needs Julian" items={detail.queue.needsJulian} />
          <QueueSection title="Browser/Ops Requests" items={detail.queue.browserOps} />
          <QueueSection title="Marketing Drafts" items={detail.queue.marketingDrafts} />
        </Panel>
        <Panel title="Steer project">
          <label className="field full">
            <span>Tell this project agent something...</span>
            <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Make the landing page feel more like a research lab notebook..." />
          </label>
          <div className="button-row">
            <button className="button primary" type="button" onClick={submitFeedback} disabled={busy || !feedback.trim()}>
              <Send size={16} /> Add feedback
            </button>
          </div>
          <div className="command-box"><code>{detail.manualCommand}</code></div>
          <div className="cadence-box">
            <label className="field">
              <span>Stale after hours</span>
              <input
                type="number"
                min="1"
                value={cadenceHours}
                onChange={(event) => setCadenceHours(Number(event.target.value))}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={autoQueueWhenStale}
                onChange={(event) => setAutoQueueWhenStale(event.target.checked)}
              />
              Auto-queue when stale
            </label>
            <button className="button" type="button" onClick={saveCadence} disabled={busy || cadenceHours < 1}>
              <Save size={16} /> Save cadence
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="Project files">
        <div className="tab-row">
          {projectFiles.map((file) => (
            <button className={selectedFile === file ? "tab active" : "tab"} key={file} onClick={() => setSelectedFile(file)}>
              <FileText size={15} /> {file}
            </button>
          ))}
        </div>
        <textarea className="code-editor" value={fileContent} onChange={(event) => setFileContent(event.target.value)} />
        <div className="button-row">
          <button className="button primary" onClick={saveFile} disabled={busy}>
            <Save size={16} /> Save {selectedFile}
          </button>
        </div>
      </Panel>

      <div className="two-column">
        <Panel title="Recent log">
          {detail.recentLogEntries.length ? <SimpleList items={detail.recentLogEntries} /> : <EmptyState icon={<FileText size={22} />} title="No log entries" body="LOG.md is empty." />}
        </Panel>
        <Panel title="Recent runs">
          <RunList runs={detail.runs} compact />
        </Panel>
      </div>
    </section>
  );
}

function InboxView() {
  const [items, setItems] = useState<RequestRecord[]>([]);
  const [filter, setFilter] = useState("all");

  const load = async () => setItems(await fetchJson<RequestRecord[]>("/api/inbox?includeDone=true"));
  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = filter === "all" ? items : items.filter((item) => item.type === filter || item.status === filter);

  return (
    <RequestPage
      eyebrow="Inbox"
      title="Needs attention"
      items={filtered}
      reload={load}
      filters={["all", "needs_julian", "browser_ops", "marketing_approval", "deploy_approval", "blocked", "failed", "done"]}
      activeFilter={filter}
      setFilter={setFilter}
    />
  );
}

function OpsView() {
  const [items, setItems] = useState<RequestRecord[]>([]);
  const [filter, setFilter] = useState("all");
  const load = async () => setItems(await fetchJson<RequestRecord[]>("/api/ops"));

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = filter === "all" ? items : items.filter((item) => item.type === filter || item.status === filter);

  return (
    <RequestPage
      eyebrow="Browser/Ops"
      title="External action queue"
      items={filtered}
      reload={load}
      filters={["all", "browser_ops", "account_setup", "captcha_needed", "login_needed", "payment_needed", "open", "done"]}
      activeFilter={filter}
      setFilter={setFilter}
    />
  );
}

function RequestPage(props: {
  eyebrow: string;
  title: string;
  items: RequestRecord[];
  reload: () => Promise<void>;
  filters: string[];
  activeFilter: string;
  setFilter: (filter: string) => void;
}) {
  return (
    <section className="page-stack">
      <Header eyebrow={props.eyebrow} title={props.title} />
      <div className="tab-row">
        {props.filters.map((filter) => (
          <button className={props.activeFilter === filter ? "tab active" : "tab"} key={filter} onClick={() => props.setFilter(filter)}>
            {filter}
          </button>
        ))}
      </div>
      {props.items.length ? (
        <div className="request-list">
          {props.items.map((item) => (
            <RequestCard item={item} reload={props.reload} key={item.id} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Inbox size={24} />} title="No matching items" body="Queue sections in project folders will surface here." />
      )}
    </section>
  );
}

function RequestCard({ item, reload }: { item: RequestRecord; reload: () => Promise<void> }) {
  const update = async (status: RequestStatus) => {
    await fetchJson(`/api/requests/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await reload();
  };

  return (
    <article className="request-card">
      <div>
        <div className="meta-row">
          <Tag>{item.project_slug}</Tag>
          <Tag>{item.type}</Tag>
          <Tag>{item.risk} risk</Tag>
          <RunBadge status={item.status === "done" ? "succeeded" : item.status === "failed" ? "failed" : "queued"} label={item.status} />
        </div>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
      </div>
      <div className="button-row">
        <button className="button" onClick={() => update("approved")}>Approve</button>
        <button className="button" onClick={() => update("done")}>Done</button>
        <button className="button danger" onClick={() => update("rejected")}>Reject</button>
      </div>
    </article>
  );
}

function RunsView() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => {
    fetchJson<RunRecord[]>("/api/runs").then(setRuns).catch(console.error);
  }, []);

  return (
    <section className="page-stack">
      <Header eyebrow="Runs" title="Worker and Codex attempts" />
      <RunList runs={runs} />
    </section>
  );
}

function RunList({ runs, compact = false }: { runs: RunRecord[]; compact?: boolean }) {
  if (!runs.length) {
    return <EmptyState icon={<Activity size={22} />} title="No runs" body="Heartbeat and feedback runs will appear here." />;
  }

  return (
    <div className={compact ? "run-list compact" : "run-list"}>
      {runs.map((run) => (
        <article className="run-card" key={run.id}>
          <div className="run-title">
            <RunBadge status={run.status} />
            <strong>{run.run_type}</strong>
            <span>{run.project_slug}</span>
            <span>{timeAgo(run.created_at)}</span>
          </div>
          {!compact && (
            <>
              <p>{run.summary || run.error || "Queued. Waiting for the local worker."}</p>
              {run.logs && <pre>{run.logs.slice(-2500)}</pre>}
            </>
          )}
        </article>
      ))}
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectRecord }) {
  return (
    <a className="row-link" href={`#/projects/${project.slug}`}>
      <div>
        <strong>{project.name}</strong>
        <span>{project.current_now_task ?? "No Now item"}</span>
      </div>
      <RunBadge status={project.recent_run_status ?? null} />
    </a>
  );
}

function QueueSection({ title, items }: { title: string; items: Array<{ text: string; done: boolean }> }) {
  return (
    <div className="queue-section">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li className={item.done ? "done" : ""} key={`${item.text}-${index}`}>{item.text}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No items.</p>
      )}
    </div>
  );
}

function Header({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value, icon, tone = "green" }: { label: string; value: number; icon: ReactNode; tone?: "green" | "amber" | "red" | "blue" }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ status }: { status: "online" | "offline" }) {
  return <span className={`status-pill ${status}`}>{status === "online" ? <CheckCircle2 size={14} /> : <XCircle size={14} />} worker {status}</span>;
}

function RunBadge({ status, label }: { status: string | null; label?: string }) {
  const safe = status ?? "none";
  return <span className={`run-badge ${safe}`}>{label ?? safe}</span>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

function SimpleList({ items }: { items: string[] }) {
  return (
    <ul className="simple-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function Loading({ title }: { title: string }) {
  return (
    <div className="loading">
      <RefreshCw size={18} className="spin" />
      {title}
    </div>
  );
}

function useRoute() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(normalizeRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

function normalizeRoute(hash: string) {
  const route = hash.replace(/^#/, "") || "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function findLocalAppUrl(markdown: string): string {
  return markdown.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s)]*/)?.[0] ?? "";
}

function replaceMarkdownSection(markdown: string, heading: string, body: string): string {
  const lines = markdown.split(/\r?\n/);
  const sectionHeading = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === sectionHeading);

  if (start === -1) {
    return `${markdown.trimEnd()}\n\n${sectionHeading}\n\n${body.trim()}\n`;
  }

  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) {
    end += 1;
  }

  const nextLines = [
    ...lines.slice(0, start + 1),
    "",
    body.trim(),
    "",
    ...lines.slice(end)
  ];

  return nextLines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

function timeAgo(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return "unknown";
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
