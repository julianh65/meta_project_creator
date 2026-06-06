import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  allowedProjectFile,
  generateProjectDraft,
  PROJECT_TYPES,
  PROJECT_PHASES,
  AUTONOMY_LEVELS,
  REQUEST_STATUSES,
  StartupStorage,
  type ProjectDetail,
  type ProjectPreviewInfo,
  type ProjectPreviewStatus
} from "@startup-os/shared";

const app = express();
const port = Number(process.env.STARTUP_OS_API_PORT ?? "4401");
const storage = new StartupStorage();

type ManagedPreview = ProjectPreviewInfo & {
  child: ChildProcessWithoutNullStreams | null;
};

const previews = new Map<string, ManagedPreview>();
const maxPreviewLogLength = 12000;

app.use(cors());
app.use(express.json({ limit: "4mb" }));

const proposalSchema = z.object({
  rawPrompt: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(PROJECT_TYPES).or(z.literal("")).optional(),
  autonomy: z.enum(AUTONOMY_LEVELS).or(z.literal("")).optional(),
  preferredStack: z.string().optional(),
  thingsToAvoid: z.string().optional(),
  vibeNotes: z.string().optional()
});

const createProjectSchema = z.object({
  draft: z.object({
    proposal: z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      oneLiner: z.string(),
      type: z.enum(PROJECT_TYPES),
      autonomy: z.enum(AUTONOMY_LEVELS),
      preferredStack: z.string(),
      targetUser: z.string(),
      mvp: z.string(),
      nonGoals: z.array(z.string()),
      firstTask: z.string(),
      needsJulian: z.array(z.string()),
      externalDependencies: z.object({
        neededNow: z.array(z.string()),
        neededSoon: z.array(z.string()),
        defer: z.array(z.string())
      }),
      styleNotes: z.string()
    }),
    files: z.record(z.string())
  }),
  scaffold: z.boolean().optional(),
  runInitialBuild: z.boolean().optional(),
  runFirstHeartbeat: z.boolean().optional()
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/sync", (_req, res) => {
  res.json({ projects: storage.syncProjectsFromFiles() });
});

app.get("/api/summary", (_req, res) => {
  res.json(storage.getDashboardSummary());
});

app.get("/api/worker", (_req, res) => {
  res.json(storage.getWorkerStatus());
});

app.get("/api/projects", (_req, res) => {
  res.json(storage.listProjects());
});

app.post("/api/projects/proposal", (req, res) => {
  const parsed = proposalSchema.parse(req.body);
  res.json(generateProjectDraft(parsed));
});

app.post("/api/projects", (req, res) => {
  const parsed = createProjectSchema.parse(req.body);
  const project = storage.createProjectFromDraft(parsed.draft, {
    scaffold: parsed.scaffold,
    runInitialBuild: parsed.runInitialBuild,
    runFirstHeartbeat: parsed.runFirstHeartbeat
  });
  res.status(201).json(project);
});

app.delete("/api/projects/:slug", (req, res) => {
  const parsed = z.object({ confirmSlug: z.string().min(1) }).parse(req.body);
  res.json(storage.deleteThrowawayProject(req.params.slug, parsed.confirmSlug));
});

app.get("/api/projects/:slug", (req, res) => {
  const detail = storage.getProjectDetail(req.params.slug);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(detail);
});

app.get("/api/projects/:slug/preview", async (req, res, next) => {
  try {
    const detail = storage.getProjectDetail(req.params.slug);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(await getPreviewInfo(detail));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:slug/preview/start", async (req, res, next) => {
  try {
    const detail = storage.getProjectDetail(req.params.slug);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.status(201).json(await startProjectPreview(detail));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:slug/preview/stop", (req, res, next) => {
  try {
    const detail = storage.getProjectDetail(req.params.slug);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(stopProjectPreview(detail));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:slug/heartbeat", (req, res) => {
  res.status(201).json(storage.enqueueHeartbeat(req.params.slug));
});

app.post("/api/projects/:slug/initial-build", (req, res) => {
  res.status(201).json(storage.enqueueInitialBuild(req.params.slug));
});

app.patch("/api/projects/:slug/phase", (req, res) => {
  const parsed = z.object({ phase: z.enum(PROJECT_PHASES) }).parse(req.body);
  const project = storage.updateProjectPhase(req.params.slug, parsed.phase);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

app.post("/api/projects/:slug/feedback", (req, res) => {
  const parsed = z.object({ feedback: z.string().min(1) }).parse(req.body);
  res.status(201).json(storage.addFeedback(req.params.slug, parsed.feedback));
});

app.post("/api/projects/:slug/open-folder", (req, res) => {
  const project = storage.getProjectBySlug(req.params.slug);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const child = spawn("open", [project.path], { stdio: "ignore", detached: true });
  child.unref();
  res.json({ ok: true, path: project.path });
});

app.get("/api/projects/:slug/files/:file", (req, res) => {
  const fileName = req.params.file;
  if (!allowedProjectFile(fileName)) {
    res.status(400).json({ error: "Unsupported project file" });
    return;
  }
  res.json({ fileName, content: storage.getProjectFile(req.params.slug, fileName) });
});

app.put("/api/projects/:slug/files/:file", (req, res) => {
  const fileName = req.params.file;
  if (!allowedProjectFile(fileName)) {
    res.status(400).json({ error: "Unsupported project file" });
    return;
  }
  const parsed = z.object({ content: z.string() }).parse(req.body);
  res.json(storage.updateProjectFile(req.params.slug, fileName, parsed.content));
});

app.get("/api/inbox", (req, res) => {
  storage.syncProjectsFromFiles();
  const typesParam = typeof req.query.types === "string" ? req.query.types : "";
  const types = typesParam ? typesParam.split(",") : undefined;
  res.json(storage.listRequests({ types: types as never, includeDone: req.query.includeDone === "true" }));
});

app.get("/api/ops", (_req, res) => {
  storage.syncProjectsFromFiles();
  res.json(
    storage.listRequests({
      types: ["browser_ops", "account_setup", "captcha_needed", "login_needed", "payment_needed"],
      includeDone: true
    })
  );
});

app.get("/api/runs", (req, res) => {
  const projectSlug = typeof req.query.project === "string" ? req.query.project : undefined;
  res.json(storage.listRuns(100, projectSlug));
});

app.get("/api/jobs", (req, res) => {
  const projectSlug = typeof req.query.project === "string" ? req.query.project : undefined;
  const includeFinished = req.query.includeFinished === "true";
  res.json(storage.listJobs({ projectSlug, includeFinished, limit: 100 }));
});

app.patch("/api/requests/:id", (req, res) => {
  const parsed = z.object({ status: z.enum(REQUEST_STATUSES) }).parse(req.body);
  res.json(storage.updateRequestStatus(req.params.id, parsed.status));
});

app.post("/api/requests/:id/respond", (req, res) => {
  const parsed = z.object({ response: z.string().min(1) }).parse(req.body);
  res.json(storage.respondToRequest(req.params.id, parsed.response));
});

async function getPreviewInfo(detail: ProjectDetail): Promise<ProjectPreviewInfo> {
  const plan = buildPreviewPlan(detail);
  const existing = previews.get(detail.slug);
  if (existing) {
    existing.command = plan.command;
    existing.instructions = plan.instructions;
    existing.url = existing.url ?? plan.url;
    return serializePreview(existing);
  }

  const reachable = plan.url ? await isLocalUrlReachable(plan.url) : false;
  return {
    slug: detail.slug,
    status: plan.command ? (reachable ? "running" : "idle") : "unavailable",
    command: plan.command,
    url: plan.url,
    managed: false,
    pid: null,
    started_at: null,
    updated_at: new Date().toISOString(),
    instructions: plan.instructions,
    logs: reachable ? `[preview] Existing local server responded at ${plan.url}\n` : ""
  };
}

async function startProjectPreview(detail: ProjectDetail): Promise<ProjectPreviewInfo> {
  const plan = buildPreviewPlan(detail);
  if (!plan.command) {
    throw new Error("No local preview command found. Add a package.json script or PROJECT.md local preview instructions.");
  }

  const existing = previews.get(detail.slug);
  if (existing?.child && ["starting", "running"].includes(existing.status)) {
    return serializePreview(existing);
  }

  if (plan.url && await isLocalUrlReachable(plan.url)) {
    const updated = new Date().toISOString();
    const info: ManagedPreview = {
      slug: detail.slug,
      status: "running",
      command: plan.command,
      url: plan.url,
      managed: false,
      pid: null,
      started_at: null,
      updated_at: updated,
      instructions: plan.instructions,
      logs: `[preview] Existing local server responded at ${plan.url}\n`,
      child: null
    };
    previews.set(detail.slug, info);
    return serializePreview(info);
  }

  const startedAt = new Date().toISOString();
  const info: ManagedPreview = {
    slug: detail.slug,
    status: "starting",
    command: plan.command,
    url: plan.url,
    managed: true,
    pid: null,
    started_at: startedAt,
    updated_at: startedAt,
    instructions: plan.instructions,
    logs: `[preview] Starting ${plan.command}\n[preview] cwd ${detail.path}\n`,
    child: null
  };

  const child = spawn(plan.command, {
    cwd: detail.path,
    shell: true,
    env: {
      ...process.env,
      BROWSER: "none",
      HOST: "127.0.0.1"
    }
  });
  info.child = child;
  info.pid = child.pid ?? null;
  previews.set(detail.slug, info);

  const onOutput = (chunk: Buffer) => {
    appendPreviewLog(info, chunk.toString());
    const discoveredUrl = firstLocalUrl(chunk.toString());
    if (discoveredUrl) {
      info.url = discoveredUrl;
      setPreviewStatus(info, "running");
    }
  };

  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);
  child.on("error", (error) => {
    appendPreviewLog(info, `[preview] Failed to start preview: ${error.message}\n`);
    setPreviewStatus(info, "failed");
    info.child = null;
    info.pid = null;
  });
  child.on("close", (code) => {
    appendPreviewLog(info, `[preview] Process exited with code ${code ?? "unknown"}\n`);
    setPreviewStatus(info, code === 0 ? "stopped" : "failed");
    info.child = null;
    info.pid = null;
  });

  setTimeout(() => {
    if (info.child && info.status === "starting") {
      setPreviewStatus(info, "running");
    }
  }, 1800);

  return serializePreview(info);
}

function stopProjectPreview(detail: ProjectDetail): ProjectPreviewInfo {
  const plan = buildPreviewPlan(detail);
  const existing = previews.get(detail.slug);
  if (!existing) {
    return {
      slug: detail.slug,
      status: plan.command ? "idle" : "unavailable",
      command: plan.command,
      url: plan.url,
      managed: false,
      pid: null,
      started_at: null,
      updated_at: new Date().toISOString(),
      instructions: plan.instructions,
      logs: ""
    };
  }

  if (existing.child) {
    existing.child.kill("SIGTERM");
  }
  existing.child = null;
  existing.pid = null;
  existing.managed = false;
  setPreviewStatus(existing, "stopped");
  appendPreviewLog(existing, "[preview] Stopped from dashboard.\n");
  return serializePreview(existing);
}

function buildPreviewPlan(detail: ProjectDetail): Pick<ProjectPreviewInfo, "command" | "url" | "instructions"> {
  const projectMd = detail.files["PROJECT.md"] ?? "";
  const packageJson = readPackageJson(detail.path);
  const command = inferPreviewCommand(packageJson);
  const scriptText = packageJson ? Object.values(packageJson.scripts ?? {}).join(" ") : "";
  const url = firstLocalUrl(projectMd) || (/\bvite\b/i.test(scriptText) ? "http://127.0.0.1:5173" : null);
  const instructions = previewInstructions(detail, command, url);

  return { command, url, instructions };
}

function readPackageJson(projectPath: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  const filePath = path.join(projectPath, "package.json");
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  } catch {
    return null;
  }
}

function inferPreviewCommand(packageJson: { scripts?: Record<string, string> } | null): string | null {
  const scripts = packageJson?.scripts ?? {};
  const scriptName = ["dev", "web", "preview", "start"].find((candidate) => scripts[candidate]);
  return scriptName ? `npm run ${scriptName}` : null;
}

function previewInstructions(detail: ProjectDetail, command: string | null, url: string | null): string[] {
  const markdown = detail.files["PROJECT.md"] ?? "";
  const localPreview = markdownSection(markdown, "Local preview");
  const currentState = markdownSection(markdown, "Current state");
  const extracted = [...inlineCodeValues(localPreview || currentState), ...localUrls(localPreview || currentState)];
  const defaults = [
    command ? `cd ${detail.path} && ${command}` : "",
    url ?? ""
  ].filter(Boolean);
  const seen = new Set<string>();
  return [...extracted, ...defaults]
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, 6);
}

function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return "";
  }
  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) {
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function inlineCodeValues(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

function localUrls(value: string): string[] {
  return [...value.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s)]*/g)].map((match) => match[0]);
}

function firstLocalUrl(value: string): string | null {
  return localUrls(value)[0] ?? null;
}

async function isLocalUrlReachable(url: string): Promise<boolean> {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i.test(url)) {
    return false;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function appendPreviewLog(info: ManagedPreview, chunk: string): void {
  info.logs = `${info.logs}${chunk}`.slice(-maxPreviewLogLength);
  info.updated_at = new Date().toISOString();
}

function setPreviewStatus(info: ManagedPreview, status: ProjectPreviewStatus): void {
  info.status = status;
  info.updated_at = new Date().toISOString();
}

function serializePreview(info: ManagedPreview): ProjectPreviewInfo {
  return {
    slug: info.slug,
    status: info.status,
    command: info.command,
    url: info.url,
    managed: info.managed,
    pid: info.pid,
    started_at: info.started_at,
    updated_at: info.updated_at,
    instructions: info.instructions,
    logs: info.logs
  };
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(400).json({ error: message });
});

if (process.env.STARTUP_OS_SERVE_STATIC === "true") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(__dirname, "../../../dist/dashboard");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Startup OS API listening on http://127.0.0.1:${port}`);
});
