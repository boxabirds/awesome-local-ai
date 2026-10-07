// The state the server sends the page (GET /api/state). Shared by both sides.
//
// The page presents benchmark results. What the server knows about its own and the harness's faults (a run marked
// invalid, a time split that failed its check, a final re-score that gave no score, a job's failure reason) stays on
// the server: GET /api/faults carries it for the monitor, and nothing here does.

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
  /** Times the agent was told to carry on after it stopped without finishing. */
  nudges: number | null;
  /** Where the story's time went; null when the record has none, or when the record's own check of it failed (the
   * server then sends none: a breakdown that doesn't add up is not available). */
  split?: TimeSplit | null;
}

/** Where a story's wall time went, in seconds. Without a timed model (a cloud model, or a run from before every
 * engine was timed) the model's time can't be told from the agent's own: both are modelUnsplit. */
export interface TimeSplit {
  wall: number; prefill: number; decode: number; tools: number; compaction: number; other: number; modelUnsplit: number;
  /** Waiting to start the agent's next session after one ended (a resume after an error, or a nudge). */
  betweenSessions: number;
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

/** What the agent's conversation on one story looked like, counted from its event log (no LLM): metrics.json's
 * per-story "conversation". Sizes are characters; context is tokens. */
export interface ConversationProfile {
  /** Model calls, and the tool calls they made. */
  calls: number;
  toolCalls: number;
  /** Thinking characters; null where the log withholds the text (a cloud model's): unknown, never 0. */
  thinkingChars: number | null;
  textChars: number;
  /** Characters of tool arguments: file contents written, edits, commands. */
  toolArgChars: number;
  /** Median thinking characters per model call; and before and after the largest thinking block. */
  thinkingMedian: number | null;
  thinkingMedianBefore: number | null;
  thinkingMedianAfter: number | null;
  /** The single largest thinking block: its size, the call it was in (1-based), and seconds into the story. */
  largestThinking: { chars: number; call: number; atS: number } | null;
  /** Whether the log shows the thinking text. A cloud model's doesn't: its thinking is counted in tokens instead. */
  thinkingVisible: boolean;
  /** Withheld thinking: the exact total in tokens, as the API billed it; null where not recorded. */
  thinkingTokens: number | null;
  /** Context the model read on its first and last call, and the largest jump between two consecutive calls. */
  contextStart: number | null;
  contextEnd: number | null;
  largestContextJump: { tokens: number; call: number } | null;
  toolsByName: Record<string, number>;
  /** Tool calls that returned an error; shell commands that exited non-zero. */
  toolErrors: number;
  /** The longest single tool call, in seconds, and what it ran. */
  longestTool: { seconds: number; name: string; gist: string } | null;
  /** Signs seen in the conversation on their own (not relative to other runs): "long-thinking-block", "hung-command". */
  signals: string[];
}

/** One execution of a run on a machine: a run restarted twice has three. */
export interface JobRef {
  id: string;
  node: string;
  status: string;
  /** Unix seconds. */
  submittedAt: number | null;
  updatedAt: number | null;
  /** When it ended (Unix seconds): the recorded end, else its last update; null while it is queued or running, or
   * when neither says. */
  endedAt: number | null;
}

/** One line of a run's interventions.md: something done to the run by hand or by a watchdog (a frozen machine
 * restarted, a silent tool call killed, a story ended at its cap). The run stays in every figure; its pages mark it. */
export interface Intervention {
  /** Unix seconds. */
  at: number;
  /** The story it was in ("3"); null for one about the run as a whole. */
  story: string | null;
  text: string;
}

/** One finished story of a run. */
export interface Story {
  /** This story can be judged: it has a record of its own and the run has its workspace history. Weaker than the
   * run's judgeReady on purpose -- a finished story of a running run is judgeable, and the review page rebuilds
   * the workspace story by story. */
  judgeReady?: boolean;
  id: string;
  title: string;
  status: string;
  /** Whole held-out suite up to this story (every story's tests so far); null until the record has it. */
  passed: number | null;
  total: number | null;
  /** This story's own held-out tests. */
  ownPassed: number | null;
  ownTotal: number | null;
  /** Set (true) when the story is in a stretch of three or more stories in a row of its run that pass none (shared/collapse.ts). */
  collapsed?: boolean;
  /** Every story's own tests against the build after this story, keyed "1", "2", …; null if not recorded. */
  byStory?: Record<string, { passed: number | null; total: number | null }> | null;
  usage?: Usage | null;
  /** The conversation's profile; null when the record has none. */
  conversation?: ConversationProfile | null;
  /** Why this story run is left out of every story-by-story comparison, in the record's own plain words ("This story
   * run also built stories 11 and 12."); null or absent for a story run that is compared. Its run's total and score stand. */
  notComparable?: string | null;
  /** The story run's id in the warehouse (`<run dir>/stories/NN`); null for a job with no record directory. */
  storyRunId: string | null;
  /** Whether the warehouse has this story run's conversation (any of it: a story still being built counts). */
  hasConversation: boolean;
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

/** A job's live view. */
export interface Live {
  jobId: string;
  status: string;
  currentStory: string | null;
  /** The story progress.json marks running; set while current_story is blank between the agent and the gates. */
  runningStory: string | null;
  agentMinutes: number | null;
  calls: number | null;
  outputTokens: number | null;
  tasksWritten: number | null;
  tasksTotal: number | null;
  /** The agent's latest action, as reported. */
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
  queue: QueuePlace | null;
}

export interface Score {
  passed: number | null;
  total: number | null;
  flaky: number;
  at: string;
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
  /** The machine the run is filed under: its node, else the node seen with its host, else the host. */
  machine: string;
  /** Model and engine, e.g. "3.8-swift-1.5/27b llamacpp". */
  label: string;
  /** The agent client that ran it, as run.json names it ("pi", "claude": Claude Code), else its job's; "" if neither says. */
  client: string;
  packVersion: string;
  family: string;
  suite: string;
  state: string;
  stateAt: string;
  status: RunStatus;
  storiesWorking: StoriesWorking;
  usage: RunUsage;
  /** Where in its work a run is: "finishing story 3", "between stories", "starting"; "" if nothing to add. */
  statusNote: string;
  stories: Story[];
  rescores: string[];
  scores: Record<string, Score>;
  /** Whether the run can be judged: finished, scored under the current suite, with its workspace history. */
  judgeReady: boolean;
  /** metrics.json's "known_good": a partial rerun, built on another run's code from part-way through, with only
   * part of the scope. Diagnostic — never counted in a ranking or a spread with full runs (EVALUATION-POLICY
   * rule 7), whatever its own score says. */
  knownGood: boolean;
  /** The hot-expert cache the engine settled on (run.json's engine_settings.expert_cache), where it records one.
   * Strata sizes it to the VRAM that is free, so it is a fact of the run, not a setting: two runs of one combination
   * can differ, and one with a smaller cache decodes more slowly. Null or absent: nothing to show. */
  expertCache?: ExpertCache | null;
  live: Live | null;
  /** Every execution of this run, oldest first. */
  jobs: JobRef[];
  /** interventions.md, oldest first; [] when it has none. */
  interventions: Intervention[];
}

/** What `expertCache` holds; server/domain.ts parses it from the record. */
export interface ExpertCache {
  /** What --expert-cache asked for ("auto", or a size); "" where the record doesn't say. */
  requested: string;
  experts: number;
  vramGib: number;
}

/** One machine: the job it runs now (null: none shown), whether it is busy with a job the page doesn't show, and
 * how many wait behind it. */
export interface Machine {
  node: string;
  /** `finishing`: the agent is done with `story` and it is being scored and recorded. */
  running: { stack: string; short: string; runId: string; story: string | null; finishing: boolean; agentMinutes: number | null } | null;
  /** True while the machine runs a job that is not among the runs shown. */
  busy: boolean;
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
  /** When the data was last read in full (Unix seconds): the older of the two sources' last successful reads; 0
   * before either has read. */
  updatedAt: number;
  /** False when the last attempt to read either source failed: the data is as old as `updatedAt` says. */
  updating: boolean;
  suites: Record<string, string>;
  web: string | null;
  judgeUrl: string;
  branch: string;
  rows: Row[];
  /** Every node answered for, idle ones included. */
  machines: Machine[];
}
