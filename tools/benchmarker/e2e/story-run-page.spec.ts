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

  test("DONE, this story's held-out result and the whole suite so far; agent time", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "header").locator('[data-fact="storyStatus"]')).toHaveText("DONE");
    await expect(section(page, "header").locator('[data-fact="own"]')).toHaveText("14/14");
    await expect(section(page, "header").locator('[data-fact="cumulative"]')).toHaveText("20/20");
    await expect(stat(page, "header", "storyHeldOut").locator(".tag-live")).toHaveCount(0);
    await expect(stat(page, "header", "cumulativeHeldOut").locator(".tag-live")).toHaveCount(0);
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
    await expect(section(page, "header").locator('[data-fact="cumulative"] .missing')).toHaveAttribute("data-tip", "Not available.");
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

  test("tools time by kind, longest first", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const kinds = await section(page, "time").locator("[data-kind]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind));
    expect(kinds).toEqual(["unit", "e2e", "build", "bash"]);
    await expect(section(page, "time").locator('[data-kind="unit"]')).toContainText("1 min");
  });

  test("no accounting-check block, for a passing story or any other: the parts, the bar and the kinds, and no more", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const t = section(page, "time");
    await expect(t.locator(".check, .check-explain, .check-flag, .check-unchecked, [data-check]")).toHaveCount(0);
    await expect(t).not.toContainText(/accounting|passed|the parts add up|can be trusted|unchecked|Likely cause|What to do/i);
    for (const tip of await t.locator("[data-tip]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""))) expect(tip).not.toMatch(/accounting|Likely cause|What to do|recompute|harness/i);
  });

  test("a story whose breakdown failed its check (v2-r1 story 1): not available, and nothing about why; its own figures stay", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "1");
    const t = section(page, "time");
    await expect(t.locator(".rp-empty[data-empty=\"split\"]")).toContainText("No time breakdown for this story.");
    await expect(t.locator(".big-bar, table.parts")).toHaveCount(0);
    await expect(t).not.toContainText(/accounting|check|⚠|Likely cause|What to do|recompute|harness|log/i);
    await expect(section(page, "header").locator('[data-fact="agentTime"]')).toHaveText("12 min");
    await expect(stat(page, "cost", "outTokens").locator(".stat-value")).not.toBeEmpty();
  });

  test("parts that don't add up to the wall: what's unaccounted, in its own row", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, SWIFT, "v2-r5").stories[1].usage!.split!.wall = 4911; });
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "time").locator('tr[data-seg="unaccounted"]')).toHaveText("Unaccounted100 s2%");
  });

  test("a cloud model: all 'model, not split', no tools by kind, and no mark of any kind", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    const t = section(page, "time");
    await expect(t.locator('tr[data-seg="modelUnsplit"]')).toHaveText("Model, not split480 s100%");
    await expect(t.locator(".kinds")).toContainText("not recorded by kind");
    await expect(t).not.toContainText(/unchecked|accounting/i);
  });

  test("no breakdown recorded: not available, the same words as a breakdown that isn't", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "2");
    await expect(section(page, "time").locator(".rp-empty")).toContainText("No time breakdown for this story.");
  });

  test("the segments have hovers that explain them", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(section(page, "time").locator('.big-bar [data-seg="betweenSessions"]')).toHaveAttribute("data-tip", /Between sessions 1\.0 min: waiting to start the agent's next session/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe("cost", () => {
  test("tokens, calls and every speed", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const want: [string, string][] = [
      ["outTokens", "175,000"], ["inputRead", "5.0M"], ["calls", "204"], ["tokS", "36.3"], ["compactions", "2"], ["nudges", "0"],
    ];
    for (const [term, text] of want) await expect(stat(page, "cost", term).locator(".stat-value"), term).toHaveText(text);
    await expect(stat(page, "cost", "inputRead").locator(".stat-sub")).toHaveText("90% cached");
    await expect(stat(page, "cost", "tokS").locator(".term")).toHaveText("generated tok/s");
    await expect(section(page, "cost").locator('[data-stat="engineSpeed"]')).toHaveText("engine speed: generation 41.7 tok/s · reading 750.0 tok/s");
  });

  test("draft acceptance where the engine drafts; '—' with why where it doesn't", async ({ page }) => {
    await open(page, GUFO, "canvas-gufo-r3", "1");
    await expect(stat(page, "cost", "draftAcceptance").locator(".stat-value")).toHaveText("85%");
    await open(page, SWIFT, "v2-r5", "2");
    await expect(stat(page, "cost", "draftAcceptance").locator(".missing")).toHaveAttribute("data-tip", /speculative decoding/);
  });

  test("a cloud model: engine speeds and drafting can't be measured, so 'n/a' with why, never '—'", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    const na = [section(page, "cost").locator('[data-stat="engineSpeed"] [data-fact="decode"] .na'),
      section(page, "cost").locator('[data-stat="engineSpeed"] [data-fact="prefill"] .na'),
      stat(page, "cost", "draftAcceptance").locator(".na")];
    for (const n of na) {
      await expect(n).toHaveText("n/a");
      await expect(n).toHaveAttribute("data-tip", "Unavailable for this cloud model");
    }
    await expect(section(page, "cost").locator(".missing")).toHaveCount(0);
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
    await expect(section(page, "conversation").locator(".rp-head")).not.toContainText(/no LLM|event log/);
  });

  test("tools by name, most used first", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(section(page, "conversation").locator("[data-tool]")).toHaveText(["bash 115", "edit 40", "write 28", "read 21"]);
  });

  test("a cloud model's withheld thinking: the exact total in tokens; per call and the largest block 'n/a', never estimated or '0 chars'", async ({ page }) => {
    // Sonnet 5.5 v2-r4 story 3 (1 Oct 2026) read "0 chars" and three dashes.
    await patchState(page, (s) => { rowOf(s, OPUS, "run-9").stories[0].conversation = {
      calls: 58, toolCalls: 92, thinkingChars: null, textChars: 900, toolArgChars: 5000, thinkingMedian: null,
      thinkingMedianBefore: null, thinkingMedianAfter: null, largestThinking: null, contextStart: 16000, contextEnd: 140000,
      largestContextJump: { tokens: 15541, call: 5 }, toolsByName: { Bash: 56 }, toolErrors: 3, signals: [],
      longestTool: { seconds: 120, name: "Bash", gist: "npm test" },
      thinkingVisible: false, thinkingTokens: 7986 }; });
    await open(page, OPUS, "run-9", "1");
    await expect(stat(page, "conversation", "thinking").locator(".stat-value")).toHaveText("7,986 tokens");
    for (const term of ["thinkingMedian", "largestThinking"]) {
      const na = stat(page, "conversation", term).locator(".na");
      await expect(na, term).toHaveText("n/a");
      await expect(na, term).toHaveAttribute("data-tip", "Unavailable for this cloud model");
      await expect(stat(page, "conversation", term).locator(".stat-sub"), term).toHaveCount(0);
    }
    await expect(section(page, "conversation")).not.toContainText("estimat");
    await expect(section(page, "conversation")).not.toContainText("~");
    await expect(section(page, "conversation").locator(".missing")).toHaveCount(0);
    await expect(section(page, "conversation")).not.toContainText("chars");
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

  test("parts that couldn't be counted: '—' with why, and no ratio from them", async ({ page }) => {
    await patchState(page, (s) => Object.assign(rowOf(s, SWIFT, "v2-r5").stories[1].conversation!, {
      thinkingMedianBefore: null, thinkingMedianAfter: null, largestThinking: null, contextStart: null, largestContextJump: null, longestTool: null,
    }));
    await open(page, SWIFT, "v2-r5", "2");
    const before = stat(page, "conversation", "thinkingMedian").locator('[data-fact="before"] .missing');
    await expect(before).toHaveAttribute("data-tip", "Not counted: thinking before the largest block.");
    await expect(stat(page, "conversation", "thinkingMedian").locator(".stat-sub")).toHaveCount(0);
    await expect(stat(page, "conversation", "largestThinking").locator(".missing")).toBeVisible();
    await expect(stat(page, "conversation", "contextGrowth").locator(".stat-sub")).toHaveCount(0);
    await expect(stat(page, "conversation", "contextJump").locator(".missing")).toBeVisible();
    await expect(stat(page, "conversation", "longestTool").locator(".missing")).toBeVisible();
  });

  test("not recorded: says so, instead of zeros", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    await expect(section(page, "conversation").locator('[data-empty="conversation"]')).toHaveText("No conversation profile for this story.");
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
    await expect(median).toContainText("Median of the other 4 runs");   // v2-r1, r4, r6 and r7 recorded story 2
    await expect(median.locator('[data-measure="minutes"]')).toHaveText("17 min n=3");   // v2-r1 has no time: its own n
    await expect(median.locator('[data-measure="outTokens"]')).toHaveText("72k n=3");
    await expect(median.locator('[data-measure="heldOut"]')).toHaveText("88%");           // all 4: no n of its own
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
    await expect(a.locator('tr[data-run="v2-r1"] .bar-col .missing')).toHaveAttribute("data-tip", "No time breakdown for this story.");
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

  test("a run without a conversation profile: its thinking missing, and left out of the thinking median", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "1");
    const a = section(page, "against");
    await expect(a.locator('tr[data-run="v2-r7"] [data-measure="thinking"] .missing')).toHaveAttribute("data-tip", "No conversation profile for this story run.");
    await expect(a.locator("tr.median-row")).toContainText("Median of the other 4 runs");
    await expect(a.locator('tr.median-row [data-measure="thinking"]')).toContainText("n=3");
    await expect(a.locator('tr.median-row [data-measure="minutes"]')).not.toContainText("n=");
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
    await expect(section(page, "against").locator(".rp-empty")).toHaveText("No run of this combination has recorded story 3 yet.");
    await expect(section(page, "against").locator("table")).toHaveCount(0);
  });

  test("no other run has the story: no median row at all, no flags; the table is this run's row", async ({ page }) => {
    await patchState(page, (s) => { rowOf(s, OPUS, "v2-r1").stories = []; });
    await open(page, OPUS, "run-9", "1");
    const a = section(page, "against");
    await expect(a.locator("tr.median-row")).toHaveCount(0);
    await expect(a.locator('[data-flagged="true"]')).toHaveCount(0);
    await expect(a.locator("tbody tr")).toHaveCount(2);                 // run-9 and v2-r1 (which hasn't got there)
    await expect(a).not.toContainText(/no median|nothing to compare/i);
  });

  test("one other run has the story: 'Median of the other run', its figures, no n", async ({ page }) => {
    await patchState(page, (s) => { for (const id of ["v2-r1", "v2-r4", "v2-r6"]) rowOf(s, SWIFT, id).stories = rowOf(s, SWIFT, id).stories.filter((x) => x.id !== "2"); });
    await open(page, SWIFT, "v2-r5", "2");
    const median = section(page, "against").locator("tr.median-row");
    await expect(median).toHaveAttribute("data-others", "1");
    await expect(median).toContainText("Median of the other run");
    await expect(median.locator('[data-measure="minutes"]')).toHaveText("17 min");
    await expect(median.locator('[data-measure="minutes"]')).not.toContainText("n=");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Held-out beside the cost: SWIFT story 2 is 14/14 in v2-r5 against 9/10, 12/14, 11/14 and 13/14 in v2-r1, v2-r4, v2-r6
// and v2-r7, so the median is 88%, between 12/14 and 9/10.
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
    await expect(section(page, "against").locator('tr.median-row [data-measure="heldOut"]')).toHaveText("88%");
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
    await expect(section(page, "against").locator('tr.median-row [data-measure="heldOut"]')).toHaveText("90% n=3");   // 9/10, 11/14, 13/14: v2-r4 has none
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
    expect(tip).toContain("verbose thinking: thinking per call 1,588 chars against 95 (16.7×)");   // v2-r4, r6, r7
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
// (v2-r4 is a little further off, v2-r6 has 2.2× the calls, v2-r1 has only its held-out result).
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

  test("every other run that recorded the story can be chosen", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const values = await pick(page).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(values.toSorted()).toEqual(["v2-r1", "v2-r4", "v2-r6", "v2-r7"]);
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
// Against every combination: two answers per combination, a verdict then the plain numbers. In the fixture, SWIFT
// story 2 of v2-r5 is 14/14 in 80 min; SWIFT's other finished runs (v2-r4, r6, r7) have a median of 86% (12 of 14) in
// 17 min; OPUS run-9 has 90% and no time. v2-r1 is running: it counts for nothing.
test.describe("against every combination", () => {
  const a = (page: Page) => section(page, "across");
  const verdicts = (page: Page) => a(page).locator("table").first();
  const combo = (page: Page, stack: string) => verdicts(page).locator(`tr[data-stack="${stack}"]`);
  const cell = (page: Page, stack: string, measure: string) => combo(page, stack).locator(`td[data-measure="${measure}"]`);
  const stacksShown = (page: Page) => verdicts(page).locator("tr[data-stack]").evaluateAll((trs) => trs.map((t) => (t as HTMLElement).dataset.stack));
  const NARROW = 1000, WIDE = 1440;

  test("under its glossary term, with a link to every run of the story", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(a(page).locator("h2 .term")).toHaveAttribute("data-tip", GLOSSARY.acrossCombinations.what);
    await a(page).locator(".rp-aside a.story-link").click();
    await expect(page).toHaveURL(/#\/vidi\/s\/2$/);
  });

  test("three columns: the combination, quality on this story, speed on this story; this combination first", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(verdicts(page).locator("thead th")).toHaveText([/^Combination$/, /^Quality on this story/, /^Speed on this story/]);
    expect(await stacksShown(page)).toEqual([SWIFT, OPUS]);
    await expect(combo(page, SWIFT)).toHaveAttribute("data-this", "true");
    await expect(combo(page, SWIFT).locator("th")).toContainText("this combination");
    await expect(combo(page, SWIFT).locator(".runs-n")).toHaveText("3 other runs");
    await expect(combo(page, OPUS).locator(".runs-n")).toHaveText("1 run");
  });

  test("quality: the verdict in bold, then this run's pass rate vs the median; the range on hover", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(cell(page, SWIFT, "quality")).toHaveText("better100% vs 86%");
    await expect(cell(page, SWIFT, "quality").locator("b.verdict")).toHaveText("better");
    await expect(cell(page, OPUS, "quality")).toHaveText("better100% vs 90%");
    await cell(page, SWIFT, "quality").focus();
    await expect(tip(page)).toHaveText(/median 86%, from 79% to 93%, over 3 finished runs/);
  });

  test("speed: 'N× slower' or 'faster', then the times; a median nobody recorded is '—', with no verdict", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(cell(page, SWIFT, "speed")).toHaveText("4.8× slower1h20m vs 17 min");
    await expect(cell(page, SWIFT, "speed").locator("b.verdict")).toHaveAttribute("data-verdict", "slower");
    await expect(cell(page, OPUS, "speed")).toHaveText("1h20m vs —");
    await expect(cell(page, OPUS, "speed").locator(".verdict")).toHaveCount(0);
  });

  test("same: within one test, and within 10% (Swift v2-r4 story 1 against its own combination)", async ({ page }) => {
    await open(page, SWIFT, "v2-r4", "1");
    await expect(cell(page, SWIFT, "quality").locator(".verdict")).toHaveText("same");
    await expect(cell(page, SWIFT, "speed")).toHaveText("same12 min vs 12 min");
    await expect(cell(page, OPUS, "speed")).toHaveText("1.4× slower12 min vs 8 min");
  });

  test("faster: the cloud run against Swift", async ({ page }) => {
    await open(page, OPUS, "run-9", "1");
    expect(await stacksShown(page)).toEqual([SWIFT]);   // OPUS has no other finished run of story 1: no row of its own
    await expect(cell(page, SWIFT, "speed")).toHaveText("1.4× faster8 min vs 12 min");
  });

  test("no bars, whiskers or marks, and no running or invalid counts", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    await expect(a(page).locator(".across-bar, .whisker, .mine-mark, .bar")).toHaveCount(0);
    await expect(a(page)).not.toContainText(/running|invalid|left out/);
  });

  test("tokens and calls are behind a collapsed detail; opened, medians with ranges and this run's own", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const d = a(page).locator('details[data-part="detail"]');
    await expect(d).not.toHaveAttribute("open", "");
    await expect(d.locator("table")).toBeHidden();
    await d.locator("summary").click();
    await expect(d.locator('tr[data-row="this"] td[data-measure="outTokens"]')).toHaveText("175k");
    await expect(d.locator('tr[data-row="this"] td[data-measure="calls"]')).toHaveText("204");
    await expect(d.locator(`tr[data-stack="${SWIFT}"] td[data-measure="outTokens"] b`)).toHaveText("72k");
    await expect(d.locator(`tr[data-stack="${OPUS}"] td[data-measure="calls"] .missing`)).toHaveText("—");
  });

  test("no other finished run anywhere: says so, no table", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "3");
    await expect(a(page).locator(".rp-empty")).toHaveText("No other finished run, of this combination or another, has recorded story 3 yet.");
    await expect(a(page).locator("table")).toHaveCount(0);
  });

  test("each combination's name opens its page, from the keyboard too", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const link = combo(page, OPUS).locator("a.combination-link");
    await link.focus();
    await expect(link).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/vidi/c/${enc(OPUS)}$`));
  });

  for (const width of [NARROW, WIDE]) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height: 900 } });
      test("no sideways scroll, on the page or in the table", async ({ page }) => {
        await open(page, SWIFT, "v2-r5", "2");
        await expect(a(page)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const [scroll, client] = await a(page).locator(".table-scroll").first().evaluate((el) => [el.scrollWidth, el.clientWidth]);
        expect(scroll).toBeLessThanOrEqual(client);
      });
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: this combination's row stands out, and better and worse read differently`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, SWIFT, "v2-r5", "2");
      const bg = (l: ReturnType<Page["locator"]>) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
      const fg = (l: ReturnType<Page["locator"]>) => l.evaluate((el) => getComputedStyle(el).color);
      expect(await bg(combo(page, SWIFT).locator("th"))).not.toBe(await bg(combo(page, OPUS).locator("th")));
      expect(await fg(cell(page, SWIFT, "quality").locator(".verdict"))).not.toBe(await fg(cell(page, SWIFT, "speed").locator(".verdict")));
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
  test("in progress: the live figures; its title from the job", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "3");
    await expect(page.locator('[data-page="storyRun"]')).toHaveAttribute("data-story-state", "inProgress");
    await expect(section(page, "header").locator("h1")).toHaveText("Story 3 · See other people's edits live");
    await expect(section(page, "header").locator('[data-fact="storyStatus"]')).toHaveText("▶ in progress");
    const p = section(page, "progress");
    await expect(p.locator(".rp-head .tag-live")).toHaveCount(0);
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
        await expect(page.locator('[data-page="storyRun"] .breadcrumb a.run-link'), href).toHaveAttribute("data-tip", `${route.stack} · ${route.runId}`);
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
