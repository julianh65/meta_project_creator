import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { JobRecord, ProjectRecord, StartupStorage } from "@startup-os/shared";

const workerId = `local-${os.hostname()}-${process.pid}`;
const storage = new StartupStorage();
const pollMs = Number(process.env.STARTUP_OS_WORKER_POLL_MS ?? "2500");
const heartbeatMs = Number(process.env.STARTUP_OS_WORKER_HEARTBEAT_MS ?? "5000");
const jobProgressMs = Math.max(5000, Number(process.env.STARTUP_OS_JOB_PROGRESS_SECONDS ?? "30") * 1000);
let shuttingDown = false;
let currentJobId: string | null = null;

console.log(`Startup OS worker ${workerId} starting`);
const interrupted = storage.markInterruptedJobs(Number(process.env.STARTUP_OS_INTERRUPTED_AFTER_MINUTES ?? "10"));
if (interrupted > 0) {
  console.log(`Marked ${interrupted} stale running job(s) as interrupted`);
}

const heartbeatTimer = setInterval(() => {
  storage.recordWorkerHeartbeat(workerId, currentJobId);
}, heartbeatMs);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void mainLoop();

async function mainLoop(): Promise<void> {
  storage.recordWorkerHeartbeat(workerId);

  while (!shuttingDown) {
    const job = storage.claimNextJob(workerId);
    if (job) {
      currentJobId = job.id;
      await executeJob(job).catch((error: unknown) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        storage.failJob(job.id, "failed", message);
      });
      currentJobId = null;
      storage.recordWorkerHeartbeat(workerId, null);
      continue;
    }
    await sleep(pollMs);
  }
}

async function executeJob(job: JobRecord): Promise<void> {
  const project = storage.getProjectBySlug(job.project_slug);
  if (!project) {
    storage.failJob(job.id, "failed", `Project not found: ${job.project_slug}`);
    return;
  }

  const promptFile = writePromptFile(job);
  const dryRun = shouldDryRun();

  storage.appendRunLogs(
    job.run_id,
    `[worker] Claimed ${job.job_type} job ${job.id}\n` +
      `[worker] Project: ${project.path}\n` +
      `[worker] Manager thread: ${project.codex_thread_id ?? "not started yet"}\n` +
      `[worker] Current task: ${project.current_now_task ?? "No QUEUE.md > Now item found"}\n` +
      `[worker] Plan: send this job as a turn to the persistent project manager thread, then update QUEUE.md and LOG.md.\n` +
      `[worker] Prompt file: ${promptFile}\n`
  );

  if (dryRun) {
    storage.appendRunLogs(
      job.run_id,
      "[worker] Dry-run mode. Set STARTUP_OS_DRY_RUN=false to execute Codex with persistent manager sessions. Set CODEX_COMMAND_TEMPLATE only for a custom command.\n"
    );
    await sleep(350);
    storage.appendRunLogs(job.run_id, "[worker] Progress: dry-run job finished; no Codex command was executed.\n");
    storage.completeJob(
      job.id,
      "Dry run completed. The job was claimed, the prompt was persisted, and no external command was executed."
    );
    return;
  }

  const template = process.env.CODEX_COMMAND_TEMPLATE;
  if (template) {
    const command = renderCommandTemplate(template, {
      prompt: job.prompt,
      promptFile,
      projectPath: project.path
    });

    storage.appendRunLogs(job.run_id, `[worker] Executing custom command: ${command}\n`);
    const result = await runShellCommand(command, project.path, job, (chunk) => {
      storage.appendRunLogs(job.run_id, chunk);
    });

    if (result.code === 0) {
      storage.completeJob(job.id, "Custom command completed successfully. Review project files and run logs for details.");
    } else {
      storage.failJob(job.id, "failed", `Custom command exited with code ${result.code}.`);
    }
    return;
  }

  const result = await runCodexManagerTurn(job, project);
  if (result.code === 0 && !result.failed) {
    storage.completeJob(job.id, result.summary || "Codex manager turn completed successfully.");
    return;
  }
  storage.failJob(job.id, "failed", result.error || `Codex manager exited with code ${result.code}.`);
}

function writePromptFile(job: JobRecord): string {
  fs.mkdirSync(storage.paths.workerPromptDir, { recursive: true });
  const promptFile = path.join(storage.paths.workerPromptDir, `${job.id}.md`);
  fs.writeFileSync(promptFile, job.prompt, "utf8");
  return promptFile;
}

function shouldDryRun(): boolean {
  if (process.env.STARTUP_OS_DRY_RUN === "false") {
    return false;
  }
  if (process.env.STARTUP_OS_DRY_RUN === "true") {
    return true;
  }
  return !process.env.CODEX_COMMAND_TEMPLATE;
}

function renderCommandTemplate(
  template: string,
  values: { prompt: string; promptFile: string; projectPath: string }
): string {
  return template
    .replaceAll("{prompt}", shellQuote(values.prompt))
    .replaceAll("{promptFile}", shellQuote(values.promptFile))
    .replaceAll("{projectPath}", shellQuote(values.projectPath));
}

async function runCodexManagerTurn(
  job: JobRecord,
  project: ProjectRecord
): Promise<{ code: number | null; failed: boolean; summary: string; error: string }> {
  const existingThreadId = project.codex_thread_id;
  const args = buildCodexArgs(existingThreadId);
  const displayCommand = `codex ${args.map(shellDisplay).join(" ")} < prompt`;
  let summary = "";
  let error = "";
  let failed = false;

  storage.appendRunLogs(job.run_id, `[worker] Executing manager turn: ${displayCommand}\n`);

  const result = await runJsonProcess("codex", args, project.path, job, job.prompt, {
    onJson: (event) => {
      const type = typeof event.type === "string" ? event.type : "";

      if (type === "thread.started" && typeof event.thread_id === "string") {
        storage.setProjectCodexThread(project.slug, event.thread_id);
        storage.appendRunLogs(job.run_id, `[codex] manager thread ${event.thread_id}\n`);
        return;
      }

      if (type === "turn.started") {
        storage.updateProjectAgentState(project.slug, {
          agent_status: "running",
          active_turn_id: job.run_id
        });
        storage.appendRunLogs(job.run_id, "[codex] turn started\n");
        return;
      }

      if (type === "turn.completed") {
        storage.updateProjectAgentState(project.slug, {
          agent_status: "idle",
          active_turn_id: null
        });
        const usage = event.usage ? ` usage=${JSON.stringify(event.usage)}` : "";
        storage.appendRunLogs(job.run_id, `[codex] turn completed${usage}\n`);
        return;
      }

      if (type === "turn.failed" || type === "error") {
        failed = true;
        const rawError = event.message ?? event.error;
        error = typeof rawError === "string" ? rawError : JSON.stringify(event);
        storage.updateProjectAgentState(project.slug, {
          agent_status: "failed",
          active_turn_id: null
        });
        storage.appendRunLogs(job.run_id, `[codex] ${type}: ${error}\n`);
        return;
      }

      if (type === "item.started" && event.item) {
        const item = event.item as Record<string, unknown>;
        const itemType = typeof item.type === "string" ? item.type : "item";
        const command = typeof item.command === "string" ? ` ${item.command}` : "";
        storage.appendRunLogs(job.run_id, `[codex] started ${itemType}${command}\n`);
        storage.updateProjectAgentState(project.slug, {
          agent_status: "running"
        });
        return;
      }

      if (type === "item.completed" && event.item) {
        const item = event.item as Record<string, unknown>;
        const itemType = typeof item.type === "string" ? item.type : "item";
        if (itemType === "agent_message" && typeof item.text === "string") {
          summary = item.text.trim();
          storage.appendRunLogs(job.run_id, `[agent]\n${item.text.trim()}\n`);
          return;
        }
        const command = typeof item.command === "string" ? ` ${item.command}` : "";
        const status = typeof item.status === "string" ? ` status=${item.status}` : "";
        storage.appendRunLogs(job.run_id, `[codex] completed ${itemType}${command}${status}\n`);
        return;
      }

      if (type === "turn.plan.updated" || type === "item.plan.delta") {
        storage.appendRunLogs(job.run_id, `[codex] ${type}: ${JSON.stringify(event.params ?? event)}\n`);
      }
    },
    onText: (chunk) => {
      storage.appendRunLogs(job.run_id, chunk);
    }
  });

  return {
    code: result.code,
    failed,
    summary,
    error
  };
}

function buildCodexArgs(threadId: string | null): string[] {
  const args: string[] = [];
  const approvalPolicy = process.env.STARTUP_OS_CODEX_APPROVAL_POLICY ?? "never";
  args.push("-c", `approval_policy="${approvalPolicy}"`);

  if (threadId) {
    args.push("exec", "resume");
    appendCodexExecOptions(args);
    args.push(threadId, "-");
  } else {
    args.push("exec");
    appendCodexExecOptions(args);
    args.push("-");
  }

  return args;
}

function appendCodexExecOptions(args: string[]): void {
  args.push("--json", "--skip-git-repo-check");
  const model = process.env.STARTUP_OS_CODEX_MODEL;
  if (model) {
    args.push("--model", model);
  }
  if (process.env.STARTUP_OS_CODEX_BYPASS_SANDBOX === "true") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
    return;
  }
  args.push("--sandbox", process.env.STARTUP_OS_CODEX_SANDBOX ?? "workspace-write");
}

function shellDisplay(value: string): string {
  return /[\s'"$]/.test(value) ? shellQuote(value) : value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runShellCommand(
  command: string,
  cwd: string,
  job: JobRecord,
  onOutput: (chunk: string) => void
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const progressTimer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      storage.touchJob(job.id);
      storage.recordWorkerHeartbeat(workerId, job.id);
      onOutput(`[worker] Still running ${job.job_type} job after ${elapsedSeconds}s. Waiting for command output or completion.\n`);
    }, jobProgressMs);

    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    });

    child.stdout.on("data", (data: Buffer) => onOutput(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput(data.toString()));
    child.on("close", (code) => {
      clearInterval(progressTimer);
      storage.touchJob(job.id);
      resolve({ code });
    });
  });
}

function runJsonProcess(
  program: string,
  args: string[],
  cwd: string,
  job: JobRecord,
  stdin: string,
  handlers: { onJson: (event: Record<string, unknown>) => void; onText: (chunk: string) => void }
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const progressTimer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      storage.touchJob(job.id);
      storage.recordWorkerHeartbeat(workerId, job.id);
      storage.updateProjectAgentState(job.project_slug, {
        agent_status: "running"
      });
      handlers.onText(`[worker] Still running ${job.job_type} manager turn after ${elapsedSeconds}s. Waiting for Codex events or completion.\n`);
    }, jobProgressMs);

    const child = spawn(program, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      try {
        handlers.onJson(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        handlers.onText(`${line}\n`);
      }
    });

    child.stderr.on("data", (data: Buffer) => handlers.onText(data.toString()));
    child.on("error", (error) => {
      clearInterval(progressTimer);
      handlers.onText(`[worker] Failed to start ${program}: ${error.message}\n`);
      resolve({ code: 1 });
    });
    child.on("close", (code) => {
      clearInterval(progressTimer);
      storage.touchJob(job.id);
      resolve({ code });
    });
    child.stdin.end(stdin);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(): void {
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  storage.recordWorkerHeartbeat(workerId, currentJobId);
  storage.close();
  process.exit(0);
}
