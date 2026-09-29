// The state the server sends the page (GET /api/state). Shared by both sides.

/** One finished story of a run. */
export interface Story {
  id: string;
  title: string;
  status: string;
  /** Whole held-out suite up to this story (every story's tests so far); null until the record has it. */
  passed: number | null;
  total: number | null;
  /** This story's own held-out tests. */
  ownPassed: number | null;
  ownTotal: number | null;
}

export interface QueuePlace {
  /** 1-based place on its node, counting the running job. */
  position: number;
  /** The jobs ahead, running first, as "<model> <run id>". */
  ahead: string[];
}

/** One word for where a run is. */
export type RunStatus = "running" | "queued" | "finished" | "failed" | "stopped" | "cancelled" | "unknown";
export const RUN_STATUSES: RunStatus[] = ["running", "queued", "finished", "failed", "stopped", "cancelled", "unknown"];

/** A dbench job's live view. */
export interface Live {
  jobId: string;
  status: string;
  attempt: number | null;
  currentStory: string | null;
  /** The story progress.json marks running; set while current_story is blank between the agent and the gates. */
  runningStory: string | null;
  agentMinutes: number | null;
  calls: number | null;
  outputTokens: number | null;
  tasksWritten: number | null;
  tasksTotal: number | null;
  lastActivity: string | null;
  storyStartedAt: number | null;
  /** The running story's title. */
  storyTitle: string | null;
  /** Stories in the job's scope, done or not. */
  storiesInScope: number | null;
  /** When this attempt of the job started. */
  runStartedAt: number | null;
  /** Agent minutes over the job's stories so far. */
  totalAgentMinutes: number | null;
  logTail: string[];
  queue: QueuePlace | null;
}

export interface Score {
  passed: number | null;
  total: number | null;
  flaky: number;
  at: string;
}

export interface Stages {
  build: string;
  score: string;
  judge: string;
}

export interface Row {
  pack: string;
  stack: string;
  runId: string;
  /** Repo path of the run record; null for a job with no record yet. */
  dir: string | null;
  node: string | null;
  /** run.json's hardware description, e.g. "Apple M5 Max 128GB"; "" if the record has none. */
  host: string;
  /** The machine the run is filed under: its dbench node, else the node seen with its host, else the host. */
  machine: string;
  /** Model and engine, e.g. "3.8-swift-1.5/27b llamacpp". */
  label: string;
  packVersion: string;
  family: string;
  suite: string;
  state: string;
  stateAt: string;
  status: RunStatus;
  /** Hidden flows (held-out tests) in the run's whole scope for its suite version; null if unknown. */
  flowsTotal: number | null;
  flows: FlowsHealth;
  /** Why or how: a failure's reason, "finishing story 3", "attempt 2"; "" if nothing to add. */
  statusNote: string;
  stories: Story[];
  rescores: string[];
  scores: Record<string, Score>;
  hasBundle: boolean;
  stages: Stages;
  live: Live | null;
}

/** One dbench node: the job it runs now (null: idle) and how many wait behind it. */
export interface Machine {
  node: string;
  /** `finishing`: the agent is done with `story` and it is being scored and recorded. */
  running: { stack: string; short: string; runId: string; story: string | null; finishing: boolean; agentMinutes: number | null } | null;
  queued: number;
}

/** Whether the flows built so far work, from the whole-suite result after the latest recorded story. */
export interface FlowsHealth {
  state: "none" | "working" | "some failing" | "regressed" | "broken";
  passed: number | null;
  /** The story that result is after. */
  after: string | null;
  /** The best earlier result, when this one is lower. */
  was: number | null;
}

export interface State {
  buildId: string;
  now: number;
  fetchedAt: number;
  fetchError: string;
  dbenchAt: number;
  dbenchError: string;
  suites: Record<string, string>;
  web: string | null;
  judgeUrl: string;
  branch: string;
  rows: Row[];
  /** Every node dbench answered for, idle ones included. */
  machines: Machine[];
}
