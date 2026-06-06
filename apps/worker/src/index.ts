import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobRecord, StartupStorage } from "@startup-os/shared";

const workerId = `local-${os.hostname()}-${process.pid}`;
const storage = new StartupStorage();
const pollMs = Number(process.env.STARTUP_OS_WORKER_POLL_MS ?? "2500");
const heartbeatMs = Number(process.env.STARTUP_OS_WORKER_HEARTBEAT_MS ?? "5000");
let shuttingDown = false;

console.log(`Startup OS worker ${workerId} starting`);
const interrupted = storage.markInterruptedJobs(Number(process.env.STARTUP_OS_INTERRUPTED_AFTER_MINUTES ?? "10"));
if (interrupted > 0) {
  console.log(`Marked ${interrupted} stale running job(s) as interrupted`);
}

const heartbeatTimer = setInterval(() => {
  storage.recordWorkerHeartbeat(workerId);
}, heartbeatMs);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void mainLoop();

async function mainLoop(): Promise<void> {
  storage.recordWorkerHeartbeat(workerId);

  while (!shuttingDown) {
    const job = storage.claimNextJob(workerId);
    if (job) {
      await executeJob(job).catch((error: unknown) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        storage.failJob(job.id, "failed", message);
      });
      storage.recordWorkerHeartbeat(workerId);
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
    `[worker] Claimed ${job.job_type} job ${job.id}\n[worker] Project: ${project.path}\n[worker] Prompt file: ${promptFile}\n`
  );

  if (dryRun) {
    storage.appendRunLogs(
      job.run_id,
      "[worker] Dry-run mode. Set STARTUP_OS_DRY_RUN=false and CODEX_COMMAND_TEMPLATE to execute Codex.\n"
    );
    await sleep(350);
    storage.completeJob(
      job.id,
      "Dry run completed. The job was claimed, the prompt was persisted, and no external command was executed."
    );
    return;
  }

  const template = process.env.CODEX_COMMAND_TEMPLATE || "codex {prompt}";
  const command = renderCommandTemplate(template, {
    prompt: job.prompt,
    promptFile,
    projectPath: project.path
  });

  storage.appendRunLogs(job.run_id, `[worker] Executing: ${command}\n`);
  const result = await runShellCommand(command, project.path, (chunk) => {
    storage.appendRunLogs(job.run_id, chunk);
  });

  if (result.code === 0) {
    storage.completeJob(job.id, "Command completed successfully. Review project files and run logs for details.");
  } else {
    storage.failJob(job.id, "failed", `Command exited with code ${result.code}.`);
  }
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runShellCommand(
  command: string,
  cwd: string,
  onOutput: (chunk: string) => void
): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    });

    child.stdout.on("data", (data: Buffer) => onOutput(data.toString()));
    child.stderr.on("data", (data: Buffer) => onOutput(data.toString()));
    child.on("close", (code) => resolve({ code }));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(): void {
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  storage.recordWorkerHeartbeat(workerId);
  storage.close();
  process.exit(0);
}
