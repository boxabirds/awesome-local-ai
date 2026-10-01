#!/usr/bin/env node
// capture_pi_requests.mjs -- the request bodies pi sends, turn by turn, for a recorded pi session.
//
//   node capture_pi_requests.mjs --log <agent-events(.compact).jsonl(.gz)> --out <dir>
//        [--model ID] [--context-window N] [--max-tokens N] [--max-chars N] [--pi-ai <dir>]
//
// It does not imitate pi: it loads the pi-ai package of the pi on PATH (the one the benchmarks run) and calls its own
// openai-completions `stream()` with each turn's context, pointed at a recording server on a free loopback port. What
// that server receives is, byte for byte, what pi would have sent the model for that turn. The model config is the
// harness's (benchmarks/spec-bench/harness/clients.py write_config): compat supportsDeveloperRole false, and
// supportsReasoningEffort false (pi sends no effort; the server applies one).
//
// Turn k's context is every message the session logged before its k-th assistant message, compactions ignored: the
// conversation keeps growing, which is what the long-context check needs. Writes <out>/NNNN.json.gz (NNNN from 0001)
// and <out>/index.json (per turn: messages, request characters, and the prompt size the recorded run reported).
// Stops once a request passes --max-chars characters of messages (default sized for ~135k tokens with room).

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createGunzip, gzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// pi's limits as the harness configures them (clients.py): context 131072, reply 32768.
const DEFAULT_CONTEXT_WINDOW = 131072;
const DEFAULT_MAX_TOKENS = 32768;
// Characters of request JSON per token run at ~3-4 for code and logs; 8 per token over a 135k-token target leaves
// room for the long-context check to reach it whatever the mix.
const DEFAULT_MAX_CHARS = 135000 * 8;

function args() {
  const a = { model: "recorded", contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS,
              maxChars: DEFAULT_MAX_CHARS, piAi: "" };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) {
    const k = v[i], x = v[i + 1];
    if (k === "--log") a.log = x;
    else if (k === "--out") a.out = x;
    else if (k === "--model") a.model = x;
    else if (k === "--context-window") a.contextWindow = Number(x);
    else if (k === "--max-tokens") a.maxTokens = Number(x);
    else if (k === "--max-chars") a.maxChars = Number(x);
    else if (k === "--pi-ai") a.piAi = x;
    else { console.error(`unknown option ${k}`); process.exit(2); }
  }
  if (!a.log || !a.out) { console.error("usage: --log <events.jsonl[.gz]> --out <dir>"); process.exit(2); }
  return a;
}

// The pi-ai package inside the pi on PATH: nested under pi-coding-agent, or hoisted beside it.
function findPiAi(explicit) {
  if (explicit) return explicit;
  const bin = execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim();
  if (!bin) throw new Error("pi is not on PATH");
  let dir = dirname(realpathSync(bin));
  while (dir !== "/" && !existsSync(join(dir, "package.json"))) dir = dirname(dir);
  for (const c of [join(dir, "node_modules/@earendil-works/pi-ai"), join(dir, "../pi-ai")]) {
    if (existsSync(join(c, "dist/api/openai-completions.js"))) return c;
  }
  throw new Error(`no pi-ai package found for pi at ${bin} (looked under ${dir})`);
}

async function* events(path) {
  let input = createReadStream(path);
  if (path.endsWith(".gz")) input = input.pipe(createGunzip());
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === "object") yield e;
    } catch { /* a line cut off when the agent stopped */ }
  }
}

function recorder() {
  let last = null;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      last = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (choices, usage) => res.write(`data: ${JSON.stringify({ id: "rec", object: "chat.completion.chunk",
        created: 0, model: "rec", choices, ...(usage ? { usage } : {}) })}\n\n`);
      chunk([{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }]);
      chunk([{ index: 0, delta: {}, finish_reason: "stop" }], { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve({ server, port: server.address().port, take: () => { const b = last; last = null; return b; } })));
}

async function main() {
  const a = args();
  const piAi = findPiAi(a.piAi);
  const { stream } = await import(pathToFileURL(join(piAi, "dist/api/openai-completions.js")).href);
  const version = JSON.parse(execFileSync("cat", [join(piAi, "package.json")], { encoding: "utf8" })).version;

  const messages = [];
  for await (const e of events(a.log)) {
    if (e.type === "message_end" && e.message && typeof e.message === "object") messages.push(e.message);
  }
  const turns = [];
  messages.forEach((m, i) => { if (m.role === "assistant") turns.push(i); });
  if (!turns.length) throw new Error(`no assistant messages in ${a.log}`);

  mkdirSync(a.out, { recursive: true });
  const rec = await recorder();
  const model = { id: a.model, name: a.model, api: "openai-completions", provider: "local",
                  baseUrl: `http://127.0.0.1:${rec.port}/v1`, reasoning: true, input: ["text"],
                  contextWindow: a.contextWindow, maxTokens: a.maxTokens,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } };
  const index = { pi_ai_version: version, log: a.log, turns: [] };
  try {
    for (let k = 0; k < turns.length; k++) {
      const context = { messages: messages.slice(0, turns[k]) };
      const s = stream(model, context, { apiKey: "local", maxTokens: a.maxTokens, maxRetries: 0 });
      for await (const ev of s) { if (ev.type === "error") throw new Error(`pi-ai: ${JSON.stringify(ev.error).slice(0, 300)}`); }
      const body = rec.take();
      if (!body) throw new Error(`turn ${k + 1}: pi-ai sent nothing`);
      writeFileSync(join(a.out, `${String(k + 1).padStart(4, "0")}.json.gz`), gzipSync(body));
      const recorded = messages[turns[k]].usage || {};
      const chars = JSON.stringify(JSON.parse(body).messages).length;
      index.turns.push({ turn: k + 1, messages: turns[k], request_chars: chars,
                         recorded_prompt_tokens: (recorded.input || 0) + (recorded.cacheRead || 0) || null });
      if (chars > a.maxChars) break;
    }
  } finally {
    rec.server.close();
  }
  writeFileSync(join(a.out, "index.json"), JSON.stringify(index, null, 1) + "\n");
  console.log(`captured ${index.turns.length} request bodies with pi-ai ${version} into ${a.out}`);
}

main().catch((e) => { console.error(`capture_pi_requests: ${e.message}`); process.exit(1); });
