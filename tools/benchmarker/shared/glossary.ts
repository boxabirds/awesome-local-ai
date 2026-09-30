// One definition per measure: its name, unit, and what it counts. Every page's headings and hovers read from here,
// so a number means the same thing wherever it appears. Add a measure here before showing it anywhere.

export interface Term {
  /** The heading or label. */
  name: string;
  /** What it counts, for the hover. */
  what: string;
}

export const GLOSSARY = {
  scoreOfRecord: { name: "Score", what: "The score of record: held-out tests passing when the finished run's final build is re-scored once more, under the current suite version. Only finished runs have one; it is the number to rank by." },
  scoreSummary: { name: "Score", what: "The score of record of this combination's finished runs: the median, the lowest and highest, and n, how many runs. With few runs, only large differences between combinations mean anything." },
  liveHeldOut: { name: "Live held-out", what: "Live: each story's held-out tests against the run's latest build, as the run goes. Provisional: it may come from an earlier suite version, and it never ranks anything." },
  storyHeldOut: { name: "Held-out", what: "This story's own held-out tests, passing against the build after it (the re-score of record where there is one, else live)." },
  agentTime: { name: "Agent time", what: "Wall time from the agent starting a story to it finishing, summed over stories: the model, its tools, and waits between sessions." },
  hoursPerStory: { name: "Hours per story", what: "Agent hours per story, over the finished runs: how long the combination takes to deliver a story. The median over runs, with the range." },
  outTokens: { name: "Output tokens", what: "Tokens the model wrote: its thinking, its replies and its tool calls (file contents, edits, commands)." },
  inputTokens: { name: "Input tokens", what: "Everything the model read to answer, summed over all its calls. Each call re-reads the whole conversation so far, mostly from its cache, so this grows with the number of calls." },
  calls: { name: "Tool calls", what: "Tool calls the agent made: reads, edits, writes and commands." },
  tokS: { name: "tok/s", what: "Output tokens over the time the story took (model, tools and all)." },
  decodeTokS: { name: "Decode tok/s", what: "Output tokens over the model's own generation time, where the harness timed the model." },
  compactions: { name: "Compactions", what: "Times the conversation was summarised to make room in the context." },
  nudges: { name: "Nudges", what: "Times the harness told the agent to carry on after it stopped without finishing." },
  timeSplit: { name: "Where the time went", what: "Every second of the story has one owner: compaction, a tool call, the model reading (prefill), the model writing (generation), the harness restarting the agent between sessions, or other." },
  thinking: { name: "Thinking", what: "Characters the model wrote as reasoning. It stays in the conversation, so a long block is re-read on every later call." },
  largestThinking: { name: "Largest thinking block", what: "The single longest piece of reasoning in the story, and when it came. One very long block tends to make every later call think more." },
  contextJump: { name: "Largest context jump", what: "The biggest growth in what the model reads between two consecutive calls: usually a long thinking block or a large file entering the conversation." },
  toolErrors: { name: "Tool errors", what: "Tool calls that returned an error, and commands that exited with a failure." },
  divergence: { name: "Differs from median", what: "This story run is more than 10% away from the combination's median for the same story: the same setup behaved differently." },
} as const satisfies Record<string, Term>;

export type TermId = keyof typeof GLOSSARY;
