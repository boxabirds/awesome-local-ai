// The state the server sends the page (GET /api/state). Shared by both sides.

/** What one story cost and how fast the model ran: from metrics.json (agent tokens; the meter's time split).
 * Speeds are null for a cloud model (nothing local to time). */
export interface Usage {
  outTokens: number | null;
  inTokens: number | null;
  cacheRead: number | null;
  /** Everything the model read: fresh input plus cache reads and writes. Clients split input differently
   * (Claude Code reports nearly all of it as cache reads), so this is the comparable figure. */
  readTokens: number | null;
  calls: number | null;
  agentSeconds: number | null;
  /** Output tokens over the time the story took (agent seconds). */
  tokS: number | null;
  decodeTokens: number | null;
  decodeSeconds: number | null;
  decodeTokS: number | null;
  prefillTokens: number | null;
  prefillSeconds: number | null;
  prefillTokS: number | null;
  draftAcceptance: number | null;
  compactions: number | null;
  /** Times the harness had to nudge the agent to carry on. */
  nudges: number | null;
  split?: TimeSplit | null;
}

/** Where a story's wall time went, in seconds. Without a timed model (a cloud model, or a run from before the
 * harness timed every engine) the model's time can't be told from the agent's own: both are modelUnsplit. */
export interface TimeSplit {
  wall: number; prefill: number; decode: number; tools: number; compaction: number; other: number; modelUnsplit: number;
  /** The harness waiting to start the agent's next session after one ended (a resume after an error, or a nudge). */
  betweenSessions: number;
  /** The split's own checks, recorded with it: parts sum to the wall, none negative, every tool call ended, the wall
   * agrees with the agent's clock. "unchecked": recorded before the harness checked (a cloud model's run, or older). */
  check: { status: "ok" | "problems" | "unchecked"; problems: string[] };
  /** Tools time by kind: the agent's tests (unit, e2e, …), builds, file reads and edits, and "bash" for every other command. */
  toolsByKind?: Record<string, number>;
}

/** A run's totals over its recorded stories; speeds weighted by tokens. */
export interface RunUsage {
  outTokens: number | null;
  inTokens: number | null;
  readTokens: number | null;
  calls: number | null;
  /** Output tokens over the time the recorded stories took. */
  tokS: number | null;
  decodeTokS: number | null;
  prefillTokS: number | null;
}

/** What the agent's conversation on one story looked like, counted from its event log by the harness (no LLM):
 * metrics.json's per-story "conversation". Sizes are characters; context is tokens. */
export interface ConversationProfile {
  /** Model calls, and the tool calls they made. */
  calls: number;
  toolCalls: number;
  thinkingChars: number;
  textChars: number;
  /** Characters of tool arguments: file contents written, edits, commands. */
  toolArgChars: number;
  /** Median thinking characters per model call; and before and after the largest thinking block. */
  thinkingMedian: number;
  thinkingMedianBefore: number | null;
  thinkingMedianAfter: number | null;
  /** The single largest thinking block: its size, the call it was in (1-based), and seconds into the story. */
  largestThinking: { chars: number; call: number; atS: number } | null;
  /** Context the model read on its first and last call, and the largest jump between two consecutive calls. */
  contextStart: number | null;
  contextEnd: number | null;
  largestContextJump: { tokens: number; call: number } | null;
  toolsByName: Record<string, number>;
  /** Tool calls that returned an error; shell commands that exited non-zero. */
  toolErrors: number;
  /** The longest single tool call, in seconds, and what it ran. */
  longestTool: { seconds: number; name: string; gist: string } | null;
  /** Signs the harness saw on their own (not relative to other runs): "long-thinking-block", "hung-command". */
  signals: string[];
}

/** One dbench job of a run: a run restarted twice has three. */
export interface JobRef {
  id: string;
  node: string;
  status: string;
  /** Unix seconds. */
  submittedAt: number | null;
  updatedAt: number | null;
  reason: string;
}

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
  /** Every story's own tests against the build after this story, keyed "1", "2", …; null if not recorded. */
  byStory?: Record<string, { passed: number | null; total: number | null }> | null;
  usage?: Usage | null;
  /** The conversation's profile; null for a story recorded before the harness kept one, or a client whose log it can't read. */
  conversation?: ConversationProfile | null;
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
  storiesWorking: StoriesWorking;
  usage: RunUsage;
  /** Why or how: a failure's reason, "finishing story 3", "attempt 2"; "" if nothing to add. */
  statusNote: string;
  stories: Story[];
  rescores: string[];
  scores: Record<string, Score>;
  hasBundle: boolean;
  stages: Stages;
  live: Live | null;
  /** Every dbench job of this run, oldest first. */
  jobs: JobRef[];
}

/** One dbench node: the job it runs now (null: idle) and how many wait behind it. */
export interface Machine {
  node: string;
  /** `finishing`: the agent is done with `story` and it is being scored and recorded. */
  running: { stack: string; short: string; runId: string; story: string | null; finishing: boolean; agentMinutes: number | null } | null;
  queued: number;
}

/** One story in the run's scope, against the latest build: all its flows pass, some, none, not built yet, or being built. */
export interface StorySquare {
  id: string;
  state: "ok" | "part" | "bad" | "unbuilt" | "running";
  passed: number | null;
  total: number | null;
}

export interface StoriesWorking {
  /** Stories whose flows all pass against the latest build. */
  working: number;
  /** Stories in the run's scope. */
  scope: number;
  squares: StorySquare[];
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
