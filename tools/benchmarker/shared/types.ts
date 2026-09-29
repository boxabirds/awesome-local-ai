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
  packVersion: string;
  family: string;
  suite: string;
  state: string;
  stateAt: string;
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
