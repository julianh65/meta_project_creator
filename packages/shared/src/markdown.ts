import crypto from "node:crypto";
import path from "node:path";
import {
  AUTONOMY_LEVELS,
  PROJECT_PHASES,
  PROJECT_AGENT_STATUSES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  ParsedQueue,
  ProjectFileName,
  ProjectPhase,
  ProjectRecord,
  ProjectStatus,
  ProjectType,
  QueueItem
} from "./types";

const sectionMap: Record<keyof ParsedQueue, string> = {
  now: "Now",
  later: "Later",
  needsJulian: "Needs Julian",
  browserOps: "Browser/Ops Requests",
  marketingDrafts: "Marketing Drafts",
  done: "Done"
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function todaySlug(): string {
  return new Date().toISOString().slice(0, 10);
}

export function stableId(seed: string): string {
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug || `project-${Date.now().toString(36)}`;
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function getSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^##\\s+${escaped}\\s*$`, "i");
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }
  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) {
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

export function getSubsection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^###\\s+${escaped}\\s*$`, "i");
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }
  let end = start + 1;
  while (
    end < lines.length &&
    !lines[end]?.startsWith("### ") &&
    !lines[end]?.startsWith("## ")
  ) {
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

export function firstNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function parseProjectMarkdown(
  slug: string,
  projectPath: string,
  files: Partial<Record<ProjectFileName, string>>,
  existing?: Partial<ProjectRecord>
): ProjectRecord {
  const projectMd = files["PROJECT.md"] ?? "";
  const queue = parseQueue(files["QUEUE.md"] ?? "");
  const name = firstNonEmptyLine(getSection(projectMd, "Name")) || titleCase(slug);
  const oneLiner = firstNonEmptyLine(getSection(projectMd, "One-liner")) || "";
  const typeText = firstNonEmptyLine(getSection(projectMd, "Project type"));
  const autonomyText = firstNonEmptyLine(getSection(projectMd, "Autonomy level"));
  const statusText = firstNonEmptyLine(getSection(projectMd, "Status"));
  const phaseText = firstNonEmptyLine(getSection(projectMd, "Build phase"));
  const codexThreadText = firstNonEmptyLine(getSection(projectMd, "Codex manager thread"));
  const cadence = parseHeartbeatCadence(
    getSection(projectMd, "Work cadence") || getSection(projectMd, "Heartbeat cadence")
  );

  const type = PROJECT_TYPES.includes(typeText as ProjectType)
    ? (typeText as ProjectType)
    : "unknown";
  const autonomy = AUTONOMY_LEVELS.includes(autonomyText as ProjectRecord["autonomy"])
    ? (autonomyText as ProjectRecord["autonomy"])
    : "normal";
  const status = PROJECT_STATUSES.includes(statusText as ProjectStatus)
    ? (statusText as ProjectStatus)
    : "active";
  const buildPhase = PROJECT_PHASES.includes(phaseText as ProjectPhase)
    ? (phaseText as ProjectPhase)
    : existing?.build_phase ?? "initial-build";
  const codexThreadId = isUuidLike(codexThreadText)
    ? codexThreadText
    : existing?.codex_thread_id ?? null;
  const existingAgentStatus = existing?.agent_status;
  const agentStatus = existingAgentStatus && PROJECT_AGENT_STATUSES.includes(existingAgentStatus)
    ? existingAgentStatus
    : "idle";

  return {
    id: existing?.id ?? stableId(projectPath),
    slug,
    name,
    path: projectPath,
    type,
    autonomy,
    status,
    build_phase: buildPhase,
    codex_thread_id: codexThreadId,
    agent_status: agentStatus,
    active_turn_id: existing?.active_turn_id ?? null,
    agent_goal: existing?.agent_goal ?? null,
    last_agent_update_at: existing?.last_agent_update_at ?? null,
    one_liner: oneLiner,
    current_now_task: firstOpenTask(queue.now),
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
    last_heartbeat_at: existing?.last_heartbeat_at ?? null,
    last_worker_run_at: existing?.last_worker_run_at ?? null,
    stale_after_hours: cadence.staleAfterHours ?? existing?.stale_after_hours ?? 168,
    auto_queue_when_stale: cadence.autoQueueWhenStale ?? existing?.auto_queue_when_stale ?? false
  };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function parseHeartbeatCadence(markdown: string): {
  staleAfterHours: number | null;
  autoQueueWhenStale: boolean | null;
} {
  const staleMatch = markdown.match(/stale_after_hours\s*:\s*(\d+)/i);
  const autoMatch = markdown.match(/auto_queue_when_stale\s*:\s*(true|false)/i);

  return {
    staleAfterHours: staleMatch?.[1] ? Number(staleMatch[1]) : null,
    autoQueueWhenStale: autoMatch?.[1] ? autoMatch[1].toLowerCase() === "true" : null
  };
}

export function parseQueue(markdown: string): ParsedQueue {
  return {
    now: parseQueueSection(markdown, sectionMap.now),
    later: parseQueueSection(markdown, sectionMap.later),
    needsJulian: parseQueueSection(markdown, sectionMap.needsJulian),
    browserOps: parseQueueSection(markdown, sectionMap.browserOps),
    marketingDrafts: parseQueueSection(markdown, sectionMap.marketingDrafts),
    done: parseQueueSection(markdown, sectionMap.done)
  };
}

export function queueSectionName(key: keyof ParsedQueue): string {
  return sectionMap[key];
}

export function firstOpenTask(items: QueueItem[]): string | null {
  return items.find((item) => !item.done)?.text ?? null;
}

export function appendQueueItem(markdown: string, section: keyof ParsedQueue, text: string): string {
  const heading = `## ${sectionMap[section]}`;
  const itemLine = `- [ ] ${text.trim()}`;

  if (!markdown.includes(heading)) {
    return `${markdown.trimEnd()}\n\n${heading}\n\n${itemLine}\n`;
  }

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return `${markdown.trimEnd()}\n\n${heading}\n\n${itemLine}\n`;
  }

  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && !lines[insertAt]?.startsWith("## ")) {
    insertAt += 1;
  }

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  if (before[before.length - 1]?.trim()) {
    before.push("");
  }
  before.push(itemLine);

  return [...before, ...after].join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

export function replaceMarkdownSection(markdown: string, heading: string, body: string): string {
  const lines = markdown.split(/\r?\n/);
  const sectionHeading = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === sectionHeading);

  if (start === -1) {
    return `${markdown.trimEnd()}\n\n${sectionHeading}\n\n${body.trim()}\n`;
  }

  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) {
    end += 1;
  }

  return [
    ...lines.slice(0, start + 1),
    "",
    body.trim(),
    "",
    ...lines.slice(end)
  ].join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

export function appendLogEntry(markdown: string, message: string, date = todaySlug()): string {
  const heading = `## ${date}`;
  const line = `- ${message.trim()}`;

  if (!markdown.includes(heading)) {
    const base = markdown.trim() || "# Log";
    return `${base}\n\n${heading}\n\n${line}\n`;
  }

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((entry) => entry.trim() === heading);
  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && !lines[insertAt]?.startsWith("## ")) {
    insertAt += 1;
  }

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  if (before[before.length - 1]?.trim()) {
    before.push("");
  }
  before.push(line);
  return [...before, ...after].join("\n").trimEnd() + "\n";
}

export function recentLogEntries(markdown: string, limit = 8): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .slice(-limit)
    .reverse();
}

export function allowedProjectFile(fileName: string): fileName is ProjectFileName {
  return ["AGENTS.md", "PROJECT.md", "QUEUE.md", "LOG.md"].includes(path.basename(fileName));
}

function parseQueueSection(markdown: string, heading: string): QueueItem[] {
  const body = getSection(markdown, heading);

  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^- \[( |x|X)\]\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        done: match[1]?.toLowerCase() === "x",
        text: match[2]?.trim() ?? "",
        section: heading
      };
    })
    .filter((item): item is QueueItem => Boolean(item));
}
