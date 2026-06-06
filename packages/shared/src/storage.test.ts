import fs from "node:fs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { appendQueueItem, createAppPaths, generateProjectDraft, StartupStorage } from "./index";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempStorage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "startup-os-test-"));
  roots.push(root);
  return new StartupStorage(createAppPaths(root));
}

describe("StartupStorage", () => {
  it("creates a project folder, syncs requests from QUEUE.md, and edits durable files", () => {
    const storage = tempStorage();
    const draft = generateProjectDraft({
      rawPrompt: "A web app that needs a login later and a plain local prototype first.",
      name: "Local Login Demo",
      type: "web"
    });

    const project = storage.createProjectFromDraft(draft);
    assert.equal(project.slug, "local-login-demo");
    assert.equal(fs.existsSync(path.join(project.path, "AGENTS.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "PROJECT.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "QUEUE.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "LOG.md")), true);

    const detail = storage.getProjectDetail(project.slug);
    assert.match(detail?.queue.now[0]?.text ?? "", /web prototype/);
    assert.equal(detail?.requests.some((request) => request.type === "needs_julian"), true);

    storage.updateProjectFile(
      project.slug,
      "QUEUE.md",
      appendQueueItem(detail!.files["QUEUE.md"], "browserOps", "Set up a test account")
    );
    const requests = storage.listRequests({ projectSlug: project.slug, includeDone: true });
    assert.equal(requests.some((request) => request.type === "account_setup"), true);

    const feedbackRun = storage.addFeedback(project.slug, "Make the local demo before touching auth.");
    const afterFeedback = storage.getProjectDetail(project.slug);
    assert.equal(feedbackRun.run_type, "feedback");
    assert.equal(afterFeedback?.queue.now.some((item) => item.text.includes("Make the local demo")), true);
    storage.close();
  });

  it("persists heartbeat job state transitions", () => {
    const storage = tempStorage();
    const draft = generateProjectDraft({ rawPrompt: "A tiny CLI for trying repo experiments.", name: "Repo Runner", type: "cli" });
    const project = storage.createProjectFromDraft(draft);
    const run = storage.enqueueHeartbeat(project.slug);
    const job = storage.claimNextJob("test-worker");

    assert.equal(run.status, "queued");
    assert.equal(job?.status, "running");
    assert.equal(job?.run_id, run.id);

    storage.appendRunLogs(run.id, "hello logs\n");
    const completed = storage.completeJob(job!.id, "Dry run complete.");

    assert.equal(completed.status, "succeeded");
    assert.match(completed.logs, /hello logs/);
    assert.ok(storage.getProjectBySlug(project.slug)?.last_heartbeat_at);
    storage.close();
  });
});
