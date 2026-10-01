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

  test("the accounting check failed: flagged, with each problem listed", async ({ page }) => {
    await open(page, SWIFT, "v2-r1", "1");
    const c = section(page, "time").locator('[data-check="problems"]');
    await expect(c).toContainText("failed");
    await expect(c.locator(".problems li")).toHaveText(["tool call t9 never ended; counted to the agent's next step"]);
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
    await expect(a.locator('tr[data-run="v2-r2"] .bar-col')).toHaveText("not built in this run");
    await expect(a.locator('tr[data-run="v2-r1"] .bar-col')).toHaveText("no time split recorded");
    await expect(a.locator('tr[data-run="v2-r1"] [data-measure="minutes"] .missing')).toHaveAttribute("data-tip", "Not recorded for this story run.");
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
  test("sections come in order: header, time, cost, conversation, against the combination, what differed, navigation", async ({ page }) => {
    await open(page, SWIFT, "v2-r5", "2");
    const order = await page.locator('[data-page="storyRun"] > [data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
    expect(order).toEqual(["header", "time", "cost", "conversation", "against", "differed", "nav"]);
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
