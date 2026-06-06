import fs from "node:fs";
import path from "node:path";
import { appendLogEntry, slugify, titleCase, todaySlug } from "./markdown";
import {
  AutonomyLevel,
  ProjectDraft,
  ProjectDraftInput,
  ProjectFileName,
  ProjectProposal,
  ProjectType
} from "./types";

export const HEARTBEAT_PROMPT = `Read AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md.

You are the persistent manager thread for this project. Keep this conversation focused on durable project direction, decisions, progress updates, and the final result of each work cycle.

Run one autonomous working-phase cycle.

If QUEUE.md has a Now item, work on it.
Otherwise choose a useful next task for the MVP.

At the start, write a short update with:
- what task you are taking
- what you plan to change
- what check you expect to run

Use this status format whenever you start or finish a meaningful step:

STATUS:
- doing: <current action>
- done: <recently completed work>
- next: <next step>
- blocked: <none or blocker>

If the work takes a while, print brief progress updates as you finish meaningful steps.

You may edit code, run commands, inspect the local UI, use search/browser tools if available, update project files, and spawn subagents for bounded exploration, implementation, testing, or review. Keep write-heavy subagent work coordinated and summarize subagent results instead of dumping raw logs.

Keep the change scoped and useful. Prefer something demonstrable.

If you need Julian or external side effects, write to QUEUE.md instead of blocking silently.

After work, update QUEUE.md and LOG.md. Summarize what changed.`;

export const INITIAL_BUILD_PROMPT = `Read AGENTS.md, PROJECT.md, QUEUE.md, and LOG.md.

This project is in the initial-build phase.

You are the persistent manager thread for this project. Keep this conversation focused on durable project direction, decisions, progress updates, and the final result of each work cycle.

Your goal is to create the first demonstrable local prototype. Focus on the smallest useful version Julian can open, inspect, and react to.

At the start, write a short update with:
- what you understand the product should become
- the first build task you are taking
- what you plan to change
- what check you expect to run

Use this status format whenever you start or finish a meaningful step:

STATUS:
- doing: <current action>
- done: <recently completed work>
- next: <next step>
- blocked: <none or blocker>

Work on the current QUEUE.md > Now item first. If it is too vague, turn it into concrete local implementation steps and start the first one.

Avoid production auth, paid services, real accounts, public posting, deployments, billing, DNS, secrets, or other external side effects during the initial build. Use local mocks, placeholders, fixtures, or deferred Browser/Ops requests instead.

You may spawn subagents for bounded exploration, implementation, testing, or review when it will make the initial build faster or clearer. Keep write-heavy subagent work coordinated and summarize subagent results instead of dumping raw logs.

If work takes a while, print brief progress updates after meaningful steps so the dashboard run log shows what is happening.

When the first local demo works, update PROJECT.md:
- set Build phase to working
- update Current state with what exists and how to run or view it
- capture any important decisions

After work, update QUEUE.md and LOG.md. Summarize what changed, what was checked, and what should happen next.`;

export function generateProjectDraft(input: ProjectDraftInput): ProjectDraft {
  const rawPrompt = input.rawPrompt.trim();
  const name = cleanName(input.name) || inferName(rawPrompt);
  const type = input.type || inferProjectType(rawPrompt, input.preferredStack);
  const autonomy = input.autonomy || inferAutonomy(rawPrompt);
  const oneLiner = inferOneLiner(rawPrompt, name);
  const preferredStack = input.preferredStack?.trim() || defaultStack(type);
  const firstTask = inferFirstTask(type, oneLiner);
  const externalDependencies = inferExternalDependencies(rawPrompt, type);
  const needsJulian = inferNeedsJulian(rawPrompt, externalDependencies.neededNow);
  const styleNotes = input.vibeNotes?.trim() || inferStyleNotes(rawPrompt, type);

  const proposal: ProjectProposal = {
    name,
    slug: slugify(name),
    oneLiner,
    type,
    autonomy,
    preferredStack,
    targetUser: inferTargetUser(rawPrompt),
    mvp: inferMvp(rawPrompt, type, oneLiner),
    nonGoals: inferNonGoals(rawPrompt, input.thingsToAvoid),
    firstTask,
    needsJulian,
    externalDependencies,
    styleNotes
  };

  return {
    proposal,
    files: generateProjectFiles(proposal, rawPrompt)
  };
}

export function generateProjectFiles(
  proposal: ProjectProposal,
  rawPrompt: string
): Record<ProjectFileName, string> {
  return {
    "AGENTS.md": renderAgentsMd(proposal),
    "PROJECT.md": renderProjectMd(proposal, rawPrompt),
    "QUEUE.md": renderQueueMd(proposal),
    "LOG.md": renderLogMd()
  };
}

export function createScaffold(projectDir: string, type: ProjectType, name: string): void {
  switch (type) {
    case "web":
      createWebScaffold(projectDir, name);
      break;
    case "mobile-expo":
      createExpoScaffold(projectDir, name);
      break;
    case "browser-extension":
      createExtensionScaffold(projectDir, name);
      break;
    case "cli":
      createCliScaffold(projectDir, name);
      break;
    case "research":
    case "content":
    case "unknown":
      createNotesScaffold(projectDir);
      break;
  }
}

function renderProjectMd(proposal: ProjectProposal, rawPrompt: string): string {
  return `# Project

## Name

${proposal.name}

## One-liner

${proposal.oneLiner}

## What this is

${proposal.oneLiner}

## Target user

${proposal.targetUser}

## MVP

${proposal.mvp}

## Non-goals

${proposal.nonGoals.map((item) => `- ${item}`).join("\n")}

## Project type

${proposal.type}

## Stack

${proposal.preferredStack}

## Autonomy level

${proposal.autonomy}

## Status

active

## Build phase

initial-build

## Codex manager thread

Not started yet.

## Heartbeat cadence

stale_after_hours: 168
auto_queue_when_stale: false

## Platform policy

${platformPolicy(proposal.type)}

## Current state

Project created from onboarding. No implementation work has started yet.

## Initialization

- Durable Markdown memory files are created first.
- Optional starter scaffold files are written when requested.
- The project folder is initialized as a standalone local git repository on main.
- Startup OS creates an initial git commit for the generated files.
- The first real worker run creates the persistent Codex manager thread.

## Decisions

- Use the four durable Markdown files in this repo as project memory.
- Keep external side effects explicit and approval-gated.

## Open questions

${proposal.needsJulian.map((item) => `- ${item}`).join("\n") || "- None yet."}

## External dependencies

### Needed now

${proposal.externalDependencies.neededNow.map((item) => `- ${item}`).join("\n") || "- None."}

### Needed soon

${proposal.externalDependencies.neededSoon.map((item) => `- ${item}`).join("\n") || "- None."}

### Defer

${proposal.externalDependencies.defer.map((item) => `- ${item}`).join("\n") || "- None."}

## Style / vibe notes

${proposal.styleNotes}

## Original intent

${rawPrompt}
`;
}

function renderQueueMd(proposal: ProjectProposal): string {
  const browserOps = proposal.externalDependencies.neededNow
    .filter((item) => /account|login|captcha|payment|dns|domain|post|email|deploy|service/i.test(item));

  return `# Queue

## Now

- [ ] ${proposal.firstTask}

## Later

- [ ] Tighten the MVP scope after the first working demo exists.

## Needs Julian

${proposal.needsJulian.map((item) => `- [ ] ${item}`).join("\n") || "- [ ] None yet."}

## Browser/Ops Requests

${browserOps.map((item) => `- [ ] ${item}`).join("\n") || "- [ ] None yet."}

## Marketing Drafts

- [ ] Draft a plain-language project description after the first demo works.

## Done

- [x] Project created
`;
}

function renderLogMd(): string {
  return appendLogEntry("# Log\n", "Project created from onboarding.", todaySlug());
}

function renderAgentsMd(proposal: ProjectProposal): string {
  const mobilePolicy =
    proposal.type === "mobile-expo"
      ? `
## Mobile / Expo Policy

Prefer Expo, React Native, Expo Router, and TypeScript.

Development order:
1. Make the core flow work on web where possible.
2. Make it work in Expo Go if supported.
3. Use Expo development builds only when native functionality requires it.
4. Avoid raw Xcode/native modules unless Julian explicitly approves.

Keep a demo/debug route or screen that lets the agent inspect the core flow without needing a physical phone every time.
`
      : "";

  return `# Agent Instructions

You are the project manager and builder agent for this repo.

This project may be worked on in two ways:
1. Julian may run Codex manually from this directory.
2. The meta-project worker may run Codex automatically from this directory.

In both cases, treat this repo's Markdown files as durable memory.

Read these before doing meaningful work:
- PROJECT.md
- QUEUE.md
- LOG.md

After doing meaningful work, update:
- QUEUE.md
- LOG.md
- PROJECT.md only if the product/architecture/decision state changed

Bias toward visible progress. Prefer working prototypes over elaborate plans. Keep changes small enough to understand.

## Project Snapshot

- Name: ${proposal.name}
- Type: ${proposal.type}
- Autonomy: ${proposal.autonomy}
- One-liner: ${proposal.oneLiner}

## Autonomy

Allowed without approval:
- inspect the repo
- edit local files
- run local commands
- install reasonable packages
- start local dev servers
- use browser/search tools if available
- inspect the local UI
- draft marketing copy/posts/comments
- create commits on non-main branches
- update PROJECT.md, QUEUE.md, and LOG.md

Requires Julian approval:
- production deploy
- paid services
- account creation
- public social posts/comments/replies
- external emails
- DNS/domain changes
- deleting meaningful work
- interacting with real users
- storing secrets
- changing auth/billing architecture

## Browser/Search

If browser or search tools are available, use them when useful:
- inspect the local UI
- debug frontend behavior
- research implementation details
- research competitors or marketing channels
- prepare external-operation requests

Do not bypass CAPTCHAs, anti-bot systems, paywalls, logins, or platform restrictions. If blocked by CAPTCHA, login, 2FA, payment, or account verification, write a clear item under \`QUEUE.md > Needs Julian\`.

## Style

Avoid generic AI startup copy.

Do not write phrases like:
- unlock
- supercharge
- seamlessly
- revolutionize
- dive into
- leverage
- transform the way you
- in today's fast-paced world
- whether you're

Prefer:
- concrete descriptions
- short examples
- plain language
- specific artifacts
- tasteful, slightly opinionated copy
- demo-first explanations

Before writing public copy, ask: could this sentence appear on 500 other AI startup landing pages? If yes, rewrite it.
${mobilePolicy}
## Work Loop

When asked to work autonomously:
1. Read PROJECT.md, QUEUE.md, and LOG.md.
2. Inspect the repo and current git status.
3. Pick the highest-leverage safe task.
4. Do the work.
5. Run relevant checks if practical.
6. Update QUEUE.md and LOG.md.
7. If blocked or a human decision is needed, write it under \`Needs Julian\`.
8. If external browser/account/social action is needed, write it under \`Browser/Ops Requests\`.
`;
}

function cleanName(value?: string): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
}

function inferName(rawPrompt: string): string {
  const firstLine = rawPrompt.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "Untitled Project";
  const withoutLead = firstLine
    .replace(/^(idea|project|app|startup)\s*[:=-]\s*/i, "")
    .replace(/[.!?].*$/, "")
    .trim();

  return titleCase(withoutLead.slice(0, 56) || "Untitled Project");
}

function inferOneLiner(rawPrompt: string, name: string): string {
  const sentence = rawPrompt
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.trim().length > 20)
    ?.trim();

  if (!sentence) {
    return `${name} is a focused prototype for testing the project idea.`;
  }

  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function inferProjectType(rawPrompt: string, stack?: string): ProjectType {
  const text = `${rawPrompt} ${stack ?? ""}`.toLowerCase();
  if (/(expo|react native|mobile|iphone|android|phone|carplay|commute|car|voice|podcast|hands-free|hands free)/.test(text)) {
    return "mobile-expo";
  }
  if (/(chrome extension|browser extension|extension|manifest\.json)/.test(text)) {
    return "browser-extension";
  }
  if (/(cli|command line|terminal|developer tool|repo tool)/.test(text)) {
    return "cli";
  }
  if (/(newsletter|blog|content|essay|post|publishing)/.test(text)) {
    return "content";
  }
  if (/(research|paper|experiment|benchmark|notebook)/.test(text)) {
    return "research";
  }
  if (/(site|website|dashboard|web app|landing|saas|app)/.test(text)) {
    return "web";
  }
  return "unknown";
}

function inferAutonomy(rawPrompt: string): AutonomyLevel {
  const text = rawPrompt.toLowerCase();
  if (/(throwaway|prototype|quick|scrappy|hack)/.test(text)) {
    return "throwaway";
  }
  if (/(careful|serious|production|payments|users|auth|private|security|compliance)/.test(text)) {
    return "careful";
  }
  return "normal";
}

function defaultStack(type: ProjectType): string {
  switch (type) {
    case "web":
      return "Vite, React, TypeScript, local-first storage where possible";
    case "mobile-expo":
      return "Expo, React Native, Expo Router, TypeScript, web-previewable core flow";
    case "browser-extension":
      return "TypeScript browser extension with a small local demo harness";
    case "cli":
      return "Node.js, TypeScript, small CLI commands";
    case "research":
      return "TypeScript or Python notebooks/scripts, reproducible notes, local artifacts";
    case "content":
      return "Markdown-first content workflow with a simple web preview";
    case "unknown":
      return "Keep the stack minimal until the first prototype clarifies requirements";
  }
}

function inferTargetUser(rawPrompt: string): string {
  const text = rawPrompt.toLowerCase();
  if (/student|learn|lesson|math|course/.test(text)) {
    return "A learner who needs explanations and practice matched to their current knowledge.";
  }
  if (/research|paper|repo|developer|code/.test(text)) {
    return "A technical user who wants faster understanding and concrete artifacts.";
  }
  if (/voice|social|friends|feed/.test(text)) {
    return "A social user who prefers low-friction voice-first updates.";
  }
  if (/commute|car|podcast/.test(text)) {
    return "A commuter who wants useful hands-free audio workflows.";
  }
  return "The first user described in the original prompt. Clarify this after a small demo exists.";
}

function inferMvp(rawPrompt: string, type: ProjectType, oneLiner: string): string {
  const base = `A small local demo that proves the core loop: ${oneLiner}`;
  if (type === "mobile-expo") {
    return `${base} Keep the main flow inspectable on web before adding phone-only behavior.`;
  }
  if (type === "browser-extension") {
    return `${base} Include a local test page or mock extension harness before depending on store packaging.`;
  }
  if (/(payment|billing|marketplace|social graph|production)/i.test(rawPrompt)) {
    return `${base} Fake external systems locally until Julian approves real integrations.`;
  }
  return base;
}

function inferNonGoals(rawPrompt: string, avoid?: string): string[] {
  const items = [
    "Do not build production auth, billing, deployment, or public posting before the core demo works.",
    "Do not create accounts, paid services, DNS changes, or external side effects without approval."
  ];

  if (avoid?.trim()) {
    items.push(`Avoid: ${avoid.trim()}`);
  }
  if (/mobile|expo|react native/i.test(rawPrompt)) {
    items.push("Do not introduce raw Xcode/native modules unless explicitly approved.");
  }

  return items;
}

function inferFirstTask(type: ProjectType, oneLiner: string): string {
  if (type === "mobile-expo") {
    return "Create a browser-previewable Expo/React Native core-flow mock that demonstrates the main interaction.";
  }
  if (type === "web") {
    return "Create a small local web prototype that demonstrates the main user flow.";
  }
  if (type === "browser-extension") {
    return "Create a local extension skeleton plus a test page that demonstrates the core page interaction.";
  }
  if (type === "cli") {
    return "Create a small CLI prototype with one command that exercises the core workflow.";
  }
  if (type === "content") {
    return "Create the first draft artifact and a simple preview/readme for evaluating the voice and structure.";
  }
  if (type === "research") {
    return "Create a reproducible notes/scripts skeleton and run one small experiment or example.";
  }
  return `Create the smallest useful prototype for: ${oneLiner}`;
}

function inferExternalDependencies(rawPrompt: string, type: ProjectType): ProjectProposal["externalDependencies"] {
  const text = rawPrompt.toLowerCase();
  const neededNow: string[] = [];
  const neededSoon: string[] = [];
  const defer: string[] = [];

  if (/(api key|secret|token|openai|anthropic|notebooklm)/.test(text)) {
    neededSoon.push("Secret/API key may be needed; request it explicitly before storing or using it.");
  }
  if (/(login|account|oauth|gmail|twitter|x\.com|reddit|tiktok|instagram)/.test(text)) {
    neededSoon.push("Account/login access may be needed; queue Browser/Ops handoff before use.");
  }
  if (/(payment|billing|stripe|paid|domain|dns|deploy|production)/.test(text)) {
    defer.push("Payments, DNS, production deploys, and paid services require explicit approval.");
  }
  if (type === "browser-extension") {
    defer.push("Browser extension store submission requires approval and manual review.");
  }
  if (type === "mobile-expo") {
    defer.push("Native build credentials or App Store setup require approval.");
  }

  return { neededNow, neededSoon, defer };
}

function inferNeedsJulian(rawPrompt: string, neededNow: string[]): string[] {
  const needs = [...neededNow];
  if (/(brand|name|positioning|audience|pricing)/i.test(rawPrompt)) {
    needs.push("Confirm positioning and audience before writing public-facing copy.");
  }
  if (/(private|secret|account|login|payment|domain|deploy|post)/i.test(rawPrompt)) {
    needs.push("Approve any external side effects before the agent attempts them.");
  }
  return needs;
}

function inferStyleNotes(rawPrompt: string, type: ProjectType): string {
  if (/research|paper|notebook|lab/i.test(rawPrompt)) {
    return "Prefer a lab-notebook feel: concrete examples, visible artifacts, and concise explanatory copy.";
  }
  if (type === "mobile-expo") {
    return "Prefer a calm, glanceable mobile interaction. Keep demo states obvious and inspectable on web.";
  }
  return "Prefer plain language, concrete demo-first explanations, and copy that does not sound like generic SaaS.";
}

function platformPolicy(type: ProjectType): string {
  if (type === "mobile-expo") {
    return "Use Expo and keep the core flow inspectable on web where possible. Avoid custom native code and Xcode unless explicitly approved.";
  }
  if (type === "browser-extension") {
    return "Keep extension behavior local and testable. Store submission, public publishing, and account-based actions require approval.";
  }
  return "Local progress is allowed. External side effects, public posting, accounts, paid services, DNS, deploys, and secrets require approval.";
}

function createWebScaffold(projectDir: string, name: string): void {
  writeProjectFile(projectDir, "package.json", {
    scripts: { dev: "vite --host 0.0.0.0", build: "vite build" },
    dependencies: { "@vitejs/plugin-react": "4.3.1", vite: "5.3.5", typescript: "5.5.4", react: "18.3.1", "react-dom": "18.3.1" },
    devDependencies: {}
  });
  writeText(projectDir, "index.html", `<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n`);
  writeText(
    projectDir,
    "src/main.tsx",
    `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport "./style.css";\n\nfunction App() {\n  return <main><h1>${escapeJs(name)}</h1><p>Local prototype scaffold.</p></main>;\n}\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`
  );
  writeText(projectDir, "src/style.css", `body { margin: 0; font-family: system-ui, sans-serif; background: #f7f8fa; color: #202124; }\nmain { padding: 48px; }\n`);
}

function createExpoScaffold(projectDir: string, name: string): void {
  writeProjectFile(projectDir, "package.json", {
    scripts: { start: "expo start", web: "expo start --web" },
    dependencies: {
      expo: "latest",
      "expo-router": "latest",
      react: "18.3.1",
      "react-native": "latest",
      "react-native-web": "latest"
    },
    devDependencies: { typescript: "5.5.4" }
  });
  writeText(
    projectDir,
    "app/_layout.tsx",
    `import { Stack } from "expo-router";\n\nexport default function Layout() {\n  return <Stack />;\n}\n`
  );
  writeText(
    projectDir,
    "app/index.tsx",
    `import { Text, View } from "react-native";\n\nexport default function Home() {\n  return <View style={{ flex: 1, padding: 24, justifyContent: "center" }}><Text style={{ fontSize: 28, fontWeight: "700" }}>${escapeJs(name)}</Text><Text>Browser-previewable core flow scaffold.</Text></View>;\n}\n`
  );
}

function createExtensionScaffold(projectDir: string, name: string): void {
  writeProjectFile(projectDir, "manifest.json", {
    manifest_version: 3,
    name,
    version: "0.1.0",
    action: { default_title: name },
    content_scripts: [{ matches: ["<all_urls>"], js: ["src/content.js"] }]
  });
  writeText(projectDir, "src/content.ts", `console.log("${escapeJs(name)} content script loaded");\n`);
  writeText(projectDir, "test-page.html", `<h1>${escapeHtml(name)}</h1><p>Local test page for extension behavior.</p>\n`);
}

function createCliScaffold(projectDir: string, name: string): void {
  writeProjectFile(projectDir, "package.json", {
    scripts: { dev: "tsx src/index.ts" },
    dependencies: { tsx: "4.16.2", typescript: "5.5.4" },
    devDependencies: {}
  });
  writeText(projectDir, "src/index.ts", `console.log("${escapeJs(name)} CLI scaffold");\n`);
}

function createNotesScaffold(projectDir: string): void {
  writeText(projectDir, "notes/README.md", "# Notes\n\nUse this folder for local research, drafts, and artifacts.\n");
}

function writeProjectFile(projectDir: string, relativePath: string, value: unknown): void {
  writeText(projectDir, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(projectDir: string, relativePath: string, content: string): void {
  const filePath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
