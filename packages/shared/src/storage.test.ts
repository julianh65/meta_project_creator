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
    assert.equal(project.build_phase, "initial-build");
    assert.equal(project.agent_status, "idle");
    assert.equal(project.codex_thread_id, null);
    assert.equal(fs.existsSync(path.join(project.path, "AGENTS.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "PROJECT.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "QUEUE.md")), true);
    assert.equal(fs.existsSync(path.join(project.path, "LOG.md")), true);

    const detail = storage.getProjectDetail(project.slug);
    assert.match(detail?.queue.now[0]?.text ?? "", /web prototype/);
    assert.equal(detail?.requests.some((request) => request.title.includes("external side effects")), false);

    storage.updateProjectFile(
      project.slug,
      "QUEUE.md",
      appendQueueItem(
        appendQueueItem(detail!.files["QUEUE.md"], "browserOps", "Set up a test account"),
        "needsJulian",
        "Julian decide whether auth should be fake or real."
      )
    );
    const requests = storage.listRequests({ projectSlug: project.slug, includeDone: true });
    assert.equal(requests.some((request) => request.type === "account_setup"), true);

    const accountRequest = requests.find((request) => request.type === "account_setup");
    assert.ok(accountRequest);
    storage.updateRequestStatus(accountRequest.id, "approved");
    storage.syncProjectFromFiles(project.slug);
    assert.equal(
      storage.listRequests({ projectSlug: project.slug }).some((request) => request.id === accountRequest.id),
      false
    );

    const needsJulian = storage.listRequests({ projectSlug: project.slug }).find((request) => request.type === "needs_julian");
    assert.ok(needsJulian);
    const responded = storage.respondToRequest(needsJulian.id, "Build the fake local flow first.");
    const afterResponse = storage.getProjectDetail(project.slug);
    assert.equal(responded.status, "done");
    assert.match(responded.thread, /Build the fake local flow first/);
    assert.equal(afterResponse?.queue.now.some((item) => item.text.includes("Build the fake local flow first")), true);
    assert.equal(afterResponse?.runs.some((run) => run.run_type === "feedback"), true);

    const feedbackRun = storage.addFeedback(project.slug, "Make the local demo before touching auth.");
    const afterFeedback = storage.getProjectDetail(project.slug);
    assert.equal(feedbackRun.run_type, "feedback");
    assert.equal(afterFeedback?.queue.now.some((item) => item.text.includes("Make the local demo")), true);
    storage.close();
  });

  it("keeps generic project creation out of the inbox", () => {
    const storage = tempStorage();
    const draft = generateProjectDraft({
      rawPrompt: "A throwaway web prototype for sketching a local idea with no external services.",
      name: "Quiet Prototype",
      type: "web"
    });
    const project = storage.createProjectFromDraft(draft);

    assert.equal(storage.listRequests({ projectSlug: project.slug, includeDone: true }).length, 0);
    storage.close();
  });

  it("persists heartbeat job state transitions", () => {
    const storage = tempStorage();
    const draft = generateProjectDraft({ rawPrompt: "A tiny CLI for trying repo experiments.", name: "Repo Runner", type: "cli" });
    const project = storage.createProjectFromDraft(draft);
    const run = storage.enqueueHeartbeat(project.slug);
    assert.equal(storage.getProjectBySlug(project.slug)?.agent_status, "queued");
    const job = storage.claimNextJob("test-worker");

    assert.equal(run.status, "queued");
    assert.equal(job?.status, "running");
    assert.equal(job?.run_id, run.id);
    assert.equal(storage.getProjectBySlug(project.slug)?.agent_status, "running");

    storage.appendRunLogs(run.id, "hello logs\n");
    const completed = storage.completeJob(job!.id, "Dry run complete.");

    assert.equal(completed.status, "succeeded");
    assert.match(completed.logs, /hello logs/);
    assert.equal(storage.getProjectBySlug(project.slug)?.agent_status, "idle");
    assert.ok(storage.getProjectBySlug(project.slug)?.last_heartbeat_at);
    storage.close();
  });

  it("stores a persistent Codex manager thread and resume command", () => {
    const storage = tempStorage();
    const draft = generateProjectDraft({ rawPrompt: "A tiny web app for explaining papers.", name: "Paper Explainer", type: "web" });
    const project = storage.createProjectFromDraft(draft);
    const threadId = "0199a213-81c0-7800-8aa1-bbab2a035a53";

    storage.setProjectCodexThread(project.slug, threadId);
    const detail = storage.getProjectDetail(project.slug);

    assert.equal(detail?.codex_thread_id, threadId);
    assert.match(detail?.files["PROJECT.md"] ?? "", new RegExp(threadId));
    assert.match(detail?.managerCommand ?? "", new RegExp(`codex resume --include-non-interactive ${threadId}`));
    assert.match(detail?.managerExecCommand ?? "", new RegExp(`codex exec resume ${threadId}`));
    storage.close();
  });
});
