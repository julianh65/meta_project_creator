import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateProjectDraft } from "./templates";

describe("project onboarding templates", () => {
  it("generates the four durable project files from a messy prompt", () => {
    const draft = generateProjectDraft({
      rawPrompt:
        "Car talking agent, podcast maker, ask questions, add todos, all in one. Commute enhancer. Basically make dead time during commutes better.",
      name: "Commute Agent"
    });

    assert.equal(draft.proposal.slug, "commute-agent");
    assert.equal(draft.proposal.type, "mobile-expo");
    assert.deepEqual(Object.keys(draft.files).sort(), ["AGENTS.md", "LOG.md", "PROJECT.md", "QUEUE.md"]);
    assert.match(draft.files["PROJECT.md"], /## Original intent/);
    assert.match(draft.files["PROJECT.md"], /## Build phase\s+initial-build/s);
    assert.match(draft.files["PROJECT.md"], /## Codex manager thread\s+Not started yet\./s);
    assert.match(draft.files["PROJECT.md"], /## Work cadence/);
    assert.match(draft.files["PROJECT.md"], /## Local preview/);
    assert.match(draft.files["PROJECT.md"], /## Initialization/);
    assert.match(draft.files["AGENTS.md"], /## Mobile \/ Expo Policy/);
    assert.match(draft.files["AGENTS.md"], /## Local Preview Contract/);
    assert.match(draft.files["QUEUE.md"], /## Browser\/Ops Requests/);
  });
});
