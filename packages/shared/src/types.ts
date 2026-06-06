export const PROJECT_TYPES = [
  "web",
  "mobile-expo",
  "browser-extension",
  "cli",
  "research",
  "content",
  "unknown"
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number];

export const AUTONOMY_LEVELS = ["throwaway", "normal", "careful"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const PROJECT_STATUSES = ["active", "paused", "stale", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const REQUEST_TYPES = [
  "needs_julian",
  "browser_ops",
  "marketing_approval",
  "deploy_approval",
  "secret_needed",
  "account_setup",
  "captcha_needed",
  "login_needed",
  "payment_needed",
  "code_review",
  "blocked",
  "general"
] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = [
  "open",
  "queued",
  "running",
  "needs_julian",
  "approved",
  "rejected",
  "done",
  "failed",
  "stale"
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const RUN_TYPES = [
  "heartbeat",
  "feedback",
  "manual-job",
  "onboarding",
  "browser-check"
] as const;

export type RunType = (typeof RUN_TYPES)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "stale"
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type ProjectFileName = "AGENTS.md" | "PROJECT.md" | "QUEUE.md" | "LOG.md";

export const PROJECT_FILE_NAMES: ProjectFileName[] = [
  "AGENTS.md",
  "PROJECT.md",
  "QUEUE.md",
  "LOG.md"
];

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  path: string;
  type: ProjectType;
  autonomy: AutonomyLevel;
  status: ProjectStatus;
  one_liner: string;
  current_now_task: string | null;
  created_at: string;
  updated_at: string;
  last_heartbeat_at: string | null;
  last_worker_run_at: string | null;
  stale_after_hours: number;
  auto_queue_when_stale: boolean;
  needs_julian_count?: number;
  browser_ops_count?: number;
  recent_run_status?: RunStatus | null;
}

export interface RequestRecord {
  id: string;
  project_id: string;
  project_slug: string;
  type: RequestType;
  title: string;
  body: string;
  status: RequestStatus;
  risk: "low" | "medium" | "high";
  source: "queue" | "manual" | "worker";
  source_key: string | null;
  thread: string;
  created_at: string;
  updated_at: string;
}

export interface RunRecord {
  id: string;
  project_id: string;
  project_slug: string;
  run_type: RunType;
  status: RunStatus;
  prompt: string;
  started_at: string | null;
  finished_at: string | null;
  logs: string;
  summary: string;
  files_changed: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRecord {
  id: string;
  project_id: string;
  project_slug: string;
  run_id: string;
  job_type: RunType;
  status: RunStatus;
  prompt: string;
  priority: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_id: string | null;
  error: string | null;
}

export interface WorkerStatus {
  id: string;
  worker_id: string;
  status: "online" | "offline";
  last_seen_at: string | null;
  current_job_id: string | null;
  version: string;
  updated_at: string;
  is_online: boolean;
}

export interface ProjectDraftInput {
  rawPrompt: string;
  name?: string;
  type?: ProjectType | "";
  autonomy?: AutonomyLevel | "";
  preferredStack?: string;
  thingsToAvoid?: string;
  vibeNotes?: string;
}

export interface ProjectProposal {
  name: string;
  slug: string;
  oneLiner: string;
  type: ProjectType;
  autonomy: AutonomyLevel;
  preferredStack: string;
  targetUser: string;
  mvp: string;
  nonGoals: string[];
  firstTask: string;
  needsJulian: string[];
  externalDependencies: {
    neededNow: string[];
    neededSoon: string[];
    defer: string[];
  };
  styleNotes: string;
}

export interface ProjectDraft {
  proposal: ProjectProposal;
  files: Record<ProjectFileName, string>;
}

export interface QueueItem {
  text: string;
  done: boolean;
  section: string;
}

export interface ParsedQueue {
  now: QueueItem[];
  later: QueueItem[];
  needsJulian: QueueItem[];
  browserOps: QueueItem[];
  marketingDrafts: QueueItem[];
  done: QueueItem[];
}

export interface ProjectDetail extends ProjectRecord {
  files: Record<ProjectFileName, string>;
  queue: ParsedQueue;
  requests: RequestRecord[];
  runs: RunRecord[];
  jobs: JobRecord[];
  recentLogEntries: string[];
  manualCommand: string;
}

export interface DashboardSummary {
  worker: WorkerStatus;
  activeProjects: number;
  needsJulian: number;
  staleProjects: number;
  browserOps: number;
  approvals: number;
  queuedJobs: number;
  runningJobs: number;
  recentRuns: RunRecord[];
  activeJobs: JobRecord[];
  projects: ProjectRecord[];
}
