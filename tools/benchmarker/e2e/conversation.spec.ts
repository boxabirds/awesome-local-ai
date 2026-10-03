import { expect, test, type Page } from "@playwright/test";
import { GLOSSARY } from "../shared/glossary.ts";
import type { State } from "../shared/types.ts";

// The conversation pages, MECE by where the reader starts and by the fixture's cells (e2e/fixtures/conversations.py):
//   A. the conversation page by address: complete pi (every kind of turn, the overview's chips, search and strip)
//      | complete claude | growing | not available (with a split, without one, a story that doesn't exist)
//   B. the call page by address: a call with thinking, a failed tool and an open tool | the first and last call |
//      a claude call | a call that doesn't exist
//   C. the API as the page sees it: the list, one conversation, the time-range form page by page, the open-ended form,
//      every refusal, one call, one tool
// The bar parts that lead here are links.spec.ts's; the fault sweep over these pages is no-faults.spec.ts's.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const enc = encodeURIComponent;
const SWIFT_S2 = `combinations/${SWIFT}/benchmarks/vidi/v2-r5/stories/02`;
const OPUS_S1 = "benchmarks/reference/vidi/opus-5.5/run-9/stories/01";
const SWIFT_R1_S1 = `combinations/${SWIFT}/benchmarks/vidi/v2-r1/stories/01`;
const conv = (stack: string, run: string, story: string, kind?: string) => `/#/vidi/r/${enc(stack)}/${run}/s/${story}/conversation${kind ? `?kind=${kind}` : ""}`;
const call = (stack: string, run: string, story: string, idx: number) => `/#/vidi/r/${enc(stack)}/${run}/s/${story}/conversation/c/${idx}`;
const page$ = (page: Page) => page.locator('[data-page="conversation"]');
const chip = (page: Page, kind: string) => page$(page).locator(`.conv-chips [data-kind="${kind}"]`);
const kinds = (page: Page) => page$(page).locator("table.turns tbody tr").evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-kind")));

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

/** Serve the page this state change for this test only (the fixture's v2-r5 with interventions in its story 2). */
async function withInterventions(page: Page, list: { at: number; story: string | null; text: string }[]) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    s.rows.find((r) => r.stack === SWIFT && r.runId === "v2-r5")!.interventions = list;
    await route.fulfill({ response: res, json: s });
  });
}
const T0_S = 1790000000;

test.describe("A2. interventions in the conversation", () => {
  const SILENT = { at: T0_S + 6, story: "2", text: "interrupted a tool call silent for 600s (killed processes under the workspace)" };
  test("each one stands among the turns at its moment, in the page's own words; the chip counts it; the strip marks it", async ({ page }) => {
    await withInterventions(page, [SILENT, { at: T0_S + 8, story: "3", text: "story 3's, not this one's" }, { at: T0_S + 9, story: null, text: "node-a rebooted by the operator" }]);
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    await expect(page$(page).locator('[data-fact="events"]')).toHaveText("17");
    await expect(chip(page, "intervention").locator(".num")).toHaveText("1");
    const row = page$(page).locator('table.turns tr[data-kind="intervention"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator(".kind")).toHaveText("intervention");
    await expect(row.locator("td.said")).toHaveText("a tool call silent for 600 s was interrupted");
    await expect(row.locator("td").first()).toHaveText("6.0 s");
    expect(await kinds(page)).toEqual(["msg", "wait", "call", "tool", "intervention", "call", "tool", "compaction", "call", "tool", "call", "condition", "condition"]);
    await expect(page$(page).locator("svg.conv-strip .strip-intervention")).toHaveCount(1);
  });

  test("the address's kinds decide whether they show: call,compaction hides them; intervention alone shows only them", async ({ page }) => {
    await withInterventions(page, [SILENT]);
    await page.goto(conv(SWIFT, "v2-r5", "2", "call%2Ccompaction"));
    expect(await kinds(page)).not.toContain("intervention");
    await page.goto(conv(SWIFT, "v2-r5", "2", "intervention"));
    expect(await kinds(page)).toEqual(["intervention"]);
  });

  test("a story with none: no row, a count of 0", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    await expect(page$(page).locator('table.turns tr[data-kind="intervention"]')).toHaveCount(0);
  });
});

test.describe("A. the conversation page", () => {
  test("a complete pi story: one list of turns in time order, a call's tools under it, its engine request in its figures", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-available", "true");
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await expect(p.locator('[data-fact="events"]')).toHaveText("17");
    await expect(p.locator('[data-fact="range"]')).not.toContainText("so far");
    // The chips say what the conversation holds; every kind is on.
    for (const [kind, count] of [["call", "4"], ["tool", "3"], ["compaction", "1"], ["wait", "1"], ["msg", "1"], ["request", "0"], ["condition", "2"], ["intervention", "0"]]) {
      await expect(chip(page, kind).locator(".num"), kind).toHaveText(count);
      await expect(chip(page, kind), kind).toHaveAttribute("aria-pressed", "true");
    }
    // The list: 9 turns, the tools as lines under their calls (12 rows), in time order.
    expect(await kinds(page)).toEqual(["msg", "wait", "call", "tool", "call", "tool", "compaction", "call", "tool", "call", "condition", "condition"]);
    await expect(p.locator('[data-fact="count"]')).toHaveText("9");
    const call0 = p.locator('table.turns tr[data-call="0"]');
    await expect(call0).toContainText("call 1");
    await expect(call0.locator(".figures")).toContainText("150 tok/s");   // the late-placed request, matched to call 1
    await expect(call0.locator('[data-quoted="agent"]')).toContainText("Reading the spec.");
    const call2 = p.locator('table.turns tr[data-call="2"]');
    await expect(call2.locator(".figures")).toContainText("drafts 40/60");
    // A tool line: its argument and its result; failed with its counts; one still open.
    const t1 = p.locator('table.turns tr[data-tool="1"]');
    await expect(t1).toHaveAttribute("data-parent", "1");
    await expect(t1).toHaveAttribute("data-error", "true");
    await expect(t1.locator(".figures")).toContainText("failed · 6 s · 9 passed, 1 failed");
    await expect(t1.locator('[data-quoted="agent"]').nth(1)).toContainText("1 failed, 9 passed");
    await expect(p.locator('table.turns tr[data-tool="2"]')).toHaveAttribute("data-open", "true");
    await expect(p.locator('table.turns tr[data-tool="2"] .missing')).toHaveCount(1);
    // The other turns.
    await expect(p.locator('table.turns tr[data-kind="compaction"] .figures')).toContainText("context · 3 s · summary 1,200 chars");
    await expect(p.locator('table.turns tr[data-kind="wait"] .figures')).toContainText("waited 2 s");
    await expect(p.locator('table.turns tr[data-kind="msg"] [data-quoted="agent"]')).toHaveText("Implement story 2 now.");
    await expect(p.locator('table.turns tr[data-kind="condition"]').first().locator(".figures")).toContainText("nominal");
    // Times past a minute read as m:ss.
    await expect(p.locator('table.turns tr[data-kind="condition"]').last().locator("td").first()).toHaveText("33.0 s");
  });

  test("the overview narrows the list: chips by kind, the search by text, the strip by a span; a click on the strip jumps", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    // Hide tool calls: their lines go; the calls stay. Hide calls too: nothing of them. "all kinds" brings everything back.
    await chip(page, "tool").click();
    expect(await kinds(page)).toEqual(["msg", "wait", "call", "call", "compaction", "call", "call", "condition", "condition"]);
    await chip(page, "call").click();
    expect(await kinds(page)).toEqual(["msg", "wait", "compaction", "condition", "condition"]);
    await expect(p.locator('[data-fact="count"]')).toHaveText("5 of 9 shown");
    await p.getByRole("button", { name: "all kinds" }).click();
    await expect(p.locator('[data-fact="count"]')).toHaveText("9");
    // Tools shown with calls hidden: the tools stand as lines of their own.
    await chip(page, "call").click();
    expect((await kinds(page)).filter((k) => k === "tool")).toHaveLength(3);
    expect(await kinds(page)).not.toContain("call");
    await p.getByRole("button", { name: "all kinds" }).click();
    // The search: "harness" is in two calls' thinking and one call's text; a call found through its thinking shows it.
    const box = p.getByRole("searchbox", { name: "Search the conversation" });
    await box.fill("harness");
    expect((await kinds(page)).filter((k) => k === "call")).toHaveLength(3);
    for (const i of [0, 1, 2]) await expect(p.locator('table.turns tr[data-kind="call"]').nth(i).locator("mark").first()).toHaveText(/harness/i);
    await expect(p.locator('[data-fact="count"]')).toHaveText("3 of 9 shown");
    // A tool found through its result; a call's tool lines narrow to the ones that match.
    await box.fill("attempt 2");
    expect(await kinds(page)).toEqual(["call", "tool", "call", "tool", "call"]);
    await expect(p.locator("table.turns tr mark").first()).toHaveText(/attempt 2/);
    await box.fill("");
    await expect(p.locator('[data-fact="count"]')).toHaveText("9");
    // The strip: a click goes to the nearest turn and marks it; a drag keeps only the span.
    const svg = p.locator("svg.conv-strip");
    const box2 = (await svg.boundingBox())!;
    await page.mouse.click(box2.x + box2.width * 0.95, box2.y + box2.height / 2);
    await expect(p.locator('table.turns tr[data-jumped="true"]')).toHaveCount(1);
    await expect(p.locator('table.turns tr[data-jumped="true"]')).toBeInViewport();
    // The jump scrolled the page: measure the strip again before dragging across it.
    await svg.scrollIntoViewIfNeeded();
    const box3 = (await svg.boundingBox())!;
    await page.mouse.move(box3.x + box3.width * 0.1, box3.y + 10);
    await page.mouse.down();
    await page.mouse.move(box3.x + box3.width * 0.5, box3.y + 10, { steps: 5 });
    await page.mouse.up();
    await expect(p.locator('[data-fact="range-filter"]')).toBeVisible();
    const shown = Number((await p.locator('[data-fact="count"]').innerText()).split(" ")[0]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(9);
    await p.locator('[data-fact="range-filter"]').click();
    await expect(p.locator('[data-fact="count"]')).toHaveText("9");
  });

  test("a bar's part names a kind: ?kind=tool shows the tool calls alone", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2", "tool"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await expect(chip(page, "tool")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "call")).toHaveAttribute("aria-pressed", "false");
    expect(await kinds(page)).toEqual(["tool", "tool", "tool"]);
    await expect(p.locator('[data-fact="count"]')).toHaveText("3 of 9 shown");
  });

  test("a complete claude story: thinking is not counted in the figures, a subagent's call and tool are marked, an unknown stop says nothing", async ({ page }) => {
    await page.goto(conv(OPUS, "run-9", "1"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await expect(p.locator('[data-fact="events"]')).toHaveText("6");
    expect(await kinds(page)).toEqual(["msg", "call", "tool", "call", "wait"]);
    const call0 = p.locator('table.turns tr[data-call="0"]');
    await expect(call0.locator(".figures")).not.toContainText("thinking");
    await expect(p.locator('table.turns tr[data-tool="0"]')).toContainText("Task");
    await expect(p.locator('table.turns tr[data-call="1"] .figures')).not.toContainText("null");
  });

  test("a story still being built: 'so far', and what arrives after the latest cursor appears without a reload", async ({ page, request }) => {
    await page.goto(conv(SWIFT, "v2-r1", "1"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await expect(p.locator('[data-fact="range"]')).toContainText("so far");
    await expect(p.locator('[data-fact="events"]')).toHaveText("2");
    await request.post("/api/test/reset", { data: { appendEvents: { [SWIFT_R1_S1]: [
      { tMs: 1790000110000, kind: "call", refIdx: 1, idx: 1, think: 3, text: 9, nTools: 0, outTok: 30, inTok: 200, cacheTok: 0, stop: "endTurn", sub: 0, thinkFlags: [], textFlags: [], sentMs: 1790000106000, firstMs: 1790000108000, thinking: { text: "Go" }, textBody: { text: "Carrying on" } },
    ] } } });
    await expect(p.locator('[data-fact="events"]')).toHaveText("3", { timeout: 15_000 });
    await expect(p.locator('table.turns tr[data-kind="call"]')).toHaveCount(2);
    await expect(p.locator('table.turns tr[data-call="1"]')).toContainText("Carrying on");
  });

  test("one line names the story run: number and title, then status, held-out, agent time; the run's state only while it matters", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    // The story-run page's card is not here: no eyebrow, no labelled stats, no second header.
    await expect(p.locator(".rp-header, .eyebrow, .outcome, .stat")).toHaveCount(0);
    const line = p.locator('[data-section="all"] .rp-head .story-run-line');
    await expect(line.locator("h1")).toHaveText("Story 2 · Sticky notes");
    await expect(line.locator(".srl-facts")).toHaveText("DONE · 14/14 · 1h20m");
    await expect(line.locator('[data-fact="storyStatus"] .story-status')).toHaveAttribute("data-tip", GLOSSARY.storyStatus.what);
    await expect(line.locator('[data-fact="own"]')).toHaveAttribute("data-tip", GLOSSARY.storyHeldOut.what);
    await expect(line.locator(".status-badge")).toHaveCount(0);
    // A story of a run still going says so, with the machine: the conversation may grow.
    await page.goto(conv(SWIFT, "v2-r1", "1"));
    await expect(page$(page).locator(".story-run-line .srl-facts")).toContainText("▶ running on node-a");
    // The line is in the pinned head, so it is still there at the end of the list.
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    await page$(page).locator("table.turns tbody tr").last().scrollIntoViewIfNeeded();
    await expect(page$(page).locator(".story-run-line")).toBeInViewport();
  });

  test("not available: a story with a split but no conversation, one with neither, and one that doesn't exist", async ({ page }) => {
    for (const [stack, run, story] of [[SWIFT, "v2-r5", "1"], [OPUS, "run-9", "2"], [SWIFT, "v2-r5", "9"]]) {
      await page.goto(conv(stack, run, story));
      const p = page$(page);
      await expect(p, `${run} story ${story}`).toHaveAttribute("data-available", "false");
      await expect(p.locator('[data-empty="conversation"]')).toContainText("Not available.");
      await expect(p.locator("table.turns")).toHaveCount(0);
      await expect(p.locator(".story-run-line h1"), `${run} story ${story}`).toContainText(`Story ${story}`);
      await expect(p.locator(".rp-header")).toHaveCount(0);
    }
  });
});

test.describe("B. the call page", () => {
  const item = (page: Page, block: string) => page.locator(`[data-page="call"] [data-block="${block}"]`);
  const head = (page: Page, block: string) => item(page, block).locator("> button.cc-head");

  test("four items, closed on arrival, each with its figure in its heading: thinking, output, input, tool calls", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    const p = page.locator('[data-page="call"]');
    await expect(p).toHaveAttribute("data-available", "true");
    for (const block of ["thinking", "output", "input", "tools"]) {
      await expect(head(page, block), block).toHaveAttribute("aria-expanded", "false");
      await expect(item(page, block).locator(".cc-body"), block).toHaveCount(0);
    }
    // One unit: tokens. Output and input are the record's; thinking and tool calls are shared out of the output, marked ≈.
    await expect(head(page, "thinking").locator(".cc-figure")).toHaveText(/^≈ [\d,]+ tokens$/);
    await expect(head(page, "output").locator(".cc-figure")).toHaveText(/^[\d,]+ tokens$/);
    await expect(head(page, "input").locator(".cc-figure")).toHaveText(/^[\d,]+ tokens$/);
    await expect(head(page, "tools").locator(".cc-figure")).toHaveText(/^\d+ calls?, ≈ [\d,]+ tokens$/);
    await expect(head(page, "thinking").locator(".cc-figure")).toHaveAttribute("data-tip", /shared out|by characters/i);
    // No unit but tokens in the headings.
    expect(await page.locator('[data-page="call"] .cc-head').allInnerTexts()).not.toContainEqual(expect.stringMatching(/chars|characters/i));
  });

  test("only the call: no story status, held-out result or time; the breadcrumb names the story; the second row is the call", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    const p = page.locator('[data-page="call"]');
    await expect(p.locator(".story-run-line, .srl-facts")).toHaveCount(0);
    await expect(p).not.toContainText(/14\/14|1h20m/);
    await expect(page.locator("nav.breadcrumb")).toContainText("Story 2: Sticky notes");
    await expect(p.locator('[data-fact="call-of"]')).toHaveText("Call 2 of 4");
    const order = await p.evaluate((el) => [...el.children].map((c) => c.getAttribute("data-block") ?? c.className.split(" ")[0]));
    expect(order.slice(1)).toEqual(["call-nav", "thinking", "output", "input", "tools"]);
  });

  test("an item opens to its whole content in the page's own flow, and closes again", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    await head(page, "thinking").click();
    await expect(head(page, "thinking")).toHaveAttribute("aria-expanded", "true");
    const thinking = item(page, "thinking").locator('pre[data-quoted="agent"]');
    await expect(thinking).toBeVisible();
    expect((await thinking.textContent())!.length).toBeGreaterThan(4000);
    await expect(item(page, "thinking").getByRole("button", { name: /show all|show less/i })).toHaveCount(0);
    await head(page, "thinking").click();
    await expect(head(page, "thinking")).toHaveAttribute("aria-expanded", "false");
    await expect(item(page, "thinking").locator(".cc-body")).toHaveCount(0);
  });

  test("no scrolls within scrolls: nothing on the page scrolls inside itself, whatever is open", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    for (const block of ["thinking", "output", "input", "tools"]) await head(page, block).click();
    await expect(item(page, "tools").locator(".cc-body")).toBeVisible();
    const nested = await page.locator('[data-page="call"]').evaluate((root) =>
      [...root.querySelectorAll("*")].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 1; }).map((e) => e.tagName + "." + String(e.className)));
    expect(nested).toEqual([]);
  });

  test("the open item's heading stays pinned under the pinned bar while its content scrolls, so it can be closed from anywhere", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 });
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    await head(page, "thinking").click();
    const h = head(page, "thinking");
    const top0 = (await h.boundingBox())!.y;
    await page.evaluate((y) => window.scrollTo(0, y), top0 + 500);
    await expect.poll(async () => { const b = (await h.boundingBox())!; return b.y >= 0 && b.y < 200 && b.height > 0; }).toBe(true);
    await h.click();
    await expect(h).toHaveAttribute("aria-expanded", "false");
  });

  test("tool calls open to each tool whole: its failed result, and a tool with no end yet says so", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    await head(page, "tools").click();
    await expect(page.locator('[data-block="tool"][data-tool="1"]')).toContainText("failed");
    await expect(page.locator('[data-block="tool"][data-tool="1"] pre').nth(1)).toContainText("1 failed, 9 passed");
    await page.goto(call(SWIFT, "v2-r5", "2", 2));
    await head(page, "tools").click();
    await expect(page.locator('[data-block="tool"][data-tool="2"] .missing')).toHaveCount(1);
  });

  test("output opens to the call's text and the split of its tokens; input to the cache and the new, and what the call before returned", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    await head(page, "output").click();
    await expect(item(page, "output").locator(".cc-body")).toContainText(/thinking ≈ [\d,]+/i);
    await expect(item(page, "output").locator(".cc-body")).toContainText(/text ≈ [\d,]+/i);
    await head(page, "input").click();
    await expect(item(page, "input").locator(".cc-body")).toContainText(/read from the cache/i);
    await expect(item(page, "input").locator(".cc-body")).toContainText(/new to this call/i);
    await expect(item(page, "input").locator(".cc-body [data-prev-tool]")).not.toHaveCount(0);
  });

  test("the way back and the calls either side stay on the call's row", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    const p = page.locator('[data-page="call"]');
    await expect(p.getByRole("link", { name: "← Back to the conversation" })).toHaveAttribute("href", new RegExp("/s/2/conversation\\?call=1$"));
    await expect(p.getByRole("link", { name: "← call 1" })).toHaveAttribute("href", new RegExp("/conversation/c/0$"));
    await expect(p.getByRole("link", { name: "call 3 →" })).toHaveAttribute("href", new RegExp("/conversation/c/2$"));
    await page.goto(call(SWIFT, "v2-r5", "2", 0));
    await expect(page.locator('[data-page="call"] .call-nav')).toContainText("← first call");
    await page.goto(call(SWIFT, "v2-r5", "2", 3));
    await expect(page.locator('[data-page="call"] .call-nav')).toContainText("last call →");
  });

  test("a claude call withholds its thinking (n/a); a call that doesn't exist is not available", async ({ page }) => {
    await page.goto(call(OPUS, "run-9", "1", 0));
    const p = page.locator('[data-page="call"]');
    await expect(p.locator('[data-block="thinking"] .cc-figure .na')).toHaveCount(1);
    await expect(p.locator('[data-block="thinking"] .cc-body')).toHaveCount(0);
    await expect(p.locator('[data-block="thinking"] > button.cc-head')).toBeDisabled();
    await page.goto(call(SWIFT, "v2-r5", "2", 99));
    await expect(page.locator('[data-page="call"]')).toHaveAttribute("data-available", "false");
    await expect(page.locator('[data-empty="call"]')).toContainText("Not available.");
  });
});

test.describe("C. the API as the page sees it", () => {
  test("the list, one conversation, the time-range form page by page, the open-ended form", async ({ request }) => {
    const list = await (await request.get("/api/conversations")).json();
    expect(list.ids).toEqual([OPUS_S1, SWIFT_R1_S1, SWIFT_S2]);
    expect(list.complete).toEqual([OPUS_S1, SWIFT_S2]);
    const c = await (await request.get(`/api/conversations/${enc(SWIFT_S2)}`)).json();
    expect(c.counts).toEqual({ calls: 4, toolCalls: 3, msgs: 1, compactions: 1, requests: 2, conditions: 2 });
    expect(c.events).toBe(17);
    // Pages of 3 over the whole span: 17 events once each, in (time, ord) order, a short last page.
    const got: [number, number][] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const url = `/api/conversations/${enc(SWIFT_S2)}/events?limit=3${cursor ? `&cursor=${enc(cursor)}` : ""}`;
      const pg = await (await request.get(url)).json();
      for (const e of pg.events) got.push([e.tMs, e.ord]);
      cursor = pg.nextCursor;
      if (!cursor) break;
    }
    expect(got).toHaveLength(17);
    expect(new Set(got.map(String)).size).toBe(17);
    for (let i = 1; i < got.length; i += 1) expect(got[i - 1] < got[i] || (got[i - 1][0] === got[i][0] && got[i - 1][1] < got[i][1])).toBe(true);
    // An exact page: 6 events in a page of 6 says there may be more; the next page is empty and final.
    const exact = await (await request.get(`/api/conversations/${enc(OPUS_S1)}/events?limit=6`)).json();
    expect(exact.events).toHaveLength(6);
    expect(exact.nextCursor).not.toBeNull();
    const after = await (await request.get(`/api/conversations/${enc(OPUS_S1)}/events?limit=6&cursor=${enc(exact.nextCursor)}`)).json();
    expect(after).toMatchObject({ events: [], nextCursor: null });
    // The open-ended form: by ord, the late-placed request last; after the latest, nothing, with the same cursor.
    const stream = await (await request.get(`/api/conversations/${enc(SWIFT_S2)}/events?after=0&limit=500`)).json();
    expect(stream.events.map((e: { ord: number }) => e.ord)).toEqual([...Array(17).keys()]);
    expect(stream.events.at(-1).kind).toBe("request");
    expect(stream.nextCursor).toBe(c.latest);
    const nothing = await (await request.get(`/api/conversations/${enc(SWIFT_S2)}/events?after=${enc(c.latest)}`)).json();
    expect(nothing).toMatchObject({ events: [], nextCursor: c.latest });
  });

  test("refusals, the not-available case, one call and one tool", async ({ request }) => {
    for (const q of ["limit=0", "limit=501", "cursor=garbage", "after=garbage"]) {
      const r = await request.get(`/api/conversations/${enc(SWIFT_S2)}/events?${q}`);
      expect(r.status(), q).toBe(400);
      expect(await r.json()).toHaveProperty("error");
    }
    for (const path of [`/api/conversations/${enc("nope/stories/01")}`, `/api/conversations/${enc("nope/stories/01")}/events`, `/api/conversations/${enc(SWIFT_S2)}/calls/99`, `/api/conversations/${enc(SWIFT_S2)}/tools/99`]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(404);
      expect(await r.json()).toEqual({});
    }
    const one = await (await request.get(`/api/conversations/${enc(SWIFT_S2)}/calls/1`)).json();
    expect(one.tools).toHaveLength(1);
    expect(one.thinking.length).toBeGreaterThan(4000);
    const tool = await (await request.get(`/api/conversations/${enc(SWIFT_S2)}/tools/1`)).json();
    expect(tool).toMatchObject({ idx: 1, error: 1, passed: 9 });
  });

  test("the state names each story run and whether its conversation is there", async ({ request }) => {
    const s = await (await request.get("/api/state")).json();
    const r5 = s.rows.find((r: { stack: string; runId: string }) => r.stack === SWIFT && r.runId === "v2-r5");
    expect(r5.stories.map((st: { id: string; storyRunId: string; hasConversation: boolean }) => [st.id, st.storyRunId, st.hasConversation])).toEqual([
      ["1", `combinations/${SWIFT}/benchmarks/vidi/v2-r5/stories/01`, false],
      ["2", SWIFT_S2, true],
    ]);
    const noDir = s.rows.filter((r: { dir: string | null }) => r.dir === null);
    for (const r of noDir) for (const st of r.stories) expect([st.storyRunId, st.hasConversation]).toEqual([null, false]);
  });
});

test.describe("D. layout: pinned heads, compact numbers, folded cells", () => {
  test("the list's heading and column heads stay pinned; the text column takes the width the numbers don't need", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    // One header holds the title and its facts, the chips, the search and the strip; it is pinned, the column heads under it.
    const head = p.locator('[data-section="all"] .rp-head');
    await expect(head).toHaveCSS("position", "sticky");
    await expect(head.locator("h2")).toHaveText("Conversation");
    await expect(head.locator('[data-fact="count"]')).toBeVisible();
    await expect(head.locator(".conv-chips")).toBeVisible();
    await expect(head.getByRole("searchbox")).toBeVisible();
    await expect(head.locator("svg.conv-strip")).toBeVisible();
    await expect(head.locator("svg.conv-strip")).not.toHaveAttribute("data-tip", /./);   // no hover card over the strip
    await expect(p.locator(".rp-section")).toHaveCount(1);
    const th = p.locator("table.turns thead th").first();
    await expect(th).toHaveCSS("position", "sticky");
    const headH = await head.evaluate((e) => e.getBoundingClientRect().height);
    const thTop = await th.evaluate((e) => parseFloat(getComputedStyle(e).top));
    expect(thTop).toBeGreaterThanOrEqual(headH);
    const widths = await p.locator('table.turns tr[data-call="0"] td').evaluateAll((tds) => tds.map((td) => ({ cls: td.className, w: td.getBoundingClientRect().width })));
    const said = widths.find((w) => w.cls.includes("said"))!;
    expect(said.w, JSON.stringify(widths)).toBeGreaterThan(Math.max(...widths.filter((x) => !x.cls.includes("said")).map((x) => x.w)) * 1.5);
    await p.locator("table.turns tbody tr").last().scrollIntoViewIfNeeded();
    await expect(p.locator('[data-section="all"] .rp-head')).toBeInViewport();
  });

  test("a cell shows five lines, and + shows the whole of it; the call page opens folded too", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    const cell = p.locator('table.turns tr[data-call="3"] .clamp-cell');
    await expect(cell.locator(".clamp")).toHaveAttribute("data-folded", "true");
    const folded = await cell.locator(".clamp").evaluate((e) => e.getBoundingClientRect().height);
    await cell.getByRole("button", { name: "Show all" }).click();
    await expect(cell.locator(".clamp")).toHaveAttribute("data-expanded", "true");
    const whole = await cell.locator(".clamp").evaluate((e) => e.getBoundingClientRect().height);
    expect(whole).toBeGreaterThan(folded);
    await expect(cell.locator(".clamp")).toContainText("Committed.");
    await cell.getByRole("button", { name: "Show less" }).click();
    await expect(cell.locator(".clamp")).toHaveAttribute("data-folded", "true");
    await expect(p.locator('table.turns tr[data-call="0"] .clamp-more')).toHaveCount(0);
    await expect(p.locator('table.turns tr[data-tool="0"] .clamp[data-folded="true"]')).toHaveCount(1);
    // The call page: the long thinking is closed on arrival and opens whole.
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    await expect(page.locator('[data-page="call"] [data-block="thinking"] > button.cc-head')).toHaveAttribute("aria-expanded", "false");
  });
});
