import cors from "cors";
import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  allowedProjectFile,
  generateProjectDraft,
  PROJECT_TYPES,
  AUTONOMY_LEVELS,
  REQUEST_STATUSES,
  StartupStorage
} from "@startup-os/shared";

const app = express();
const port = Number(process.env.STARTUP_OS_API_PORT ?? "4401");
const storage = new StartupStorage();

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
    runFirstHeartbeat: parsed.runFirstHeartbeat
  });
  res.status(201).json(project);
});

app.get("/api/projects/:slug", (req, res) => {
  const detail = storage.getProjectDetail(req.params.slug);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(detail);
});

app.post("/api/projects/:slug/heartbeat", (req, res) => {
  res.status(201).json(storage.enqueueHeartbeat(req.params.slug));
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
