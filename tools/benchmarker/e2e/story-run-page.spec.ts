import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { parseRoute } from "../shared/routes.ts";
import { GLOSSARY } from "../shared/glossary.ts";
import { BELOW_CAVEAT, HELD_OUT_CAVEAT } from "../shared/runView.ts";

// The story run page, section by section (header, time, cost, conversation, against the combination, navigation),
// then the story runs with no record (in progress, not built, queued, out of scope), then links and keyboard.
// Within a section, one test per state that changes what it shows: data present, absent, partly absent; a cloud
// model; flagged or not. States the fixture doesn't have are made by changing the state the page gets, per test.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const GUFO = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi";
const enc = encodeURIComponent;
const storyRunHref = (stack: string, run: string, story: string) => `#/vidi/r/${enc(stack)}/${enc(run)}/s/${story}`;
const section = (page: Page, id: string) => page.locator(`[data-page="storyRun"] [data-section="${id}"]`);
const stat = (page: Page, sec: string, term: string) => section(page, sec).locator(`[data-stat="${term}"]`);
const rowOf = (s: State, stack: string, runId: string) => s.rows.find((r) => r.stack === stack && r.runId === runId)!;
const tip = (page: Page) => page.getByRole("tooltip");
const SWIFT_R1_DIR = `combinations/${SWIFT}/benchmarks/vidi/v2-r1`;
const RECOMPUTE_R1 = `uv run backfill_timing.py --recompute ../../../${SWIFT_R1_DIR}`;
const RECOMPUTE_R5 = `uv run backfill_timing.py --recompute ../../../combinations/${SWIFT}/benchmarks/vidi/v2-r5`;
// The problem the owner saw (mlx-serve v2-r2 story 4), and one of each other kind accounting.py's check() records.
const DOUBLE = "wall 13113.4 s differs from the agent's own clock (13111.7 s + 205.8 s between sessions)";
const FAILED_MEANING = "This story run's time figures (the bar, the agent time and the shares) can't be trusted. Its held-out result is unaffected.";
const CLAUDE_MEANING = "This Claude Code run was recorded before the harness read Claude Code's logs for its time, so the whole story counts as “Model, not split” and there is nothing to check. It isn't a fault, and the held-out result is unaffected.";
const CLAUDE_TODO = "nothing is needed for the held-out result. To fill in its time, recompute this record on ";
const OLDER_MEANING = "This story run was recorded before the harness checked its time accounting, so its parts were never verified to add up. The held-out result is unaffected.";
/** Set one story's recorded accounting check. */
const setCheck = (s: State, stack: string, run: string, story: string, check: { status: "ok" | "problems" | "unchecked"; problems: string[] }) => {
  rowOf(s, stack, run).stories.find((x) => x.id === story)!.usage!.split!.check = check;
};

/** Serve the page a changed state for this test: the real one, passed through `change`. */
async function patchState(page: Page, change: (s: State) => void) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

async function open(page: Page, stack: string, run: string, story: string) {
  await page.goto(`/${storyRunHref(stack, run, story)}`);
  await expect(page.locator('[data-page="storyRun"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("header", () => {
  test("breadcrumb, title, the run it belongs to", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.locator("a.combination-link")).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    await expect(crumbs.locator("a.run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r5`);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("story 2");
    await expect(section(page, "header").locator("h1")).toHaveText("Story 2 · Sticky notes");
    await expect(section(page, "header").locator(".of-run a.run-link")).toHaveText("3.8-swift-1.5/27b llamacpp v2-r5");
    await expect(section(page, "header").locator(".of-run")).toContainText("on node-a");
  });

  test("DONE, this story's held-out result and the whole suite so far, both marked live; agent time", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "header").locator('[data-fact="storyStatus"]')).toHaveText("DONE");
    await expect(section(page, "header").locator('[data-fact="own"]')).toHaveText("14/14");
    await expect(section(page, "header").locator('[data-fact="cumulative"]')).toHaveText("20/20");
    await expect(stat(page, "header", "storyHeldOut").locator(".tag-live")).toHaveText("live");
    await expect(stat(page, "header", "cumulativeHeldOut").locator(".tag-live")).toHaveText("live");
    await expect(section(page, "header").locator(".tag-record")).toHaveCount(0);
    await expect(section(page, "header").locator('[data-fact="agentTime"]')).toHaveText("1h20m");
  });

  test("PARTIAL is shown as PARTIAL, with what it means on hover", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r5").stories[1].status = "PARTIAL"; });
    await open(page, SWIFT, "v2-r5", "2");
    const st = section(page, "header").locator('[data-fact="storyStatus"] .story-status');
    await expect(st).toHaveText("PARTIAL");
    await expect(st).toHaveClass(/st-partial/);
    await expect(st).toHaveAttribute("data-tip", GLOSSARY.storyStatus.what);
  });

  test("recorded by dbench before its record: its own result; the rest missing with why", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "2");
    await expect(section(page, "header").locator('[data-fact="own"]')).toHaveText("9/10");
    await expect(section(page, "header").locator('[data-fact="cumulative"] .missing')).toHaveAttribute("data-tip", /dbench reported this story first/);
    await expect(section(page, "header").locator('[data-fact="agentTime"] .missing')).toHaveAttribute("data-tip", "This story's record has no time.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("where the time went", () => {
  test("its bar, larger, with every part's seconds and share", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const t = section(page, "time");
    await expect(t.locator(".big-bar .bar")).toHaveCSS("height", "30px");
    const rows = await t.locator("table.parts tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)));
    expect(rows).toEqual([
      ["Prefill", "222 s", "5%"], ["Generation", "4,188 s", "87%"], ["Model, not split", "0 s", "0%"], ["Compaction", "270 s", "6%"],
      ["Tools", "117 s", "2%"], ["Between sessions", "0 s", "0%"], ["Other", "14 s", "0%"],
    ]);
    await expect(t.locator('tr[data-seg="modelUnsplit"]')).toHaveClass("zero");
    await expect(t.locator(".rp-head")).toContainText("1h20m wall");
  });

  test("the accounting check passed; tools time by kind, longest first", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "time").locator('[data-check="ok"]')).toContainText("✓ passed: the parts add up");
    const kinds = await section(page, "time").locator("[data-kind]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind));
    expect(kinds).toEqual(["unit", "e2e", "build", "bash"]);
    await expect(section(page, "time").locator('[data-kind="unit"]')).toContainText("1 min");
  });

  test("the accounting check passed: says the time figures can be trusted", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "time").locator('[data-check="ok"] .check-meaning')).toHaveText("The parts add up to the wall time and agree with the agent's own clock, so this story run's time figures can be trusted.");
    await expect(section(page, "time").locator(".check-explain")).toHaveCount(0);
  });

  test("the accounting check failed, a call with no end: what it means, the problem in words and as recorded, and that recomputing won't change it", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "1");
    const c = section(page, "time").locator('[data-check="problems"]');
    await expect(c).toContainText("failed");
    const x = section(page, "time").locator(".check-explain");
    await expect(x.locator(".check-meaning")).toHaveText(FAILED_MEANING);
    await expect(x.locator(".problems li .problem-text")).toHaveText(["Tool call t9 has no end in the log, so its time was counted up to the agent's next step."]);
    await expect(x.locator(".problems li .problem-raw")).toHaveText(["tool call t9 never ended; counted to the agent's next step"]);
    await expect(x.locator(".check-cause")).toHaveText("Likely cause: the agent's log has no end for it, usually a session cut off mid-call.");
    await expect(x.locator(".check-todo")).toHaveText("What to do: nothing to fix: recomputing reads the same log and gives the same answer. Read the part it fell in as an upper estimate.");
    await expect(x.locator(".check-command")).toHaveCount(0);
  });

  test("the accounting check failed, waits counted twice, run still going: the older harness's bug, and recompute once it has finished", async ({ page }) => {
    await patchState(page, (s) => setCheck(s, SWIFT, "v2-r1", "1", { status: "problems", problems: [DOUBLE] }));
    await open(page, SWIFT, "v2-r1", "1");
    const x = section(page, "time").locator(".check-explain");
    await expect(x.locator(".problems li .problem-text")).toHaveText(["The wall time (13113.4 s) already matches the agent's own clock (13111.7 s), but 205.8 s of waits between sessions were added on top of it: they were counted twice."]);
    await expect(x.locator(".problems li .problem-raw")).toHaveText([DOUBLE]);
    await expect(x.locator(".check-cause")).toHaveText("Likely cause: an older harness counted the waits between sessions twice (a bug since fixed), and this run is still going on it.");
    await expect(x.locator(".check-todo")).toHaveText(/^What to do: once the run has finished, recompute this record from the full logs on node-a, the machine that ran it, in the repo's benchmarks\/spec-bench\/harness:/);
    await expect(x.locator(".check-command")).toHaveText(RECOMPUTE_R1);
  });

  const KINDS: [string, string, string][] = [
    ["the wall and the agent's clock disagree", "wall 900.0 s differs from the agent's own clock (700.0 s)", "The wall time (900.0 s) doesn't match the agent's own clock (700.0 s)."],
    ["the parts don't add up", "parts sum to 590.0 s, not the wall's 600.0 s", "The parts add up to 590.0 s, but the wall time is 600.0 s."],
    ["a negative part", "negative tools: -3.2 s", "The Tools part is negative (-3.2 s); no part of the time can be."],
    ["tools by kind don't add up", "tools by kind sum to 80.0 s, not tools' 90.0 s", "The tools by kind add up to 80.0 s, but Tools is 90.0 s."],
    ["anything else, as recorded", "the window ends before it starts", "The window ends before it starts."],
  ];
  for (const [what, raw, text] of KINDS) {
    test(`the accounting check failed, ${what}: in words, the generic cause, and the recompute`, async ({ page }) => {
      await patchState(page, (s) => setCheck(s, SWIFT, "v2-r5", "2", { status: "problems", problems: [raw] }));
      await open(page, SWIFT, "v2-r5", "2");
      const x = section(page, "time").locator(".check-explain");
      await expect(x.locator(".problems li .problem-text")).toHaveText([text]);
      await expect(x.locator(".check-cause")).toHaveText("Likely cause: the record was made by a harness with a bug since fixed.");
      await expect(x.locator(".check-todo")).toHaveText(/^What to do: recompute this record from the full logs on /);
      await expect(x.locator(".check-command")).toHaveText(RECOMPUTE_R5);
    });
  }

  test("the failed mark is reached by keyboard and says the same on focus", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "1");
    const flag = section(page, "time").locator('[data-check="problems"] .check-flag');
    await expect(flag).toHaveAttribute("tabindex", "0");
    await flag.focus();
    await expect(tip(page)).toContainText("Accounting check failed. This story run's time figures");
    await expect(tip(page)).toContainText("Tool call t9 has no end in the log");
  });

  test("parts that don't add up to the wall: what's unaccounted, in its own row", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r5").stories[1].usage!.split!.wall = 4911; });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "time").locator('tr[data-seg="unaccounted"]')).toHaveText("Unaccounted100 s2%");
  });

  test("a cloud model: all 'model, not split', unchecked, no tools by kind", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    const t = section(page, "time");
    await expect(t.locator('tr[data-seg="modelUnsplit"]')).toHaveText("Model, not split480 s100%");
    await expect(t.locator('[data-check="unchecked"] .check-unchecked')).toHaveText("unchecked");
    await expect(t.locator(".kinds")).toContainText("not recorded by kind");
  });

  test("unchecked, a Claude Code run from before the harness read its logs: why, that it isn't a fault, and how to fill it in", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    const x = section(page, "time").locator(".check-explain");
    await expect(x.locator(".check-meaning")).toHaveText(CLAUDE_MEANING);
    await expect(x.locator(".check-todo")).toHaveText(new RegExp(`^What to do: ${CLAUDE_TODO}.* It needs the full logs that machine kept: without them this story run can't be checked\\.$`));
    await expect(x.locator(".check-command")).toHaveText(/^uv run backfill_timing\.py --recompute \.\.\/\.\.\/\.\.\/.*run-9$/);
    await expect(x.locator(".check-cause, .problems")).toHaveCount(0);
    const mark = section(page, "time").locator('[data-check="unchecked"] .check-unchecked');
    await mark.focus();
    await expect(tip(page)).toContainText(`Unchecked: no accounting check was made. ${CLAUDE_MEANING} What to do: ${CLAUDE_TODO}`);
  });

  test("unchecked, an older run: recorded before the harness checked; recompute where the full logs are, else it can't be checked", async ({ page }) => {
    await patchState(page, (s) => setCheck(s, SWIFT, "v2-r5", "2", { status: "unchecked", problems: [] }));
    await open(page, SWIFT, "v2-r5", "2");
    const x = section(page, "time").locator(".check-explain");
    await expect(x.locator(".check-meaning")).toHaveText(OLDER_MEANING);
    await expect(x.locator(".check-todo")).toHaveText(/^What to do: to check it, recompute this record on .*, the machine that ran it, in the repo's benchmarks\/spec-bench\/harness\. It needs the full logs that machine kept: without them this story run can't be checked\.$/);
    await expect(x.locator(".check-command")).toHaveText(RECOMPUTE_R5);
  });

  test("the label 'Accounting check' says what the check is", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "time").locator('.check .term')).toHaveAttribute("data-tip", GLOSSARY.accountingCheck.what);
    expect(GLOSSARY.accountingCheck.what).toMatch(/held-out score/);
  });

  test("no split recorded: says so", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "2");
    await expect(section(page, "time").locator(".rp-empty")).toHaveText("No time split recorded for this story: its record has no usage.");
  });

  test("the segments have hovers that explain them", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(section(page, "time").locator('.big-bar [data-seg="betweenSessions"]')).toHaveAttribute("data-tip", /Between sessions 1\.0 min: the harness restarting the agent/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("cost", () => {
  test("tokens, calls and every speed", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const want: [string, string][] = [
      ["outTokens", "175,000"], ["inputRead", "5.0M"], ["calls", "204"], ["tokS", "36.3"], ["decodeTokS", "41.7"], ["prefillTokS", "750.0"],
      ["compactions", "2"], ["nudges", "0"],
    ];
    for (const [term, text] of want) await expect(stat(page, "cost", term).locator(".stat-value"), term).toHaveText(text);
    await expect(stat(page, "cost", "inputRead").locator(".stat-sub")).toHaveText("90% cached");
  });

  test("draft acceptance where the engine drafts; '—' with why where it doesn't", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(stat(page, "cost", "draftAcceptance").locator(".stat-value")).toHaveText("85%");
    await open(page, SWIFT, "v2-r5", "2");
    await expect(stat(page, "cost", "draftAcceptance").locator(".missing")).toHaveAttribute("data-tip", /speculative decoding/);
  });

  test("a cloud model: no decode or prefill speed, and says it's a cloud model", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(stat(page, "cost", "decodeTokS").locator(".missing")).toHaveAttribute("data-tip", /cloud model/);
    await expect(stat(page, "cost", "prefillTokS").locator(".missing")).toHaveAttribute("data-tip", /cloud model/);
    await expect(stat(page, "cost", "compactions").locator(".stat-value")).toHaveText("0");  // zero, not missing
  });

  test("no usage: says so", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "2");
    await expect(section(page, "cost").locator(".rp-empty")).toContainText("No usage recorded for this story");
    await expect(section(page, "cost").locator(".stat")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("conversation profile", () => {
  const LONG_GIST = "cd ~/.vidi-bench/work/qwen__3.8__flash-next__macos__128GB__mlxserve-pi__benchmarks__vidi__v2-r2/workspace && for i in 1 ";

  test("a long longest-tool-call gist stays on one line, cut with an ellipsis, the whole of it on hover and keyboard focus", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r5").stories[1].conversation!.longestTool = { seconds: 505.8, name: "bash", gist: LONG_GIST }; });
    await open(page, SWIFT, "v2-r5", "2");
    const sub = stat(page, "conversation", "longestTool").locator(".stat-sub");
    const gist = sub.locator(".tool-gist");
    const box = (await sub.boundingBox())!;
    const lineHeight = await sub.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect(box.height).toBeLessThan(lineHeight * 1.5);                                       // one line, not a tall column
    await expect(gist).toHaveCSS("text-overflow", "ellipsis");
    expect(await gist.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);        // cut, not wrapped
    await expect(gist).toHaveAttribute("tabindex", "0");
    await gist.focus();
    await expect(tip(page)).toHaveText(`bash: ${LONG_GIST.trim()}`);
  });

  test("every figure, from the harness's count", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const want: [string, string, string | null][] = [
      ["modelCalls", "207", "204 tool calls"],
      ["thinking", "328,750 chars", "median 424 per call"],
      ["thinkingMedian", "80 → 464", "5.8× after the largest block"],
      ["largestThinking", "64,543 chars", "call 14, 8 min in"],
      ["contextGrowth", "9k → 120k tokens", "grew 13.3×"],
      ["contextJump", "+16,607 tokens", "into call 15"],
      ["toolErrors", "5", null],
      ["longestTool", "62 s", "bash: npm run test:unit"],
    ];
    for (const [term, value, sub] of want) {
      await expect(stat(page, "conversation", term).locator(".stat-value"), term).toHaveText(value);
      if (sub) await expect(stat(page, "conversation", term).locator(".stat-sub"), term).toHaveText(sub);
    }
    await expect(section(page, "conversation").locator(".rp-head")).toContainText("no LLM");
  });

  test("tools by name, most used first", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "conversation").locator("[data-tool]")).toHaveText(["bash 115", "edit 40", "write 28", "read 21"]);
  });

  test("the retired long-thinking signal isn't shown on its own: judged against the combination instead", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "conversation").locator('[data-list="signals"]')).toContainText("none");
    await expect(page.locator('[data-page="storyRun"]')).not.toContainText("long-thinking-block");
    await expect(page.locator('[data-page="storyRun"]')).not.toContainText("very long thinking block");
  });

  test("a signal the harness raises is shown in words", async ({ page }) => {
    await open(page, SWIFT, "v2-r6", "1");
    await expect(section(page, "conversation").locator(".signal-list li")).toHaveText(["a command that hung"]);
  });

  test("parts the harness couldn't count: '—' with why, and no ratio from them", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5").stories[1].conversation!, {
      thinkingMedianBefore: null, thinkingMedianAfter: null, largestThinking: null, contextStart: null, largestContextJump: null, longestTool: null,
    }));
    await open(page, SWIFT, "v2-r5", "2");
    const before = stat(page, "conversation", "thinkingMedian").locator('[data-fact="before"] .missing');
    await expect(before).toHaveAttribute("data-tip", /couldn't count thinking before the largest block/);
    await expect(stat(page, "conversation", "thinkingMedian").locator(".stat-sub")).toHaveCount(0);
    await expect(stat(page, "conversation", "largestThinking").locator(".missing")).toBeVisible();
    await expect(stat(page, "conversation", "contextGrowth").locator(".stat-sub")).toHaveCount(0);
    await expect(stat(page, "conversation", "contextJump").locator(".missing")).toBeVisible();
    await expect(stat(page, "conversation", "longestTool").locator(".missing")).toBeVisible();
  });

  test("not recorded: says so, instead of zeros", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(section(page, "conversation").locator('[data-empty="conversation"]')).toContainText("Not recorded for this story");
    await expect(section(page, "conversation").locator(".stat")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("against the combination", () => {
  test("every run of the combination, in order, this story run marked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const a = section(page, "against");
    const runs = await a.locator("tbody tr[data-run]").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.run));
    expect(runs).toContain("v2-r5");
    expect(runs).toEqual(runs.toSorted((x, y) => x!.localeCompare(y!, "en", { numeric: true })));
    const me = a.locator('tr[data-run="v2-r5"]');
    await expect(me).toHaveClass(/is-this/);
    await expect(me).toHaveAttribute("aria-current", "page");
    await expect(me.locator(".this-mark")).toHaveText("this story run");
    await expect(a.locator("tr.is-this")).toHaveCount(1);
  });

  test("more than 10% from the others' median: marked, on time, output tokens, calls and thinking", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const me = section(page, "against").locator('tr[data-run="v2-r5"]');
    const flagged = await me.locator('[data-flagged="true"]').evaluateAll((tds) => tds.map((td) => (td as HTMLElement).dataset.measure));
    expect(flagged).toEqual(["heldOut", "minutes", "outTokens", "calls", "thinking", "largestThinking"]);
    await expect(me.locator('[data-measure="minutes"] .diff')).toHaveText("⚑ +381%");
    await expect(me.locator('[data-measure="minutes"] .diff')).toHaveAttribute("data-tip", /The median of the other 3 runs: 17 min/);
    const median = section(page, "against").locator("tr.median-row");
    await expect(median.locator('[data-measure="minutes"]')).toHaveText("17 min n=3");
    await expect(median.locator('[data-measure="outTokens"]')).toHaveText("72k n=3");
  });

  test("within 10% of the others' median: nothing marked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    await expect(section(page, "against").locator('[data-flagged="true"]')).toHaveCount(0);
  });

  test("only this story run is ever marked, never the others", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "against").locator('tr:not(.is-this) [data-flagged="true"]')).toHaveCount(0);
  });

  test("small multiple: the bars share one scale", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const a = section(page, "against");
    const mine = (await a.locator('tr[data-run="v2-r5"] .bar').boundingBox())!.width;
    const r4 = (await a.locator('tr[data-run="v2-r4"] .bar').boundingBox())!.width;
    expect(r4 / mine).toBeCloseTo(960 / 4811, 2);
  });

  test("runs without the story, or without its figures, say which", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const a = section(page, "against");
    await expect(a.locator('tr[data-run="v2-r2"] .bar-col')).toHaveText("queued: not started yet");
    await expect(a.locator('tr[data-run="v2-r1"] .bar-col')).toHaveText("no time split recorded");
    await expect(a.locator('tr[data-run="v2-r1"] [data-measure="minutes"] .missing')).toHaveAttribute("data-tip", "Not recorded for this story run.");
  });

  test("a running run that hasn't reached the story says so, not that it wasn't built", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r1"); r.stories = r.stories.filter((x) => x.id === "1"); r.live!.runningStory = "1"; r.storiesWorking.squares = r.storiesWorking.squares.map((q) => ({ ...q, state: q.id === "1" ? "running" : "unbuilt" })); });
    await open(page, SWIFT, "v2-r5", "2");
    const cell = section(page, "against").locator('tr[data-run="v2-r1"] .bar-col');
    await expect(cell).toHaveText("hasn't reached this story yet");
    await cell.locator("[data-tip]").focus();
    await expect(tip(page)).toHaveText("Not built yet: the run is at story 1.");
  });

  test("a running run on the story now: being built", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r1"); r.stories = r.stories.filter((x) => x.id === "1"); r.live!.runningStory = "2"; r.storiesWorking.squares = r.storiesWorking.squares.map((q) => ({ ...q, state: q.id === "2" ? "running" : q.state === "running" ? "unbuilt" : q.state })); });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "against").locator('tr[data-run="v2-r1"] .bar-col')).toHaveText("building this story now");
  });

  test("a finished run that never recorded the story: not built in this run", async ({ page }) => {
    await patchState(page, (s) => { const r = rowOf(s, SWIFT, "v2-r4"); r.stories = r.stories.filter((x) => x.id !== "2"); });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "against").locator('tr[data-run="v2-r4"] .bar-col')).toHaveText("not built in this run");
  });

  test("a failed check in the table: its mark explains itself on keyboard focus", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    const flag = section(page, "against").locator('tr[data-run="v2-r1"] .check-flag');
    await expect(flag).toHaveAttribute("tabindex", "0");
    await flag.focus();
    await expect(tip(page)).toContainText("Accounting check failed. This story run's time figures");
    await expect(tip(page)).toContainText("Likely cause: the agent's log has no end for it");
  });

  test("a run without a conversation profile: its thinking missing, and left out of the thinking median", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    const a = section(page, "against");
    await expect(a.locator('tr[data-run="v2-r7"] [data-measure="thinking"] .missing')).toHaveAttribute("data-tip", "No conversation profile for this story run.");
    await expect(a.locator('tr.median-row [data-measure="thinking"]')).toContainText("n=3");
    await expect(a.locator('tr.median-row [data-measure="minutes"]')).toContainText("n=4");
  });

  test("each other run links to its run and to the same story there", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const r4 = section(page, "against").locator('tr[data-run="v2-r4"]');
    await expect(r4.locator("a.run-link")).toHaveAttribute("href", `#/vidi/r/${enc(SWIFT)}/v2-r4`);
    await r4.locator("a.story-run-link").click();
    await expect(page.locator('[data-page="storyRun"] .of-run a.run-link')).toContainText("v2-r4");
  });

  test("no run of the combination has the story: says so, no empty table", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "3");
    await expect(section(page, "against").locator(".rp-empty")).toHaveText("No run of this combination has recorded story 3 yet, so there is nothing to set this story run against.");
    await expect(section(page, "against").locator("table")).toHaveCount(0);
  });

  test("the only run with figures: no median, '—' with why", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(section(page, "against").locator('tr.median-row [data-measure="minutes"] .missing')).toHaveAttribute("data-tip", /no median to compare with/);
    await expect(section(page, "against").locator('[data-flagged="true"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Held-out beside the cost: SWIFT story 2 is 14/14 in v2-r5 against 9/10, 12/14, 11/14 and 13/14 in v2-r1, v2-r4, v2-r6
// and v2-r7 (v2-r8 is invalid: in no median), so the median is 88%, between 12/14 and 9/10.
test.describe("against the combination: held-out", () => {
  const heldOut = (page: Page, run: string) => section(page, "against").locator(`tr[data-run="${run}"] [data-measure="heldOut"]`);

  test("a column of each run's own result for this story, first among the measures, under its glossary term", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const a = section(page, "against");
    await expect(a.locator("thead th.n").first()).toHaveText(GLOSSARY.storyRunHeldOut.name);
    await expect(a.locator("thead th.n .term").first()).toHaveAttribute("data-tip", GLOSSARY.storyRunHeldOut.what);
    await expect(heldOut(page, "v2-r4")).toHaveText("12/14");
    await expect(heldOut(page, "v2-r6")).toHaveText("11/14");
    await expect(heldOut(page, "v2-r1")).toHaveText("9/10");             // its own tests, not the whole suite so far
  });

  test("above the others' median by more than 10%: flagged, and the median row has it", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(heldOut(page, "v2-r5")).toHaveAttribute("data-flagged", "true");
    await expect(heldOut(page, "v2-r5").locator(".diff")).toHaveText("⚑ +14%");
    await expect(heldOut(page, "v2-r5").locator(".diff")).toHaveAttribute("data-tip", /The median of the other 4 runs: 88%\./);
    await expect(section(page, "against").locator('tr.median-row [data-measure="heldOut"]')).toHaveText("88% n=4");
  });

  test("below by more than 10%: flagged, negative", async ({ page }) => {
    await open(page, SWIFT, "v2-r6", "2");                               // 11/14 against 9/10, 12/14, 14/14, 13/14: median 91%
    await expect(heldOut(page, "v2-r6")).toHaveAttribute("data-flagged", "true");
    await expect(heldOut(page, "v2-r6").locator(".diff")).toHaveText("⚑ −14%");
  });

  test("within 10%: not flagged", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");                               // 6/6 against a median of 6/6
    await expect(heldOut(page, "v2-r5")).toHaveText("6/6");
    await expect(heldOut(page, "v2-r5")).not.toHaveAttribute("data-flagged", "true");
  });

  test("a run without its held-out result: '—' with why, never 0, and out of the median", async ({ page }) => {
    await patchState(page, (s) => { const st = rowOf(s, SWIFT, "v2-r4").stories.find((x) => x.id === "2")!; st.ownPassed = null; st.ownTotal = null; });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(heldOut(page, "v2-r4").locator(".missing")).toHaveAttribute("data-tip", "Its own held-out tests weren't recorded.");
    await expect(heldOut(page, "v2-r4")).not.toContainText("0");
    await expect(section(page, "against").locator('tr.median-row [data-measure="heldOut"]')).toHaveText("90% n=3");   // 9/10, 11/14, 13/14
  });
});

// The mechanism behind each flag: the combination page's rules, against the same story's other valid runs.
test.describe("against the combination: why it differs", () => {
  const me = (page: Page) => section(page, "against").locator("tr.is-this");

  test("every flag carries the mechanism, under it", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const flagged = me(page).locator('[data-flagged="true"]');
    await expect(flagged).toHaveCount(6);
    for (const td of await flagged.all()) await expect(td.locator(".mech")).toHaveText("verbose thinking");
  });

  test("the flag's hover: the median, the mechanism, and every rule that fired with its numbers", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const tip = await me(page).locator('[data-measure="minutes"] .diff').getAttribute("data-tip");
    expect(tip).toContain("The median of the other 3 runs: 17 min.");
    expect(tip).toContain("Mechanism: verbose thinking.");
    expect(tip).toContain("verbose thinking: thinking per call 1,588 chars against 95 (16.7×)");   // v2-r4, r6, r7: not the invalid r8
    expect(tip).toContain("slower generation: decode 41.7 tok/s against 99.0");
    await me(page).locator('[data-measure="minutes"] .mech').hover();
    await expect(page.getByRole("tooltip")).toContainText("Mechanism: verbose thinking.");
  });

  test("many small steps", async ({ page }) => {
    await open(page, SWIFT, "v2-r6", "2");                               // 264 model calls against 120, thinking per call alike
    await expect(me(page).locator('[data-measure="calls"] .mech')).toHaveText("many small steps");
    await expect(me(page).locator('[data-measure="calls"] .diff')).toHaveAttribute("data-tip", /many small steps: 264 model calls against 120/);
  });

  test("hung command", async ({ page }) => {
    await open(page, SWIFT, "v2-r6", "1");                               // 25 min against 12 min: one tool call took most of it
    await expect(me(page).locator('[data-measure="minutes"] .mech')).toHaveText("hung command");
    await expect(me(page).locator('[data-measure="minutes"] .diff')).toHaveAttribute("data-tip", /Mechanism: hung command\. hung command: one /);
  });

  test("unexplained: no rule fired, and the hover says so", async ({ page }) => {
    await open(page, SWIFT, "v2-r4", "2");                               // below the median on time, tokens, calls, thinking
    await expect(me(page).locator('[data-measure="calls"] .mech')).toHaveText("unexplained");
    await expect(me(page).locator('[data-measure="calls"] .diff')).toHaveAttribute("data-tip", /Mechanism: unexplained\. None of the rules fired/);
  });

  test("not recorded: no conversation profile to explain it", async ({ page }) => {
    await open(page, SWIFT, "v2-r7", "1");                               // 90k output tokens against 60k, no profile
    await expect(me(page).locator('[data-measure="outTokens"] .mech')).toHaveText("not recorded");
  });

  test("below the median: the hover says the rules look for what makes a figure higher", async ({ page }) => {
    await open(page, SWIFT, "v2-r4", "2");                               // 16 min against 18 min
    await expect(me(page).locator('[data-measure="minutes"] .diff')).toHaveText("⚑ −11%");
    await expect(me(page).locator('[data-measure="minutes"] .diff')).toHaveAttribute("data-tip", new RegExp(`${BELOW_CAVEAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  });

  test("held-out: the hover says the rules explain cost, not quality", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(me(page).locator('[data-measure="heldOut"] .diff')).toHaveAttribute("data-tip", new RegExp(`${HELD_OUT_CAVEAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  });

  test("nothing flagged: no mechanism shown", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    await expect(section(page, "against").locator(".mech")).toHaveCount(0);
  });

  test("the mechanism can be read from the keyboard: focus the flag", async ({ page }) => {
    await open(page, SWIFT, "v2-r6", "2");
    const flag = me(page).locator('[data-measure="calls"] .diff');
    await expect(flag).toHaveAttribute("tabindex", "0");
    await flag.focus();
    await expect(page.getByRole("tooltip")).toContainText("Mechanism: many small steps.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// This story run beside the most typical other one: for SWIFT story 2 and v2-r5 that is v2-r7, nearest the median row
// (v2-r4 is a little further off, v2-r6 has 2.2× the calls, v2-r1 has only its held-out result, v2-r8 is invalid).
test.describe("what differed", () => {
  const d = (page: Page) => section(page, "differed");
  const tr = (page: Page, key: string) => d(page).locator(`tr[data-row="${key}"]`);
  const pick = (page: Page) => d(page).getByRole("combobox", { name: /compare with/i });

  test("starts with the most typical other run, says so, and names the rule in the glossary", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(d(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.whatDiffered.what);
    await expect(pick(page)).toHaveValue("v2-r7");
    await expect(pick(page).locator("option:checked")).toContainText("most typical");
    await expect(d(page).locator('.term[data-tip="' + GLOSSARY.typicalRun.what.replace(/"/g, '\\"') + '"]')).toHaveCount(1);
    await expect(d(page).locator("thead a.story-run-link")).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r7", "2"));
  });

  test("each row: both figures and this one over the other, marked where more than 10% apart", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(tr(page, "heldOut").locator(".a")).toHaveText("14/14");
    await expect(tr(page, "heldOut").locator(".b")).toHaveText("13/14");
    await expect(tr(page, "heldOut").locator(".ratio")).toHaveText("1.1×");
    await expect(tr(page, "heldOut")).not.toHaveAttribute("data-differs", "true");   // 8% apart
    await expect(tr(page, "minutes").locator(".a")).toHaveText("1h20m");
    await expect(tr(page, "minutes").locator(".b")).toHaveText("17 min");
    await expect(tr(page, "minutes").locator(".ratio")).toHaveText("4.8×");
    await expect(tr(page, "minutes")).toHaveAttribute("data-differs", "true");
    await expect(tr(page, "thinking").locator(".ratio")).toHaveText("29×");
  });

  test("the conversation's figures, tools by kind and tool calls by tool, under the glossary's names", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    for (const key of ["modelCalls", "thinking", "thinkingMedian", "thinkingAfter", "largestThinking", "contextEnd", "contextGrowth", "contextJump", "toolErrors", "longestTool"]) {
      await expect(tr(page, key), key).toHaveCount(1);
    }
    await expect(tr(page, "largestThinking").locator("th .term")).toHaveAttribute("data-tip", GLOSSARY.largestThinking.what);
    await expect(d(page).locator('tr[data-row^="tool:"]').first()).toBeVisible();
    await expect(d(page).locator('tr[data-row^="toolKind:"]').first()).toBeVisible();
  });

  test("choose another run: its figures, kept in the address across a reload", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await pick(page).selectOption("v2-r6");
    await expect(tr(page, "heldOut").locator(".b")).toHaveText("11/14");
    await expect(page).toHaveURL(/[?&]compare=v2-r6/);
    await page.reload();
    await expect(pick(page)).toHaveValue("v2-r6");
    await expect(tr(page, "heldOut").locator(".b")).toHaveText("11/14");
  });

  test("every other run that recorded the story can be chosen, the invalid one marked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const values = await pick(page).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values.toSorted()).toEqual(["v2-r1", "v2-r4", "v2-r6", "v2-r7", "v2-r8"]);
    await expect(pick(page).locator('option[value="v2-r8"]')).toContainText("invalid");
  });

  test("the other run has no conversation profile: says so plainly in its column", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    await pick(page).selectOption("v2-r7");
    const none = d(page).locator('.no-profile[data-side="b"]');
    await expect(none).toHaveCount(1);
    await expect(none).toContainText("v2-r7 has no conversation profile for this story");
    await expect(tr(page, "thinking").locator(".a")).toHaveText("8,000");
    await expect(tr(page, "minutes").locator(".b")).toHaveText("12 min");         // its usage is still there
  });

  test("neither has a profile: one line says so", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(pick(page)).toHaveValue("v2-r1");                                // the only other run with story 1
    await expect(d(page).locator('.no-profile[data-side="both"]')).toContainText("Neither story run has a conversation profile");
    await expect(d(page).locator('tr[data-row="thinking"]')).toHaveCount(0);
  });

  test("a figure one side lacks: '—' with why", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");                                         // v2-r1 has recorded story 1 but no usage yet
    await expect(tr(page, "minutes").locator(".b .missing")).toHaveAttribute("data-tip", "No usage recorded for this story run.");
    await expect(tr(page, "minutes").locator(".ratio .missing")).toHaveAttribute("data-tip", /no ratio/);
  });

  test("no other run recorded the story: says so, nothing to choose", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(d(page).locator(".rp-empty")).toHaveText("No other run of this combination has recorded story 1, so there is nothing to compare it with.");
    await expect(d(page).locator("select")).toHaveCount(0);
  });

  test("the address names a run that can't be compared: says so, and shows the most typical", async ({ page }) => {
    await page.goto(`/${storyRunHref(SWIFT, "v2-r5", "2")}?compare=v2-r99`);
    await expect(d(page).locator("[data-unknown]")).toContainText("v2-r99");
    await expect(pick(page)).toHaveValue("v2-r7");
  });

  test("not shown for a story run that isn't recorded", async ({ page }) => {
    await open(page, SWIFT, "v2-r2", "2");
    await expect(d(page)).toHaveCount(0);
  });

  test("from the keyboard: the run picker and every '—' can be reached, with a name", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(pick(page)).toBeEnabled();
    await pick(page).focus();
    await expect(pick(page)).toBeFocused();
    const missing = tr(page, "minutes").locator(".b .missing");
    await missing.focus();
    await expect(page.getByRole("tooltip")).toHaveText("No usage recorded for this story run.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// How every combination fares on this story. In the fixture, v2 story 2 is recorded by SWIFT (v2-r4 to r7 finished,
// v2-r1 running, v2-r8 invalid) and by OPUS (run-9 finished, with only its held-out result; v2-r1 is building it);
// 3.8/27b is only queued or cancelled and mlx-serve is on story 1, so neither has a record of it.
test.describe("against every combination", () => {
  const MLX = "qwen/3.8/flash-next/macos/128GB/mlxserve-pi";
  const a = (page: Page) => section(page, "across");
  const combo = (page: Page, stack: string) => a(page).locator(`tr[data-stack="${stack}"]`);
  const mine = (page: Page) => a(page).locator('tr[data-row="this"]');
  const cell = (page: Page, stack: string, measure: string) => combo(page, stack).locator(`td[data-measure="${measure}"]`);
  const stacksShown = (page: Page) => a(page).locator("tr[data-stack]").evaluateAll((trs) => trs.map((t) => (t as HTMLElement).dataset.stack));
  const barShare = (bar: ReturnType<Page["locator"]>, part: string) => bar.evaluate((el, sel) => {
    const p = el.querySelector(sel) as HTMLElement;
    return p.getBoundingClientRect().width / el.getBoundingClientRect().width;
  }, part);
  const NARROW = 1000, WIDE = 1440;

  test("under its glossary term, with a link to every run of the story", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(a(page).locator("h2 .term")).toHaveText(GLOSSARY.acrossCombinations.name);
    await expect(a(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.acrossCombinations.what);
    const all = a(page).locator(".rp-aside a.story-link");
    await expect(all).toHaveText("all runs of this story");
    await all.click();
    await expect(page).toHaveURL(/#\/vidi\/s\/2$/);
    await expect(page.locator('[data-page="story"]')).toContainText("Story 2");
  });

  test("several combinations: one row for each that recorded the story, in the story page's order, this one's marked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    expect(await stacksShown(page)).toEqual([OPUS, SWIFT]);   // 90% median held-out before 89%
    await expect(combo(page, SWIFT)).toHaveAttribute("data-this", "true");
    await expect(combo(page, SWIFT).locator(".this-combo")).toHaveText("this run's combination");
    await expect(combo(page, OPUS)).not.toHaveAttribute("data-this", "true");
    await expect(combo(page, OPUS).locator(".this-combo")).toHaveCount(0);
    await page.goto(`/#/vidi/s/2`);
    const onStoryPage = await page.locator('[data-section="combinations"] tbody[data-stack]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.stack));
    expect(onStoryPage.slice(0, 2)).toEqual([OPUS, SWIFT]);
  });

  test("a combination's row: n, and each measure's median and range over its valid finished runs", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const runs = combo(page, SWIFT).locator('td[data-col="runs"]');
    await expect(runs.locator("b")).toHaveText("n=4");
    await expect(runs.locator('[data-unfinished="running"]')).toHaveText("+1 running");
    await expect(runs.locator("[data-invalid-runs]")).toHaveText("1 invalid, left out");
    await expect(cell(page, SWIFT, "heldOut").locator(".median")).toHaveText("89%");
    await expect(cell(page, SWIFT, "heldOut").locator(".range")).toHaveText("79%–100%");
    await expect(cell(page, SWIFT, "minutes").locator(".median")).toHaveText("17 min");
    await expect(cell(page, SWIFT, "minutes").locator(".range")).toHaveText("16 min–1h20m");
    await expect(cell(page, SWIFT, "outTokens").locator(".median")).toHaveText("76k");
    await expect(cell(page, SWIFT, "outTokens").locator(".range")).toHaveText("70k–175k");
    await expect(cell(page, SWIFT, "calls").locator(".median")).toHaveText("161");
    await expect(cell(page, SWIFT, "calls").locator(".range")).toHaveText("112–262");
  });

  test("the medians are the story page's own", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const here = await cell(page, SWIFT, "minutes").locator(".median").innerText();
    await page.goto(`/#/vidi/s/2`);
    await expect(page.locator(`tr[data-median="${SWIFT}"] td[data-measure="minutes"] .median`)).toHaveText(here);
  });

  test("this story run's own figures on the first row, clearly marked", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(a(page).locator("tbody tr").first()).toHaveAttribute("data-row", "this");
    await expect(mine(page)).toHaveAttribute("aria-current", "page");
    await expect(mine(page).locator(".this-mark")).toHaveText("this story run");
    await expect(mine(page).locator("th .run-id")).toHaveText("v2-r5");
    await expect(mine(page).locator('td[data-measure="heldOut"]')).toHaveText("100%14/14");
    await expect(mine(page).locator('td[data-measure="minutes"]')).toHaveText("1h20m");
    await expect(mine(page).locator('td[data-measure="outTokens"]')).toHaveText("175k");
    await expect(mine(page).locator('td[data-measure="calls"]')).toHaveText("204");
  });

  test("the time bars share one scale, and this story run's time is marked on every combination's bar", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    // v2-r5's 1h20m is the longest time here, so its bar is the whole scale; SWIFT's median is 17.3 of 80.2 minutes.
    expect(await barShare(mine(page).locator(".across-bar"), ".med")).toBeCloseTo(1, 2);
    const swift = combo(page, SWIFT).locator(".across-bar");
    expect(await barShare(swift, ".med")).toBeCloseTo(1040 / 4811, 2);
    expect(await barShare(swift, ".whisker")).toBeCloseTo((4811 - 960) / 4811, 2);
    await expect(swift.locator(".mine-mark")).toHaveAttribute("style", /left: 100%/);
    await expect(swift).toHaveAttribute("aria-label", "3.8-swift-1.5/27b llamacpp: median 17 min, from 16 min to 1h20m");
    await expect(a(page).locator(".across-key")).toContainText("this story run (1h20m)");
  });

  test("a measure the combination's runs didn't record: '—' with why, never 0, and no bar", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(combo(page, OPUS)).toHaveAttribute("data-state", "measured");
    await expect(combo(page, OPUS).locator('td[data-col="runs"] b')).toHaveText("n=1");
    await expect(cell(page, OPUS, "heldOut").locator(".median")).toHaveText("90%");
    await expect(cell(page, OPUS, "heldOut").locator(".range")).toHaveCount(0);   // one run: no range
    for (const [measure, name] of [["minutes", "agent time"], ["outTokens", "output tokens"], ["calls", "tool calls"]]) {
      await expect(cell(page, OPUS, measure)).toHaveText("—");
      await expect(cell(page, OPUS, measure).locator(".missing")).toHaveAttribute("data-tip", `No finished run of this combination recorded its ${name} for story 2.`);
    }
    await expect(combo(page, OPUS).locator(".across-bar")).toHaveCount(0);
  });

  test("a combination with only invalid runs: kept, 'no valid runs yet', every figure '—' with why", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, OPUS, "run-9").invalid = { reason: "built in a sandbox that exposed the machine's packages", since: "2026-10-01" }; });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(combo(page, OPUS)).toHaveAttribute("data-state", "noValid");
    await expect(combo(page, OPUS).locator('td[data-col="runs"] .no-median')).toHaveText("no valid runs yet");
    await expect(combo(page, OPUS).locator("[data-invalid-runs]")).toHaveText("1 invalid, left out");
    await expect(combo(page, OPUS).locator("td[data-measure] .missing")).toHaveCount(4);
    await expect(cell(page, OPUS, "heldOut").locator(".missing")).toHaveAttribute("data-tip", "No valid runs yet: the one run of this combination that recorded story 2 is invalid, and an invalid run is in no figure.");
    expect(await stacksShown(page)).toEqual([SWIFT, OPUS]);   // nothing to rank it by: after the measured one
  });

  test("a combination whose only run with the story is still running: 'no finished run yet', the run counted as running", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, OPUS, "run-9").status = "running"; });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(combo(page, OPUS)).toHaveAttribute("data-state", "unfinished");
    await expect(combo(page, OPUS).locator('td[data-col="runs"] .no-median')).toHaveText("no finished run yet");
    await expect(combo(page, OPUS).locator('[data-unfinished="running"]')).toHaveText("+1 running");
    await expect(cell(page, OPUS, "heldOut").locator(".missing")).toHaveAttribute("data-tip", /^No finished run yet: story 2 is recorded only by runs that haven't finished \(1 running\)/);
  });

  test("combinations with no record of the story aren't rows; how many is said, with the way to them", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(combo(page, MLX)).toHaveCount(0);
    const left = a(page).locator("tr[data-without-record]");
    await expect(left).toHaveAttribute("data-without-record", "3");
    await expect(left).toContainText("3 other combinations have no record of story 2 yet");
    await expect(left.locator("a.story-link")).toHaveAttribute("href", "#/vidi/s/2");
  });

  test("only this combination has recorded it: its one row, and nothing about others when there are none", async ({ page }) => {
    await patchState(page, (s) => { s.rows = s.rows.filter((r) => r.stack === SWIFT); });
    await open(page, SWIFT, "v2-r5", "2");
    expect(await stacksShown(page)).toEqual([SWIFT]);
    await expect(a(page).locator("tr[data-without-record]")).toHaveCount(0);
    await expect(mine(page)).toBeVisible();
  });

  test("runs of another spec version are not in it", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    await expect(combo(page, GUFO)).toHaveCount(0);   // its only run of story 1 is a v1 run
    await expect(combo(page, SWIFT).locator('td[data-col="runs"] b')).toHaveText("n=4");
  });

  test("a story run without a figure: '—' with why on its own row, never 0", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "2");
    await expect(mine(page).locator('td[data-measure="heldOut"]')).toHaveText("90%9/10");
    await expect(mine(page).locator('td[data-measure="minutes"]')).toHaveText("—");
    await expect(mine(page).locator('td[data-measure="minutes"] .missing')).toHaveAttribute("data-tip", /Not recorded/);
    await expect(mine(page).locator(".across-bar")).toHaveCount(0);
    await expect(combo(page, SWIFT).locator(".mine-mark")).toHaveCount(0);
  });

  test("a story run not recorded yet: says so on its row; the combinations that have it are still shown", async ({ page }) => {
    await open(page, OPUS, "v2-r1", "2");
    await expect(mine(page).locator('td[data-col="runs"]')).toHaveText("not recorded yet");
    await expect(mine(page).locator("td[data-measure] .missing")).toHaveCount(4);
    await expect(mine(page).locator('td[data-measure="minutes"] .missing')).toHaveAttribute("data-tip", "The run is building this story now: it has no record of it until the story ends.");
    expect(await stacksShown(page)).toEqual([OPUS, SWIFT]);
    await expect(combo(page, OPUS)).toHaveAttribute("data-this", "true");
  });

  test("no combination has recorded the story: this run's combination alone, saying so", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "3");
    expect(await stacksShown(page)).toEqual([SWIFT]);
    await expect(combo(page, SWIFT)).toHaveAttribute("data-state", "notRecorded");
    await expect(combo(page, SWIFT).locator('td[data-col="runs"]')).toHaveText("not recorded yet");
    await expect(cell(page, SWIFT, "minutes").locator(".missing")).toHaveAttribute("data-tip", "No run of this combination has recorded story 3 yet.");
  });

  test("not shown for a story outside the run's scope", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "99");
    await expect(a(page)).toHaveCount(0);
  });

  test("each combination's name opens its page", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(combo(page, SWIFT).locator("a.combination-link")).toHaveAttribute("href", `#/vidi/c/${enc(SWIFT)}`);
    await combo(page, OPUS).locator("a.combination-link").click();
    await expect(page).toHaveURL(new RegExp(`#/vidi/c/${enc(OPUS)}$`));
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  test("from the keyboard: a combination's link takes focus, visibly, and Enter opens it; a '—' says why on focus", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const dash = cell(page, OPUS, "minutes").locator(".missing");
    await dash.focus();
    await expect(tip(page)).toContainText("No finished run of this combination recorded its agent time for story 2.");
    await expect(dash).toHaveAttribute("aria-label", /^not available: /);
    const link = combo(page, OPUS).locator("a.combination-link");
    await link.focus();
    await expect(link).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  for (const width of [NARROW, WIDE]) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height: 900 } });
      test("no sideways scroll, on the page or in the table", async ({ page }) => {
        await open(page, SWIFT, "v2-r5", "2");
        await expect(a(page)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const [scroll, client] = await a(page).locator(".table-scroll").evaluate((el) => [el.scrollWidth, el.clientWidth]);
        expect(scroll).toBeLessThanOrEqual(client);
      });
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: this story run's row and bar stand out from the others`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, SWIFT, "v2-r5", "2");
      const bg = (l: ReturnType<Page["locator"]>) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await bg(mine(page).locator(".across-bar .med"))).not.toBe(await bg(combo(page, SWIFT).locator(".across-bar .med")));
      expect(await bg(mine(page).locator("th"))).not.toBe(await bg(combo(page, SWIFT).locator("th")));
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("navigation", () => {
  test("previous and next story in this run", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const nav = section(page, "nav");
    await expect(nav.locator('[data-nav="prev"] a')).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "1"));
    await expect(nav.locator('[data-nav="next"] a')).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "3"));
    await nav.locator('[data-nav="next"] a').click();
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "notBuilt");
    await section(page, "nav").locator('[data-nav="prev"] a').click();
    await expect(page.locator('[data-page="storyRun"] h1')).toHaveText("Story 2 · Sticky notes");
  });

  test("the first story has no previous; the last has no next", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    await expect(section(page, "nav").locator('[data-nav="prev"]')).toHaveText("first story");
    await open(page, SWIFT, "v2-r5", "12");
    await expect(section(page, "nav").locator('[data-nav="next"]')).toHaveText("last story");
    await expect(section(page, "nav").locator('[data-nav="prev"] a')).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r5", "11"));
  });

  test("the same story in the combination's other runs, with where each stands", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const sib = section(page, "nav").locator('[data-row="siblings"]');
    await expect(sib.locator('li[data-run="v2-r5"]')).toHaveCount(0);
    await expect(sib.locator('li[data-run="v2-r4"]')).toContainText("DONE");
    await expect(sib.locator('li[data-run="v2-r2"]')).toContainText("not built");
    await expect(sib.locator('li[data-run="v2-r4"] a')).toHaveAttribute("href", storyRunHref(SWIFT, "v2-r4", "2"));
  });

  test("the run and the combination", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await section(page, "nav").locator('[data-row="run"] a.run-link').click();
    await expect(page.locator('[data-page="run"] .run-id')).toHaveText("v2-r5");
    await page.goBack();
    await section(page, "nav").locator('[data-row="combination"] a.combination-link').click();
    await expect(page.locator('[data-page="combination"]')).toBeVisible();
  });

  test("the only run of its combination: says there's no other", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(section(page, "nav").locator('[data-row="siblings"]')).toContainText("the combination has no other run in this pack");
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("a story run with no record shows what is known", () => {
  test("in progress: the live figures, marked live; its title from the job", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "3");
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "inProgress");
    await expect(section(page, "header").locator("h1")).toHaveText("Story 3 · See other people's edits live");
    await expect(section(page, "header").locator('[data-fact="storyStatus"]')).toHaveText("▶ in progress");
    const p = section(page, "progress");
    await expect(p.locator(".rp-head .tag-live")).toHaveText("live");
    await expect(stat(page, "progress", "agentTime").locator(".live-n")).toHaveText("4 min");
    await expect(stat(page, "progress", "calls").locator(".live-n")).toHaveText("41");
    await expect(stat(page, "progress", "outTokens").locator(".live-n")).toHaveText("12k");
    await expect(section(page, "time")).toHaveCount(0);
    await expect(section(page, "nav")).toBeVisible();
  });

  test("in progress, just started: '—' with why, not zeros", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r1").live!, { agentMinutes: null, calls: null, outputTokens: null }));
    await open(page, SWIFT, "v2-r1", "3");
    await expect(section(page, "progress").locator(".stat .missing")).toHaveCount(3);
  });

  test("not built yet in a running run: which story the run is at; no title known", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "4");
    await expect(section(page, "progress").locator(".state-note")).toHaveText("Not built yet: the run is at story 3.");
    await expect(section(page, "header").locator("h1")).toHaveText("Story 4 · title not known yet");
    await expect(section(page, "header").locator('[data-fact="storyStatus"]')).toHaveText("not built");
  });

  test("a queued run: queued; the title from another run of the pack", async ({ page }) => {
    await open(page, SWIFT, "v2-r2", "1");
    await expect(section(page, "progress").locator(".state-note")).toHaveText("The run is queued: no story is built yet.");
    await expect(section(page, "header").locator("h1")).toHaveText("Story 1 · Pan and zoom");
  });

  test("a finished run that didn't record it: says so", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "3");
    await expect(section(page, "progress").locator(".state-note")).toHaveText("Not built: the run finished without recording this story.");
  });

  test("a failed run that never reached it: says so", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r5").status = "failed"; });
    await open(page, SWIFT, "v2-r5", "4");
    await expect(section(page, "progress").locator(".state-note")).toHaveText("Not built: the run failed before it reached this story.");
  });

  test("a story outside the run's scope: says so, with the way back; nothing to compare", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "99");
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "outOfScope");
    await expect(section(page, "progress").locator(".state-note")).toHaveText("The run's scope doesn't include this story: it has 11 in scope.");
    await expect(section(page, "against")).toHaveCount(0);
    await expect(section(page, "nav").locator('[data-row="run"] a.run-link')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("links and keyboard", () => {
  test("sections come in order: header, time, cost, conversation, against the combination, what differed, against every combination, navigation", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const order = await page.locator('[data-page="storyRun"] > [data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
    expect(order).toEqual(["header", "time", "cost", "conversation", "against", "differed", "across", "nav"]);
  });

  test("every label with a definition takes it from the glossary", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const definitions = new Set(Object.values(GLOSSARY).map((t) => t.what));
    const tips = await page.locator('[data-page="storyRun"] .term').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""));
    expect(tips.length).toBeGreaterThan(30);
    expect(tips.filter((t) => !definitions.has(t))).toEqual([]);
  });

  test("every in-app link lands on the entity it names", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, SWIFT, "v2-r5", "2");
    const hrefs = [...new Set(await page.locator('[data-page="storyRun"] a[href^="#/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
    expect(hrefs.length).toBeGreaterThan(15);
    for (const href of hrefs) {
      await page.goto(`/${href}`);
      const route = parseRoute(href);
      if (route.page === "overview") { await expect(page.locator("table.combos"), href).toBeVisible(); continue; }
      if (route.page === "combination") { await expect(page.locator('[data-page="combination"]'), href).toBeVisible(); continue; }
      if (route.page === "machine") { await expect(page.locator('[data-page="machine"]'), href).toContainText(route.machine); continue; }
      if (route.page === "story") { await expect(page.locator('[data-page="story"]'), href).toContainText(`Story ${route.story}`); continue; }
      if (route.page === "run") {
        await expect(page.locator('[data-page="run"] .rp-header .run-id'), href).toHaveText(route.runId);
        await expect(page.locator('[data-page="run"] .rp-header a.combination-link'), href).toHaveAttribute("data-tip", route.stack);
        continue;
      }
      if (route.page === "storyRun") {
        await expect(page.locator('[data-page="storyRun"] .rp-header h1'), href).toContainText(`Story ${route.story}`);
        // An invalid run's link adds why it is invalid after its name.
        const name = `${route.stack} · ${route.runId}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await expect(page.locator('[data-page="storyRun"] .breadcrumb a.run-link'), href).toHaveAttribute("data-tip", new RegExp(`^${name}($|\\. Invalid run: )`));
        continue;
      }
      throw new Error(`${href} names no page`);
    }
  });

  test("every link is reachable by keyboard and has a name", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const bad = await page.locator('[data-page="storyRun"] a').evaluateAll((as) => as
      .filter((a) => a.getAttribute("tabindex") === "-1" || !(a.textContent ?? "").trim()).map((a) => a.outerHTML));
    expect(bad).toEqual([]);
  });

  test("next story from the keyboard, with a visible focus ring", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    const next = section(page, "nav").locator('[data-nav="next"] a');
    await next.focus();
    await expect(next).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-page="storyRun"] h1')).toHaveText("Story 2 · Sticky notes");
  });

  test("a flag's reason can be read from the keyboard", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const flag = section(page, "against").locator('tr.is-this [data-measure="minutes"] .diff.flagged');
    await flag.focus();
    await expect(page.getByRole("tooltip")).toContainText("The median of the other 3 runs: 17 min.");
  });
});
