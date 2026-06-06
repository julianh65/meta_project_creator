import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendLogEntry, appendQueueItem, parseQueue, slugify } from "./markdown";

describe("markdown helpers", () => {
  it("parses durable queue sections", () => {
    const queue = parseQueue(`# Queue

## Now

- [ ] Build the first screen
- [x] Pick a name

## Needs Julian

- [ ] Approve account setup

## Browser/Ops Requests

- [ ] Create a test account
`);

    assert.equal(queue.now.length, 2);
    assert.equal(queue.now[0]?.text, "Build the first screen");
    assert.equal(queue.now[1]?.done, true);
    assert.equal(queue.needsJulian[0]?.text, "Approve account setup");
    assert.equal(queue.browserOps[0]?.text, "Create a test account");
  });

  it("appends queue and log entries without creating extra files", () => {
    const queue = appendQueueItem("# Queue\n\n## Now\n\n- [ ] Existing\n", "needsJulian", "Pick a direction");
    const log = appendLogEntry("# Log\n", "Created first artifact.", "2026-06-06");

    assert.match(queue, /## Needs Julian/);
    assert.match(queue, /- \[ \] Pick a direction/);
    assert.match(log, /## 2026-06-06/);
    assert.match(log, /- Created first artifact\./);
  });

  it("creates stable lowercase slugs", () => {
    assert.equal(slugify("Paper -> Explainer Blog Post with Manim"), "paper-explainer-blog-post-with-manim");
  });
});
