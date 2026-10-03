import { expect, test, type Page } from "@playwright/test";

// The conversation pages, MECE by where the reader starts and by the fixture's cells (e2e/fixtures/conversations.py):
//   A. the conversation page by address: complete pi | complete claude | growing | not available (with a split, without
//      one, a story that doesn't exist)
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
const conv = (stack: string, run: string, story: string, at?: string) => `/#/vidi/r/${enc(stack)}/${run}/s/${story}/conversation${at ? `?at=${at}` : ""}`;
const call = (stack: string, run: string, story: string, idx: number) => `/#/vidi/r/${enc(stack)}/${run}/s/${story}/conversation/c/${idx}`;
const page$ = (page: Page) => page.locator('[data-page="conversation"]');
/** The layout switch's buttons, by their own marks (a role query by name would also match the twisties' labels). */
const viewButton = (page: Page, view: "time" | "type") => page$(page).locator(`.view-switch [data-view="${view}"]`);
const byType = async (page: Page) => { await viewButton(page, "type").click(); await expect(viewButton(page, "type")).toHaveAttribute("aria-pressed", "true"); };

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test.describe("A. the conversation page", () => {
  test("in order, by default: one row per happening in time order, with its text; a tick jumps to its call", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await expect(viewButton(page, "time")).toHaveAttribute("aria-pressed", "true");
    const rows = p.locator("table.in-order tbody tr");
    await expect(rows).toHaveCount(17);
    const kinds = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-kind")));
    expect(kinds.slice(0, 5)).toEqual(["msg", "between_sessions", "request", "call", "tool_start"]);
    await expect(rows.nth(3)).toContainText("call 1");
    await expect(rows.nth(3).locator('[data-quoted="agent"]')).toContainText("Reading the spec.");
    // A tool's end carries its result; the late-placed request sits at its own time with its call named.
    await expect(p.locator('table.in-order tbody tr[data-kind="tool_end"]').first()).toContainText("ok");
    await expect(rows.nth(2)).toContainText("call 1");
    // A tick jumps to the call's row and marks it; the search is the section's own.
    await p.locator(".conv-timeline button.tick").last().click();
    await expect(p.locator('table.in-order tbody tr[data-jumped="true"]')).toHaveCount(1);
    await expect(p.locator('table.in-order tbody tr[data-jumped="true"]')).toBeInViewport();
    await p.locator('[data-section="all"]').getByRole("button", { name: "Search the conversation" }).click();
    await p.locator('[data-section="all"]').getByRole("searchbox").fill("attempt 2");
    await expect(rows).toHaveCount(3);   // two tool results and a call's text
    // By type is remembered; a bar's part still lands by type.
    await byType(page);
    await expect(p.locator("table.calls")).toBeVisible();
    await page.reload();
    await expect(viewButton(page, "type")).toHaveAttribute("aria-pressed", "true");
    await viewButton(page, "time").click();
    await expect(page$(page).locator("table.in-order")).toBeVisible();
  });

  test("by type: every section, in time order, with the late-placed request in its place", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-available", "true");
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    await expect(p.locator('[data-fact="events"]')).toHaveText("17");
    await expect(p.locator('[data-fact="range"]')).not.toContainText("so far");
    const nav = p.getByRole("navigation", { name: "Sections of the conversation" });
    for (const [anchor, count] of [["calls", "4"], ["tools", "3"], ["compactions", "1"], ["sessions", "1"], ["messages", "1"], ["requests", "2"], ["conditions", "2"]]) {
      await expect(nav.locator(`a[data-anchor="${anchor}"] .num`), anchor).toHaveText(count);
    }
    // Calls: one row each, in time order, the call with no reported tokens showing them as not available.
    const calls = p.locator("table.calls tbody tr");
    await expect(calls).toHaveCount(4);
    await expect(calls.nth(0)).toHaveAttribute("data-call", "0");
    await expect(calls.nth(3).locator(".missing")).toHaveCount(2);
    await expect(calls.nth(1)).toContainText("Running the tests.");
    await expect(calls.nth(2).locator('[data-quoted="agent"]')).toContainText("the harness said attempt 2 was invalid");
    // Tools: ok, failed with its test counts, and one with no end yet.
    const tools = p.locator("table.tools tbody tr");
    await expect(tools).toHaveCount(3);
    await expect(tools.nth(0)).toContainText("ok");
    await expect(tools.nth(1)).toHaveAttribute("data-error", "true");
    await expect(tools.nth(1)).toContainText("9 passed, 1 failed");
    await expect(tools.nth(2)).toHaveAttribute("data-open", "true");
    await expect(tools.nth(2).locator(".missing")).toHaveCount(3);   // seconds, outcome, result
    // Compactions, waits, messages.
    await expect(p.locator('[data-section="compactions"] li')).toContainText("context · 3 s · summary 1,200 chars");
    await expect(p.locator('[data-section="sessions"] li')).toContainText("waited 2 s");
    await expect(p.locator('[data-section="messages"] li [data-quoted="agent"]')).toHaveText("Implement story 2 now.");
    // Requests, by time: the late-placed one (4.9 s, call 1) before the other (31 s, call 3); nothing drafted shows as n/a.
    const reqs = p.locator("table.requests tbody tr");
    await expect(reqs.nth(0)).toContainText("4.9 s");
    await expect(reqs.nth(0).locator(".na")).toHaveCount(1);
    await expect(reqs.nth(1)).toContainText("40/60");
    // Conditions: the reading without a GPU shows n/a for its GPU columns.
    const conds = p.locator("table.conditions tbody tr");
    await expect(conds.nth(0)).toContainText("nominal");
    await expect(conds.nth(1).locator(".na")).toHaveCount(4);
    // A timeline tick jumps to the call at that time, in the page, and marks its row.
    await p.locator(".conv-timeline button.tick").last().click();
    await expect(p.locator('table.calls tbody tr[data-jumped="true"]')).toHaveCount(1);
    await expect(p.locator('table.calls tbody tr[data-jumped="true"]')).toBeInViewport();
    // The section asked for is marked, and the page scrolls to it.
    await page.goto(conv(SWIFT, "v2-r5", "2", "tools"));
    await expect(page$(page).locator('a[data-anchor="tools"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#sec-tools")).toBeInViewport();
  });

  test("a complete claude story: thinking is not applicable, a subagent's tool is marked, an unknown stop is not available", async ({ page }) => {
    await page.goto(conv(OPUS, "run-9", "1"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    await expect(p.locator('[data-fact="events"]')).toHaveText("6");
    const calls = p.locator("table.calls tbody tr");
    await expect(calls).toHaveCount(2);
    await expect(calls.nth(0).locator(".na")).toHaveCount(1);
    await expect(calls.nth(1).locator("td").nth(7).locator(".missing")).toHaveCount(1);
    await expect(p.locator("table.tools tbody tr").first()).toContainText("subagent");
    await expect(p.locator('[data-section="requests"] .rp-empty')).toHaveText("None.");
  });

  test("a story still being built: 'so far', and what arrives after the latest cursor appears without a reload", async ({ page, request }) => {
    await page.goto(conv(SWIFT, "v2-r1", "1"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    await expect(p.locator('[data-fact="range"]')).toContainText("so far");
    await expect(p.locator('[data-fact="events"]')).toHaveText("2");
    // More arrives on the node: the fixture's reset appends it (the real warehouse would ingest it); the page's next
    // poll after its latest cursor picks it up.
    await request.post("/api/test/reset", { data: { appendEvents: { [SWIFT_R1_S1]: [
      { tMs: 1790000110000, kind: "call", refIdx: 1, idx: 1, think: 3, text: 9, nTools: 0, outTok: 30, inTok: 200, cacheTok: 0, stop: "endTurn", sub: 0, thinkFlags: [], textFlags: [], sentMs: 1790000106000, firstMs: 1790000108000, thinking: { text: "Go" }, textBody: { text: "Carrying on" } },
    ] } } });
    await expect(p.locator('[data-fact="events"]')).toHaveText("3", { timeout: 15_000 });
    await expect(p.locator("table.calls tbody tr")).toHaveCount(2);
    await expect(p.locator("table.calls tbody tr").nth(1)).toContainText("Carrying on");
  });

  test("not available: a story with a split but no conversation, one with neither, and one that doesn't exist", async ({ page }) => {
    for (const [stack, run, story] of [[SWIFT, "v2-r5", "1"], [OPUS, "run-9", "2"], [SWIFT, "v2-r5", "9"]]) {
      await page.goto(conv(stack, run, story));
      const p = page$(page);
      await expect(p, `${run} story ${story}`).toHaveAttribute("data-available", "false");
      await expect(p.locator('[data-empty="conversation"]')).toContainText("Not available.");
      await expect(p.locator("table.calls")).toHaveCount(0);
    }
  });
});

test.describe("B. the call page", () => {
  test("a call in full: its long thinking whole, its failed tool's arguments and result; a step to the calls before and after", async ({ page }) => {
    await page.goto(call(SWIFT, "v2-r5", "2", 1));
    const p = page.locator('[data-page="call"]');
    await expect(p).toHaveAttribute("data-available", "true");
    const thinking = p.locator('[data-block="thinking"] pre[data-quoted="agent"]');
    await expect(thinking).toBeVisible();
    expect((await thinking.innerText()).length).toBeGreaterThan(4000);
    await expect(p.locator('[data-block="tool"][data-tool="1"]')).toContainText("failed");
    await expect(p.locator('[data-block="tool"][data-tool="1"] pre').nth(1)).toContainText("1 failed, 9 passed");
    await expect(p.getByRole("link", { name: "← Back to the conversation" })).toHaveAttribute("href", new RegExp("/s/2/conversation$"));
    await expect(p.locator('[data-fact="call-of"]')).toHaveText("Call 2 of 4");
    await expect(p.getByRole("link", { name: "← call 1" })).toHaveAttribute("href", new RegExp("/conversation/c/0$"));
    await expect(p.getByRole("link", { name: "call 3 →" })).toHaveAttribute("href", new RegExp("/conversation/c/2$"));
    await page.goto(call(SWIFT, "v2-r5", "2", 0));
    await expect(page.locator('[data-page="call"] .call-nav')).toContainText("← first call");
    await page.goto(call(SWIFT, "v2-r5", "2", 3));
    await expect(page.locator('[data-page="call"] .call-nav')).toContainText("last call →");
    // The tool with no end yet: its result is not available.
    await page.goto(call(SWIFT, "v2-r5", "2", 2));
    await expect(page.locator('[data-block="tool"][data-tool="2"] .missing')).toHaveCount(1);
  });

  test("a claude call withholds its thinking (n/a); a call that doesn't exist is not available", async ({ page }) => {
    await page.goto(call(OPUS, "run-9", "1", 0));
    const p = page.locator('[data-page="call"]');
    await expect(p.locator('[data-stat="thinking"] .na')).toHaveCount(1);
    await expect(p.locator('[data-block="thinking"]')).toHaveCount(0);
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

test.describe("D. layout: pinned heads, compact numbers, search, folded cells", () => {
  test("the section heading and the column heads stay pinned; numbers take their digits' width, the text the rest", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    await expect(p.locator('[data-section="calls"] .rp-head')).toHaveCSS("position", "sticky");
    await expect(p.locator("table.calls thead th").first()).toHaveCSS("position", "sticky");
    const widths = await p.locator("table.calls tbody tr").first().locator("td").evaluateAll((tds) => tds.map((td) => ({ cls: td.className, w: td.getBoundingClientRect().width })));
    const said = widths.find((w) => w.cls.includes("said"))!;
    for (const w of widths.filter((x) => x.cls.includes("n"))) expect(w.w, w.cls).toBeLessThan(160);
    expect(said.w, JSON.stringify(widths)).toBeGreaterThan(Math.max(...widths.filter((x) => !x.cls.includes("said")).map((x) => x.w)) * 2);
    // Scrolled deep into the calls, the heading is still in view.
    await page.locator("table.calls tbody tr").last().scrollIntoViewIfNeeded();
    await expect(p.locator('[data-section="calls"] .rp-head')).toBeInViewport();
  });

  test("each section folds behind its twisty, and the fold is remembered", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    const calls = p.locator('[data-section="calls"]');
    await expect(calls).toHaveAttribute("data-collapsed", "false");
    await expect(calls.locator("table.calls")).toBeVisible();
    await calls.getByRole("button", { name: "Collapse Model calls" }).click();
    await expect(calls).toHaveAttribute("data-collapsed", "true");
    await expect(calls.locator("table.calls")).toBeHidden();
    await expect(calls.locator(".rp-head")).toBeVisible();
    // Another section is untouched; the fold survives a reload; the twisty opens it again.
    await expect(p.locator('[data-section="tools"] table.tools')).toBeVisible();
    await page.reload();
    await expect(page$(page).locator('[data-section="calls"]')).toHaveAttribute("data-collapsed", "true");
    await page$(page).locator('[data-section="calls"]').getByRole("button", { name: "Expand Model calls" }).click();
    await expect(page$(page).locator('[data-section="calls"] table.calls')).toBeVisible();
  });

  test("a section's magnifier opens its own search, as you type, with the hits marked and the count of what matches", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    const calls = p.locator('[data-section="calls"]');
    // The count's place holds the magnifier; the box appears on a click.
    await expect(calls.locator('[data-fact="count"]')).toHaveCount(0);
    await expect(calls.getByRole("searchbox")).toHaveCount(0);
    await calls.getByRole("button", { name: "Search model calls" }).click();
    const box = calls.getByRole("searchbox", { name: "Search model calls" });
    await expect(box).toBeFocused();
    await expect(calls.locator('[data-fact="count"]')).toHaveText("4");
    // "harness" is in two calls' thinking and one call's text: all three are shown, each with the hit marked (a call
    // found through its thinking shows that thinking in Said).
    await box.fill("harness");
    await expect(calls.locator("table.calls tbody tr")).toHaveCount(3);
    for (const i of [0, 1, 2]) await expect(calls.locator("table.calls tbody tr").nth(i).locator("mark").first()).toHaveText(/harness/i);
    await expect(calls.locator('[data-fact="count"]')).toHaveText("3 of 4");
    await box.fill("everything is complete");
    await expect(calls.locator("table.calls tbody tr")).toHaveCount(1);
    // The tools section has its own: the tool whose result holds "attempt 2" is found through its result; the argument too.
    const tools = p.locator('[data-section="tools"]');
    await expect(tools.locator("table.tools tbody tr")).toHaveCount(3);
    await tools.getByRole("button", { name: "Search tool calls" }).click();
    const tbox = tools.getByRole("searchbox", { name: "Search tool calls" });
    await tbox.fill("attempt 2");
    await expect(tools.locator("table.tools tbody tr")).toHaveCount(2);
    await expect(tools.locator("table.tools tbody tr mark").first()).toHaveText("attempt 2");
    await expect(tools.locator('[data-fact="count"]')).toHaveText("2 of 3");
    await tbox.fill("npm test");
    await expect(tools.locator("table.tools tbody tr")).toHaveCount(1);
    // The calls' search is still its own, untouched by the tools'.
    await expect(calls.locator("table.calls tbody tr")).toHaveCount(1);
    // The magnifier again clears and closes the search.
    await tools.getByRole("button", { name: "Search tool calls" }).click();
    await expect(tools.getByRole("searchbox")).toHaveCount(0);
    await expect(tools.locator("table.tools tbody tr")).toHaveCount(3);
  });

  test("a cell shows five lines, and + shows the whole of it", async ({ page }) => {
    await page.goto(conv(SWIFT, "v2-r5", "2"));
    const p = page$(page);
    await expect(p).toHaveAttribute("data-backfilled", "true");
    await byType(page);
    const cell = p.locator('table.calls tbody tr[data-call="3"] .clamp-cell');
    await expect(cell.locator(".clamp")).toHaveAttribute("data-folded", "true");
    const folded = await cell.locator(".clamp").evaluate((e) => e.getBoundingClientRect().height);
    await cell.getByRole("button", { name: "Show all" }).click();
    await expect(cell.locator(".clamp")).toHaveAttribute("data-expanded", "true");
    const whole = await cell.locator(".clamp").evaluate((e) => e.getBoundingClientRect().height);
    expect(whole).toBeGreaterThan(folded);
    await expect(cell.locator(".clamp")).toContainText("Committed.");
    await cell.getByRole("button", { name: "Show less" }).click();
    await expect(cell.locator(".clamp")).toHaveAttribute("data-folded", "true");
    // A short cell has no button; a long tool result is folded in the tools table.
    await expect(p.locator('table.calls tbody tr[data-call="0"] .clamp-more')).toHaveCount(0);
    await expect(p.locator('table.tools tbody tr[data-tool="0"] .clamp[data-folded="true"]')).toHaveCount(1);
  });
});
