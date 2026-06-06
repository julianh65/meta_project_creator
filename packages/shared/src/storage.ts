import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AppPaths, createAppPaths } from "./paths";
import {
  allowedProjectFile,
  appendLogEntry,
  appendQueueItem,
  nowIso,
  parseProjectMarkdown,
  parseQueue,
  recentLogEntries,
  replaceMarkdownSection,
  stableId
} from "./markdown";
import { createScaffold, HEARTBEAT_PROMPT, INITIAL_BUILD_PROMPT } from "./templates";
import {
  DashboardSummary,
  JobRecord,
  ParsedQueue,
  ProjectDetail,
  ProjectDeletionResult,
  ProjectDraft,
  ProjectFileName,
  ProjectAgentStatus,
  ProjectPhase,
  ProjectRecord,
  RequestRecord,
  RequestStatus,
  RequestType,
  RunRecord,
  RunStatus,
  RunType,
  WorkerStatus
} from "./types";

const OPEN_REQUEST_STATUSES: RequestStatus[] = ["open", "queued", "running", "needs_julian", "failed"];

export interface CreateProjectOptions {
  scaffold?: boolean;
  runInitialBuild?: boolean;
  runFirstHeartbeat?: boolean;
  initializeGit?: boolean;
}

export class StartupStorage {
  readonly paths: AppPaths;
  readonly db: Database.Database;

  constructor(paths: AppPaths = createAppPaths()) {
    this.paths = paths;
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    fs.mkdirSync(this.paths.projectsDir, { recursive: true });
    this.db = new Database(this.paths.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        autonomy TEXT NOT NULL,
        status TEXT NOT NULL,
        build_phase TEXT NOT NULL DEFAULT 'initial-build',
        codex_thread_id TEXT,
        agent_status TEXT NOT NULL DEFAULT 'idle',
        active_turn_id TEXT,
        agent_goal TEXT,
        last_agent_update_at TEXT,
        one_liner TEXT NOT NULL DEFAULT '',
        current_now_task TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        last_worker_run_at TEXT,
        stale_after_hours INTEGER NOT NULL DEFAULT 168,
        auto_queue_when_stale INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_slug TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        risk TEXT NOT NULL DEFAULT 'low',
        source TEXT NOT NULL DEFAULT 'manual',
        source_key TEXT UNIQUE,
        thread TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_slug TEXT NOT NULL,
        run_type TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        logs TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        files_changed TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_slug TEXT NOT NULL,
        run_id TEXT NOT NULL,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        worker_id TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS worker_status (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_seen_at TEXT,
        current_job_id TEXT,
        version TEXT NOT NULL DEFAULT '0.1.0',
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
      CREATE INDEX IF NOT EXISTS idx_requests_project ON requests(project_slug, status);
      CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_slug, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, created_at ASC);
    `);
    this.ensureColumn("projects", "build_phase", "TEXT NOT NULL DEFAULT 'initial-build'");
    this.ensureColumn("projects", "codex_thread_id", "TEXT");
    this.ensureColumn("projects", "agent_status", "TEXT NOT NULL DEFAULT 'idle'");
    this.ensureColumn("projects", "active_turn_id", "TEXT");
    this.ensureColumn("projects", "agent_goal", "TEXT");
    this.ensureColumn("projects", "last_agent_update_at", "TEXT");
    this.ensureColumn("projects", "stale_after_hours", "INTEGER NOT NULL DEFAULT 168");
    this.ensureColumn("projects", "auto_queue_when_stale", "INTEGER NOT NULL DEFAULT 0");
  }

  syncProjectsFromFiles(): ProjectRecord[] {
    fs.mkdirSync(this.paths.projectsDir, { recursive: true });
    const entries = fs.readdirSync(this.paths.projectsDir, { withFileTypes: true });
    const synced: ProjectRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const project = this.syncProjectFromFiles(entry.name);
      if (project) {
        synced.push(project);
      }
    }

    return synced;
  }

  syncProjectFromFiles(slug: string): ProjectRecord | null {
    const projectDir = path.join(this.paths.projectsDir, slug);
    if (!fs.existsSync(projectDir)) {
      return null;
    }

    const files = this.readProjectFiles(slug);
    if (!files["PROJECT.md"] && !files["QUEUE.md"]) {
      return null;
    }

    const existing = this.getProjectBySlug(slug, false) ?? undefined;
    const project = parseProjectMarkdown(slug, projectDir, files, existing);
    this.upsertProject(project);
    this.syncRequestsFromQueue(project, parseQueue(files["QUEUE.md"] ?? ""));
    return project;
  }

  getDashboardSummary(): DashboardSummary {
    this.syncProjectsFromFiles();
    const projects = this.listProjects();
    const worker = this.getWorkerStatus();
    const staleHours = Number(process.env.STARTUP_OS_STALE_HOURS ?? "168");

    return {
      worker,
      activeProjects: projects.filter((project) => project.status === "active").length,
      needsJulian: this.countRequests(["needs_julian", "blocked", "secret_needed", "captcha_needed", "login_needed", "payment_needed"]),
      staleProjects: projects.filter((project) => {
        const relevant = project.last_heartbeat_at ?? project.updated_at;
        const projectCutoff = Date.now() - (project.stale_after_hours ?? staleHours) * 60 * 60 * 1000;
        return relevant ? Date.parse(relevant) < projectCutoff : true;
      }).length,
      browserOps: this.countRequests(["browser_ops", "account_setup", "captcha_needed", "login_needed", "payment_needed"]),
      approvals: this.countRequests(["marketing_approval", "deploy_approval"]),
      queuedJobs: this.countJobs("queued"),
      runningJobs: this.countJobs("running"),
      recentRuns: this.listRuns(8),
      activeJobs: this.listJobs({ limit: 8 }),
      projects: projects.slice(0, 8)
    };
  }

  listProjects(): ProjectRecord[] {
    this.syncProjectsFromFiles();
    const rows = this.db
      .prepare(
        `
        SELECT
          p.*,
          COALESCE(SUM(CASE WHEN r.type IN ('needs_julian','blocked','secret_needed','captcha_needed','login_needed','payment_needed') AND r.status IN (${sqlList(OPEN_REQUEST_STATUSES)}) THEN 1 ELSE 0 END), 0) AS needs_julian_count,
          COALESCE(SUM(CASE WHEN r.type IN ('browser_ops','account_setup','captcha_needed','login_needed','payment_needed') AND r.status IN (${sqlList(OPEN_REQUEST_STATUSES)}) THEN 1 ELSE 0 END), 0) AS browser_ops_count,
          (
            SELECT rr.status FROM runs rr
            WHERE rr.project_slug = p.slug
            ORDER BY rr.created_at DESC
            LIMIT 1
          ) AS recent_run_status
        FROM projects p
        LEFT JOIN requests r ON r.project_slug = p.slug
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `
      )
      .all() as ProjectRecord[];
    return rows.map(normalizeProjectRecord);
  }

  getProjectDetail(slug: string): ProjectDetail | null {
    const project = this.syncProjectFromFiles(slug) ?? this.getProjectBySlug(slug);
    if (!project) {
      return null;
    }

    const files = this.readProjectFiles(slug);
    const queue = parseQueue(files["QUEUE.md"] ?? "");

    return {
      ...project,
      files,
      queue,
      requests: this.listRequests({ projectSlug: slug }),
      runs: this.listRuns(20, slug),
      jobs: this.listJobs({ projectSlug: slug, limit: 20, includeFinished: true }),
      recentLogEntries: recentLogEntries(files["LOG.md"] ?? "", 10),
      manualCommand: `cd ${shellQuote(project.path)} && codex`,
      managerCommand: project.codex_thread_id
        ? `cd ${shellQuote(project.path)} && codex resume --include-non-interactive ${project.codex_thread_id}`
        : `cd ${shellQuote(project.path)} && codex`,
      managerExecCommand: project.codex_thread_id
        ? `cd ${shellQuote(project.path)} && codex exec resume ${project.codex_thread_id}`
        : `cd ${shellQuote(project.path)} && codex exec`
    };
  }

  getProjectBySlug(slug: string, sync = true): ProjectRecord | null {
    if (sync) {
      this.syncProjectFromFiles(slug);
    }
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
      | ProjectRecord
      | undefined;
    return row ? normalizeProjectRecord(row) : null;
  }

  createProjectFromDraft(draft: ProjectDraft, options: CreateProjectOptions = {}): ProjectRecord {
    const slug = draft.proposal.slug;
    const projectDir = path.join(this.paths.projectsDir, slug);

    if (fs.existsSync(projectDir)) {
      throw new Error(`Project folder already exists: ${slug}`);
    }

    fs.mkdirSync(projectDir, { recursive: true });
    for (const [fileName, content] of Object.entries(draft.files)) {
      if (!allowedProjectFile(fileName)) {
        continue;
      }
      fs.writeFileSync(path.join(projectDir, fileName), content, "utf8");
    }

    if (options.scaffold) {
      createScaffold(projectDir, draft.proposal.type, draft.proposal.name);
    }

    if (options.initializeGit ?? true) {
      initializeProjectRepository(projectDir);
    }

    const project = this.syncProjectFromFiles(slug);
    if (!project) {
      throw new Error("Project was created but could not be synced from Markdown files.");
    }

    if (options.runInitialBuild ?? options.runFirstHeartbeat) {
      this.enqueueInitialBuild(slug);
    }

    return project;
  }

  deleteThrowawayProject(slug: string, confirmSlug: string): ProjectDeletionResult {
    if (slug !== confirmSlug) {
      throw new Error("Project deletion requires matching confirmSlug.");
    }

    const project = this.getProjectBySlug(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }
    if (project.autonomy !== "throwaway") {
      throw new Error("Only throwaway projects can be deleted from the dashboard.");
    }

    const activeJobs = this.listJobs({ projectSlug: slug, includeFinished: false });
    if (activeJobs.length > 0) {
      throw new Error("Cannot delete a project while it has queued or running jobs.");
    }

    const projectPath = assertProjectPathIsSafe(project.path, this.paths.projectsDir);
    const deletedAt = nowIso();
    const deletedFolder = fs.existsSync(projectPath);
    if (deletedFolder) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }

    const cleanup = this.db.transaction(() => {
      this.db.prepare("DELETE FROM jobs WHERE project_slug = ?").run(slug);
      this.db.prepare("DELETE FROM runs WHERE project_slug = ?").run(slug);
      this.db.prepare("DELETE FROM requests WHERE project_slug = ?").run(slug);
      this.db.prepare("DELETE FROM projects WHERE slug = ?").run(slug);
    });
    cleanup();

    return {
      slug,
      path: projectPath,
      deleted_at: deletedAt,
      deleted_folder: deletedFolder
    };
  }

  readProjectFiles(slug: string): Record<ProjectFileName, string> {
    const projectDir = path.join(this.paths.projectsDir, slug);
    return {
      "AGENTS.md": readIfExists(path.join(projectDir, "AGENTS.md")),
      "PROJECT.md": readIfExists(path.join(projectDir, "PROJECT.md")),
      "QUEUE.md": readIfExists(path.join(projectDir, "QUEUE.md")),
      "LOG.md": readIfExists(path.join(projectDir, "LOG.md"))
    };
  }

  getProjectFile(slug: string, fileName: ProjectFileName): string {
    return this.readProjectFiles(slug)[fileName];
  }

  updateProjectFile(slug: string, fileName: ProjectFileName, content: string): ProjectRecord | null {
    if (!allowedProjectFile(fileName)) {
      throw new Error("Only AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md can be edited here.");
    }
    const projectDir = path.join(this.paths.projectsDir, slug);
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Unknown project: ${slug}`);
    }
    fs.writeFileSync(path.join(projectDir, fileName), content, "utf8");
    return this.syncProjectFromFiles(slug);
  }

  addFeedback(slug: string, feedback: string): RunRecord {
    const project = this.getProjectBySlug(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const queuePath = path.join(project.path, "QUEUE.md");
    const logPath = path.join(project.path, "LOG.md");
    const queue = readIfExists(queuePath);
    const log = readIfExists(logPath);
    fs.writeFileSync(queuePath, appendQueueItem(queue, "now", `Julian feedback: ${feedback.trim()}`), "utf8");
    fs.writeFileSync(logPath, appendLogEntry(log, `Julian added feedback: ${feedback.trim()}`), "utf8");
    this.syncProjectFromFiles(slug);

    const prompt = `Read AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md.

Julian gave this feedback:

${feedback.trim()}

Incorporate the feedback in one scoped work cycle. Update QUEUE.md and LOG.md when done. If the feedback needs external side effects or a decision, add a clear Needs Julian or Browser/Ops item instead.`;

    return this.enqueueRun(slug, "feedback", prompt, 10);
  }

  enqueueHeartbeat(slug: string): RunRecord {
    return this.enqueueRun(slug, "heartbeat", HEARTBEAT_PROMPT, 5);
  }

  enqueueInitialBuild(slug: string): RunRecord {
    const existing = this.db
      .prepare(
        `SELECT run_id FROM jobs
         WHERE project_slug = ? AND job_type = 'initial-build' AND status IN ('queued','running')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(slug) as { run_id: string } | undefined;
    if (existing) {
      return this.getRun(existing.run_id);
    }

    const project = this.getProjectBySlug(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }

    if (project.build_phase !== "initial-build") {
      this.updateProjectPhase(slug, "initial-build");
    }

    const logPath = path.join(project.path, "LOG.md");
    fs.writeFileSync(
      logPath,
      appendLogEntry(readIfExists(logPath), "Initial build queued."),
      "utf8"
    );
    this.syncProjectFromFiles(slug);

    return this.enqueueRun(slug, "initial-build", INITIAL_BUILD_PROMPT, 20);
  }

  updateProjectPhase(slug: string, phase: ProjectPhase): ProjectRecord | null {
    const project = this.getProjectBySlug(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const projectPath = path.join(project.path, "PROJECT.md");
    const logPath = path.join(project.path, "LOG.md");
    fs.writeFileSync(
      projectPath,
      replaceMarkdownSection(readIfExists(projectPath), "Build phase", phase),
      "utf8"
    );
    fs.writeFileSync(
      logPath,
      appendLogEntry(readIfExists(logPath), `Build phase changed to ${phase}.`),
      "utf8"
    );
    return this.syncProjectFromFiles(slug);
  }

  enqueueRun(slug: string, runType: RunType, prompt: string, priority = 0): RunRecord {
    const project = this.getProjectBySlug(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }
    const created = nowIso();
    const runId = randomUUID();
    const jobId = randomUUID();

    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, project_slug, run_type, status, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`
      )
      .run(runId, project.id, project.slug, runType, prompt, created, created);

    this.db
      .prepare(
        `INSERT INTO jobs (id, project_id, project_slug, run_id, job_type, status, prompt, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      )
      .run(jobId, project.id, project.slug, runId, runType, prompt, priority, created, created);

    this.updateProjectAgentState(slug, {
      agent_status: "queued",
      active_turn_id: runId,
      agent_goal: runType === "initial-build" ? "Create the first demonstrable local prototype." : project.current_now_task,
      last_agent_update_at: created
    });

    return this.getRun(runId);
  }

  setProjectCodexThread(slug: string, threadId: string): ProjectRecord | null {
    const project = this.getProjectBySlug(slug, false) ?? this.syncProjectFromFiles(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const projectPath = path.join(project.path, "PROJECT.md");
    const logPath = path.join(project.path, "LOG.md");
    fs.writeFileSync(
      projectPath,
      replaceMarkdownSection(readIfExists(projectPath), "Codex manager thread", threadId),
      "utf8"
    );
    if (project.codex_thread_id !== threadId) {
      fs.writeFileSync(
        logPath,
        appendLogEntry(readIfExists(logPath), `Codex manager thread set to ${threadId}.`),
        "utf8"
      );
    }

    const updated = nowIso();
    this.db
      .prepare("UPDATE projects SET codex_thread_id = ?, last_agent_update_at = ?, updated_at = ? WHERE slug = ?")
      .run(threadId, updated, updated, slug);
    return this.syncProjectFromFiles(slug);
  }

  updateProjectAgentState(
    slug: string,
    patch: Partial<Pick<ProjectRecord, "agent_status" | "active_turn_id" | "agent_goal" | "last_agent_update_at">>
  ): ProjectRecord | null {
    const project = this.getProjectBySlug(slug, false) ?? this.syncProjectFromFiles(slug);
    if (!project) {
      throw new Error(`Unknown project: ${slug}`);
    }

    const agentStatus = patch.agent_status ?? project.agent_status;
    if (!isProjectAgentStatus(agentStatus)) {
      throw new Error(`Unsupported agent status: ${agentStatus}`);
    }

    const updated = nowIso();
    const lastAgentUpdate = patch.last_agent_update_at ?? updated;
    this.db
      .prepare(
        `UPDATE projects
         SET agent_status = ?,
             active_turn_id = ?,
             agent_goal = ?,
             last_agent_update_at = ?,
             updated_at = ?
         WHERE slug = ?`
      )
      .run(
        agentStatus,
        patch.active_turn_id === undefined ? project.active_turn_id : patch.active_turn_id,
        patch.agent_goal === undefined ? project.agent_goal : patch.agent_goal,
        lastAgentUpdate,
        updated,
        slug
      );
    return this.getProjectBySlug(slug, false);
  }

  listRequests(filter: { projectSlug?: string; types?: RequestType[]; includeDone?: boolean } = {}): RequestRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.projectSlug) {
      clauses.push("project_slug = ?");
      params.push(filter.projectSlug);
    }
    if (filter.types?.length) {
      clauses.push(`type IN (${filter.types.map(() => "?").join(",")})`);
      params.push(...filter.types);
    }
    if (!filter.includeDone) {
      clauses.push(`status IN (${OPEN_REQUEST_STATUSES.map(() => "?").join(",")})`);
      params.push(...OPEN_REQUEST_STATUSES);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM requests ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all(...params) as RequestRecord[];
  }

  updateRequestStatus(id: string, status: RequestStatus): RequestRecord {
    const updated = nowIso();
    this.db.prepare("UPDATE requests SET status = ?, updated_at = ? WHERE id = ?").run(status, updated, id);
    const request = this.getRequest(id);
    if (!request) {
      throw new Error(`Unknown request: ${id}`);
    }
    return request;
  }

  respondToRequest(id: string, response: string): RequestRecord {
    const request = this.getRequest(id);
    if (!request) {
      throw new Error(`Unknown request: ${id}`);
    }
    const project = this.getProjectBySlug(request.project_slug);
    if (!project) {
      throw new Error(`Unknown project: ${request.project_slug}`);
    }

    const trimmed = response.trim();
    const updated = nowIso();
    const nextThread = `${request.thread.trim() ? `${request.thread.trim()}\n\n` : ""}## Julian response - ${updated}\n\n${trimmed}`;

    this.db
      .prepare("UPDATE requests SET status = 'done', thread = ?, updated_at = ? WHERE id = ?")
      .run(nextThread, updated, id);

    const queuePath = path.join(project.path, "QUEUE.md");
    const logPath = path.join(project.path, "LOG.md");
    fs.writeFileSync(
      queuePath,
      appendQueueItem(readIfExists(queuePath), "now", `Julian answered "${request.title}": ${trimmed}`),
      "utf8"
    );
    fs.writeFileSync(
      logPath,
      appendLogEntry(readIfExists(logPath), `Julian responded to inbox item "${request.title}": ${trimmed}`),
      "utf8"
    );
    this.syncProjectFromFiles(project.slug);

    const prompt = `Read AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md.

Julian responded to this inbox item:

${request.title}

Julian's response:

${trimmed}

Act on this response in one scoped work cycle. If no code change is needed, update QUEUE.md and LOG.md to capture the decision. If external side effects are still needed, keep them explicit under Browser/Ops Requests.`;

    this.enqueueRun(project.slug, "feedback", prompt, 10);
    return this.getRequest(id) ?? request;
  }

  listRuns(limit = 50, projectSlug?: string): RunRecord[] {
    const params: unknown[] = [];
    let where = "";
    if (projectSlug) {
      where = "WHERE project_slug = ?";
      params.push(projectSlug);
    }
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as RunRecord[];
  }

  listJobs(filter: { limit?: number; projectSlug?: string; includeFinished?: boolean } = {}): JobRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.projectSlug) {
      clauses.push("project_slug = ?");
      params.push(filter.projectSlug);
    }
    if (!filter.includeFinished) {
      clauses.push("status IN ('queued','running')");
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(filter.limit ?? 50);
    return this.db
      .prepare(
        `SELECT * FROM jobs ${where}
         ORDER BY
           CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
           priority DESC,
           updated_at DESC
         LIMIT ?`
      )
      .all(...params) as JobRecord[];
  }

  getRun(id: string): RunRecord {
    const run = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRecord | undefined;
    if (!run) {
      throw new Error(`Unknown run: ${id}`);
    }
    return run;
  }

  getRequest(id: string): RequestRecord | null {
    return (this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRecord | undefined) ?? null;
  }

  getJob(id: string): JobRecord | null {
    return (this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRecord | undefined) ?? null;
  }

  claimNextJob(workerId: string): JobRecord | null {
    const claim = this.db.transaction(() => {
      const job = this.db
        .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 1")
        .get() as JobRecord | undefined;
      if (!job) {
        return null;
      }
      const started = nowIso();
      this.db
        .prepare(
          "UPDATE jobs SET status = 'running', worker_id = ?, started_at = ?, updated_at = ? WHERE id = ?"
        )
        .run(workerId, started, started, job.id);
      this.db
        .prepare("UPDATE runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?")
        .run(started, started, job.run_id);
      this.updateProjectAgentState(job.project_slug, {
        agent_status: "running",
        active_turn_id: job.run_id,
        last_agent_update_at: started
      });
      this.recordWorkerHeartbeat(workerId, job.id);
      return this.getJob(job.id);
    });

    return claim();
  }

  appendRunLogs(runId: string, logs: string): void {
    const updated = nowIso();
    this.db
      .prepare("UPDATE runs SET logs = logs || ?, updated_at = ? WHERE id = ?")
      .run(logs, updated, runId);
  }

  touchJob(jobId: string): void {
    this.db.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").run(nowIso(), jobId);
  }

  completeJob(jobId: string, summary: string, filesChanged = ""): RunRecord {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }

    const finished = nowIso();
    this.db
      .prepare(
        "UPDATE jobs SET status = 'succeeded', finished_at = ?, updated_at = ?, error = NULL WHERE id = ?"
      )
      .run(finished, finished, jobId);
    this.db
      .prepare(
        "UPDATE runs SET status = 'succeeded', finished_at = ?, updated_at = ?, summary = ?, files_changed = ?, error = NULL WHERE id = ?"
      )
      .run(finished, finished, summary, filesChanged, job.run_id);
    this.db
      .prepare(
        `UPDATE projects
         SET last_worker_run_at = ?,
             last_heartbeat_at = CASE WHEN ? = 'heartbeat' THEN ? ELSE last_heartbeat_at END,
             agent_status = 'idle',
             active_turn_id = NULL,
             last_agent_update_at = ?,
             updated_at = ?
         WHERE slug = ?`
      )
      .run(finished, job.job_type, finished, finished, finished, job.project_slug);
    return this.getRun(job.run_id);
  }

  failJob(jobId: string, status: Extract<RunStatus, "failed" | "interrupted">, error: string): RunRecord {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    const finished = nowIso();
    this.db
      .prepare("UPDATE jobs SET status = ?, finished_at = ?, updated_at = ?, error = ? WHERE id = ?")
      .run(status, finished, finished, error, jobId);
    this.db
      .prepare("UPDATE runs SET status = ?, finished_at = ?, updated_at = ?, error = ? WHERE id = ?")
      .run(status, finished, finished, error, job.run_id);
    this.updateProjectAgentState(job.project_slug, {
      agent_status: status === "failed" ? "failed" : "idle",
      active_turn_id: null,
      last_agent_update_at: finished
    });
    return this.getRun(job.run_id);
  }

  markInterruptedJobs(staleMinutes = 10): number {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
    const jobs = this.db
      .prepare("SELECT id FROM jobs WHERE status = 'running' AND updated_at < ?")
      .all(cutoff) as Array<{ id: string }>;
    for (const job of jobs) {
      this.failJob(job.id, "interrupted", "Worker stopped before the job finished.");
    }
    return jobs.length;
  }

  recordWorkerHeartbeat(workerId: string, currentJobId: string | null = null): WorkerStatus {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO worker_status (id, worker_id, status, last_seen_at, current_job_id, version, updated_at)
         VALUES ('local-worker', ?, 'online', ?, ?, '0.1.0', ?)
         ON CONFLICT(id) DO UPDATE SET
           worker_id = excluded.worker_id,
           status = 'online',
           last_seen_at = excluded.last_seen_at,
           current_job_id = excluded.current_job_id,
           updated_at = excluded.updated_at`
      )
      .run(workerId, now, currentJobId, now);
    return this.getWorkerStatus();
  }

  getWorkerStatus(): WorkerStatus {
    const row = this.db
      .prepare("SELECT * FROM worker_status WHERE id = 'local-worker'")
      .get() as Omit<WorkerStatus, "is_online"> | undefined;
    const now = Date.now();
    const onlineWindowMs = Number(process.env.STARTUP_OS_WORKER_ONLINE_SECONDS ?? "20") * 1000;
    const isOnline = Boolean(row?.last_seen_at && now - Date.parse(row.last_seen_at) < onlineWindowMs);

    if (!row) {
      return {
        id: "local-worker",
        worker_id: "none",
        status: "offline",
        last_seen_at: null,
        current_job_id: null,
        version: "0.1.0",
        updated_at: nowIso(),
        is_online: false
      };
    }

    return {
      ...row,
      status: isOnline ? "online" : "offline",
      is_online: isOnline
    };
  }

  private upsertProject(project: ProjectRecord): void {
    this.db
      .prepare(
        `INSERT INTO projects (
          id, slug, name, path, type, autonomy, status, build_phase, codex_thread_id,
          agent_status, active_turn_id, agent_goal, last_agent_update_at, one_liner, current_now_task,
          created_at, updated_at, last_heartbeat_at, last_worker_run_at, stale_after_hours, auto_queue_when_stale
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          type = excluded.type,
          autonomy = excluded.autonomy,
          status = excluded.status,
          build_phase = excluded.build_phase,
          codex_thread_id = excluded.codex_thread_id,
          agent_status = excluded.agent_status,
          active_turn_id = excluded.active_turn_id,
          agent_goal = excluded.agent_goal,
          last_agent_update_at = excluded.last_agent_update_at,
          one_liner = excluded.one_liner,
          current_now_task = excluded.current_now_task,
          stale_after_hours = excluded.stale_after_hours,
          auto_queue_when_stale = excluded.auto_queue_when_stale,
          updated_at = excluded.updated_at`
      )
      .run(
        project.id,
        project.slug,
        project.name,
        project.path,
        project.type,
        project.autonomy,
        project.status,
        project.build_phase,
        project.codex_thread_id,
        project.agent_status,
        project.active_turn_id,
        project.agent_goal,
        project.last_agent_update_at,
        project.one_liner,
        project.current_now_task,
        project.created_at,
        project.updated_at,
        project.last_heartbeat_at,
        project.last_worker_run_at,
        project.stale_after_hours,
        project.auto_queue_when_stale ? 1 : 0
      );
  }

  private syncRequestsFromQueue(project: ProjectRecord, queue: ParsedQueue): void {
    const now = nowIso();
    const sourceKeys: string[] = [];
    const candidates: Array<{ type: RequestType; title: string; body: string; risk: RequestRecord["risk"] }> = [];

    for (const item of queue.needsJulian.filter((entry) => !entry.done)) {
      if (!shouldSurfaceNeedsJulian(item.text)) {
        continue;
      }
      candidates.push({ type: classifyNeedsJulian(item.text), title: item.text, body: item.text, risk: "medium" });
    }
    for (const item of queue.browserOps.filter((entry) => !entry.done)) {
      if (!shouldSurfaceBrowserOps(item.text)) {
        continue;
      }
      candidates.push({ type: classifyBrowserOps(item.text), title: item.text, body: item.text, risk: "high" });
    }
    for (const item of queue.marketingDrafts.filter((entry) => !entry.done)) {
      if (!shouldSurfaceApproval(item.text)) {
        continue;
      }
      candidates.push({ type: "marketing_approval", title: item.text, body: item.text, risk: "low" });
    }

    for (const candidate of candidates) {
      const sourceKey = `${project.slug}:${candidate.type}:${stableId(candidate.title)}`;
      sourceKeys.push(sourceKey);
      this.db
        .prepare(
          `INSERT INTO requests (
            id, project_id, project_slug, type, title, body, status, risk, source, source_key, thread, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'queue', ?, '', ?, ?)
          ON CONFLICT(source_key) DO UPDATE SET
            title = excluded.title,
            body = excluded.body,
            type = excluded.type,
            risk = excluded.risk,
            status = CASE WHEN requests.status IN ('approved','done','rejected','stale') THEN requests.status ELSE 'open' END,
            updated_at = excluded.updated_at`
        )
        .run(
          randomUUID(),
          project.id,
          project.slug,
          candidate.type,
          candidate.title,
          candidate.body,
          candidate.risk,
          sourceKey,
          now,
          now
        );
    }

    const existing = this.db
      .prepare("SELECT source_key FROM requests WHERE project_slug = ? AND source = 'queue'")
      .all(project.slug) as Array<{ source_key: string }>;

    for (const row of existing) {
      if (row.source_key && !sourceKeys.includes(row.source_key)) {
        this.db
          .prepare("UPDATE requests SET status = 'stale', updated_at = ? WHERE source_key = ? AND status NOT IN ('done','rejected')")
          .run(now, row.source_key);
      }
    }
  }

  private countRequests(types: RequestType[]): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM requests
         WHERE type IN (${types.map(() => "?").join(",")})
         AND status IN (${OPEN_REQUEST_STATUSES.map(() => "?").join(",")})`
      )
      .get(...types, ...OPEN_REQUEST_STATUSES) as { count: number };
    return row.count;
  }

  private countJobs(status: RunStatus): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = ?").get(status) as {
      count: number;
    };
    return row.count;
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function readIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function initializeProjectRepository(projectDir: string): void {
  ensureProjectGitignore(projectDir);
  const logPath = path.join(projectDir, "LOG.md");

  try {
    try {
      runGit(projectDir, ["init", "-b", "main"]);
    } catch {
      runGit(projectDir, ["init"]);
      runGit(projectDir, ["branch", "-M", "main"]);
    }

    runGit(projectDir, ["config", "user.name", "Startup OS"]);
    runGit(projectDir, ["config", "user.email", "startup-os@example.local"]);
    fs.writeFileSync(
      logPath,
      appendLogEntry(readIfExists(logPath), "Initialized local git repository on main for project work."),
      "utf8"
    );

    runGit(projectDir, ["add", "."]);
    const status = runGit(projectDir, ["status", "--porcelain"]);
    if (status.trim()) {
      runGit(projectDir, ["commit", "-m", "Initial project scaffold"]);
    }
  } catch (error) {
    fs.writeFileSync(
      logPath,
      appendLogEntry(readIfExists(logPath), `Git initialization failed: ${formatCommandError(error)}`),
      "utf8"
    );
  }
}

function ensureProjectGitignore(projectDir: string): void {
  const gitignorePath = path.join(projectDir, ".gitignore");
  const additions = [
    "node_modules/",
    "dist/",
    "build/",
    ".DS_Store",
    ".env",
    ".env.*",
    "*.log",
    ".startup-os/prompts/"
  ];
  const existing = readIfExists(gitignorePath);
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = additions.filter((line) => !existingLines.has(line));
  if (!existing.trim()) {
    fs.writeFileSync(gitignorePath, `${additions.join("\n")}\n`, "utf8");
    return;
  }
  if (missing.length) {
    fs.writeFileSync(gitignorePath, `${existing.trimEnd()}\n${missing.join("\n")}\n`, "utf8");
  }
}

function runGit(projectDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function formatCommandError(error: unknown): string {
  if (typeof error === "object" && error && "stderr" in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const value = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr;
    if (value?.trim()) {
      return value.trim().replace(/\s+/g, " ").slice(0, 240);
    }
  }
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : String(error);
}

function assertProjectPathIsSafe(projectPath: string, projectsDir: string): string {
  const root = path.resolve(projectsDir);
  const resolved = path.resolve(projectPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to delete unsafe project path: ${projectPath}`);
  }
  return resolved;
}

function classifyNeedsJulian(text: string): RequestType {
  if (/secret|api key|token/i.test(text)) return "secret_needed";
  if (/captcha/i.test(text)) return "captcha_needed";
  if (/login|2fa|account access/i.test(text)) return "login_needed";
  if (/payment|paid|billing|card/i.test(text)) return "payment_needed";
  if (/deploy|production/i.test(text)) return "deploy_approval";
  if (/review|code review/i.test(text)) return "code_review";
  if (/blocked|blocker/i.test(text)) return "blocked";
  return "needs_julian";
}

function classifyBrowserOps(text: string): RequestType {
  if (/captcha/i.test(text)) return "captcha_needed";
  if (/login|2fa/i.test(text)) return "login_needed";
  if (/payment|billing|card/i.test(text)) return "payment_needed";
  if (/account|signup|sign up/i.test(text)) return "account_setup";
  return "browser_ops";
}

function shouldSurfaceNeedsJulian(text: string): boolean {
  if (/none yet|review the first prototype direction|confirm whether the mvp direction|approve any external side effects before the agent attempts them/i.test(text)) {
    return false;
  }
  return /julian|approve|approval|decide|decision|choose|question|blocked|blocker|secret|api key|token|captcha|login|2fa|payment|paid|billing|deploy|production|dns|domain|account|review/i.test(text);
}

function shouldSurfaceBrowserOps(text: string): boolean {
  if (/none yet|may be needed; queue browser\/ops handoff before use/i.test(text)) {
    return false;
  }
  return /browser|ops|account|signup|sign up|login|captcha|2fa|payment|billing|card|dns|domain|deploy|post|email|service|verification/i.test(text);
}

function shouldSurfaceApproval(text: string): boolean {
  return /approve|approval|review|publish|post|public|deploy|send/i.test(text) && !/draft a plain-language project description/i.test(text);
}

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(",");
}

function normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    build_phase: project.build_phase ?? "initial-build",
    codex_thread_id: project.codex_thread_id ?? null,
    agent_status: normalizeAgentStatus(project.agent_status),
    active_turn_id: project.active_turn_id ?? null,
    agent_goal: project.agent_goal ?? null,
    last_agent_update_at: project.last_agent_update_at ?? null,
    stale_after_hours: Number(project.stale_after_hours ?? 168),
    auto_queue_when_stale: Boolean(project.auto_queue_when_stale)
  };
}

function normalizeAgentStatus(status: ProjectAgentStatus | null | undefined): ProjectAgentStatus {
  return isProjectAgentStatus(status) ? status : "idle";
}

function isProjectAgentStatus(status: string | null | undefined): status is ProjectAgentStatus {
  return Boolean(status && ["idle", "queued", "running", "failed", "blocked"].includes(status));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
