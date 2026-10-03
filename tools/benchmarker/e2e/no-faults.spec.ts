import { expect, test, type Page } from "@playwright/test";
import type { State } from "../shared/types.ts";

// The app presents results. It never shows its own or the harness's faults, diagnoses, causes, remedies, commands or
// apologies: those go to the monitor through GET /api/faults, which no page reads. Every page here is swept for the
// words such text used, in what it shows and in every hover; and the neutral state stands where a figure is not
// available. The faults themselves, over the same fixture, are server/faults.test.ts's.

const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const OPUS = "reference/opus-5.5";
const VK = "qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi";
const enc = encodeURIComponent;
const runHref = (stack: string, run: string) => `#/vidi/r/${enc(stack)}/${enc(run)}`;

/** Words only fault narration used. "unchecked", "accounting" and "invalid" were the marks; the rest the advice. */
const FAULT_WORDS = /harness|\bbug\b|since fixed|fixed in [0-9a-f]|\ba fix\b|commit [0-9a-f]{6}|uv run|backfill|\.py\b|Do this|What to do|Likely cause|needs a person|Needs you|recompute|retried|retry|attempt \d|invalid|accounting|unchecked|re-score (failed|was skipped|gave)|exited [0-9]|PREFLIGHT|stopped by the operator|no reason given|none given|connection refused|timed out|fetch error|dbench:|git:/i;
/** The pages swept: one of each kind, on the fixture's data, including the ones with a fault behind them. */
const PAGES: [string, string][] = [
  ["overview", "#/"],
  ["machines list", "#/machines"],
  // Not the setup page: it is instructions for making a node, which name the harness and what happens when a job
  // fails, not results; network-neutral.spec.ts covers its words.
  ["stories index", "#/vidi/stories"],
  ["combination (a failed check, a pending score, an invalid run)", `#/vidi/c/${enc(SWIFT)}`],
  ["combination (a cloud model, no accounting)", `#/vidi/c/${enc(OPUS)}`],
  ["combination (a final re-score that failed)", `#/vidi/c/${enc(VK)}`],
  ["run (a failed check, a restarted job)", runHref(SWIFT, "v2-r1")],
  ["run (cancelled then done)", runHref(SWIFT, "v2-r5")],
  ["run (no score: re-score failed, needs a person)", runHref(VK, "v2-r1")],
  ["run (cloud model)", runHref(OPUS, "run-9")],
  ["story run (the failed check)", `${runHref(SWIFT, "v2-r1")}/s/1`],
  ["story run (passing check)", `${runHref(SWIFT, "v2-r5")}/s/2`],
  ["story run (no accounting)", `${runHref(OPUS, "run-9")}/s/1`],
  ["story page", "#/vidi/s/1"],
  ["story page 2", "#/vidi/s/2"],
  ["machine (running, queue, ended jobs with reasons)", "#/machines/node-a"],
  ["machine (idle)", "#/machines/node-d"],
  ["conversation (complete, with fault words in the agent's own text)", `${runHref(SWIFT, "v2-r5")}/s/2/conversation`],
  ["conversation (not available)", `${runHref(SWIFT, "v2-r5")}/s/1/conversation`],
  ["call (its thinking and a failed tool's result)", `${runHref(SWIFT, "v2-r5")}/s/2/conversation/c/1`],
];

/** The page's text and every hover, as one string: the app's own words. What the agent itself said
 * (data-quoted="agent": a tool's result, the model's text) is a result the page presents verbatim, not the app's
 * narration, so it is left out here and checked apart (quotedText). */
async function everything(page: Page): Promise<string> {
  const text = await page.locator("main").evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    for (const q of copy.querySelectorAll('[data-quoted="agent"]')) q.remove();
    document.body.appendChild(copy);
    const t = copy.innerText;
    copy.remove();
    return t;
  });
  const tips = await page.locator('main [data-tip]:not([data-quoted="agent"] *)').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tip ?? ""));
  const labels = await page.locator('main [aria-label]:not([data-quoted="agent"] *)').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return [text, ...tips, ...labels].join("\n");
}

/** What the agent said, verbatim, on the page. */
async function quotedText(page: Page): Promise<string> {
  return (await page.locator('main [data-quoted="agent"]').allInnerTexts()).join("\n");
}

async function patchState(page: Page, change: (s: State) => void) {
  await page.route("**/api/state", async (route) => {
    const res = await route.fetch();
    const s = (await res.json()) as State;
    for (const r of s.rows) if (r.live?.status === "running") { r.live.agentMinutes ??= 0; r.live.storyStartedAt = s.now - r.live.agentMinutes * 60; }
    change(s);
    await route.fulfill({ response: res, json: s });
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

test.describe("no page narrates a fault", () => {
  for (const [name, href] of PAGES) {
    test(`${name}: no fault word in its text, hovers or labels`, async ({ page }) => {
      await page.goto(`/${href}`);
      await expect(page.locator("[data-page]")).toBeVisible();
      const all = await everything(page);
      const hit = all.match(FAULT_WORDS);
      expect(hit ? `${hit[0]} in: …${all.slice(Math.max(0, hit.index! - 80), hit.index! + 80)}…` : null).toBeNull();
      await expect(page.locator(".check-flag, .check-unchecked, .check-explain, .check-summary, .invalid-run, .invalid-tag, .invalid-banner, .final-score-note, .need-command, .judge-wait, [data-section=\"needs\"], [data-section=\"invalid\"], [data-section=\"jobs\"]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /copy|log/i })).toHaveCount(0);
    });
  }

  test("the agent's own words are presented verbatim, fault words and all, and are the only place such words appear", async ({ page }) => {
    await page.goto(`/${runHref(SWIFT, "v2-r5")}/s/2/conversation`);
    await expect(page.locator('[data-page="conversation"]')).toHaveAttribute("data-backfilled", "true");
    const quoted = await quotedText(page);
    expect(quoted).toMatch(/harness/);
    expect(quoted).toMatch(/attempt 2/);
    expect(quoted).toMatch(/invalid/);
    expect((await everything(page)).match(FAULT_WORDS)).toBeNull();
    await page.goto(`/${runHref(SWIFT, "v2-r5")}/s/2/conversation/c/1`);
    await expect(page.locator('[data-page="call"] [data-block="thinking"]')).toBeVisible();
    const call = await quotedText(page);
    expect(call).toMatch(/retry/);
    expect(call).toMatch(/harness/);
    expect((await everything(page)).match(FAULT_WORDS)).toBeNull();
  });

  test("the header strip: how fresh the data is, and the suite; never a source's error", async ({ page }) => {
    await page.goto("/");
    const meta = page.getByTestId("meta");
    await expect(meta).toHaveText(/^updated \d+s ago · suite vidi-v2\.0-pre1$/);
    await expect(page.locator("header .err")).toHaveCount(0);
    await patchState(page, (s) => { s.updating = false; s.updatedAt = Date.parse("2026-09-30T15:28:00Z") / 1000; });
    await page.reload();
    await expect(meta).toHaveText("not updated since 2026-09-30 15:28 UTC · suite vidi-v2.0-pre1");
    await expect(page.locator("header")).not.toContainText(/git|dbench|error/i);
    await patchState(page, (s) => { s.updatedAt = 0; });
    await page.reload();
    await expect(meta).toContainText("not updated yet");
  });

  test("the state the page gets carries nothing of the faults the feed carries", async ({ request }) => {
    const s = (await (await request.get("/api/state")).json()) as State & Record<string, unknown>;
    for (const k of ["fetchError", "dbenchError"]) expect(s).not.toHaveProperty(k);
    for (const r of s.rows) {
      for (const k of ["invalid", "finalize", "stages", "hasBundle", "record", "dbenchJobs"]) expect(r, r.runId).not.toHaveProperty(k);
      for (const j of r.jobs) expect(j).not.toHaveProperty("reason");
      if (r.live) expect(r.live).not.toHaveProperty("logTail");
      for (const st of r.stories) if (st.usage?.split) expect(st.usage.split).not.toHaveProperty("check");
      for (const st of r.stories) expect(typeof st.hasConversation).toBe("boolean");
      expect(r.statusNote).not.toMatch(/exit|attempt|failed/i);
    }
    expect(JSON.stringify(s)).not.toMatch(/needs_person|harness_fault|accounting|cancel_reason/);
  });
});

test.describe("the neutral state where a figure is not available", () => {
  test("the failed accounting check: its story has no breakdown, and keeps its own totals", async ({ request }) => {
    const s = (await (await request.get("/api/state")).json()) as State;
    const r = s.rows.find((x) => x.stack === SWIFT && x.runId === "v2-r1")!;
    const story = r.stories.find((x) => x.id === "1")!;
    expect(story.usage!.split).toBeNull();
    expect(story.usage!.agentSeconds).toBe(720);
    expect(story.ownPassed).not.toBeNull();
    const faults = (await (await request.get("/api/faults")).json()) as { faults: { kind: string; run: string; story?: string; detail: Record<string, unknown> }[] };
    const f = faults.faults.find((x) => x.kind === "accounting_failed" && x.run === "v2-r1" && x.story === "1")!;
    expect(f.detail.problems).toEqual(["tool call t9 never ended; counted to the agent's next step"]);
  });

  test("the feed: every fault has its kind, and the id is stable across calls", async ({ request }) => {
    const a = (await (await request.get("/api/faults")).json()) as { generatedAt: string; faults: { id: string; kind: string; firstSeenAt?: string }[] };
    const b = (await (await request.get("/api/faults")).json()) as { faults: { id: string; firstSeenAt?: string }[] };
    expect(a.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(a.faults.length).toBeGreaterThan(5);
    expect(a.faults.map((f) => f.id)).toEqual(b.faults.map((f) => f.id));
    for (const f of a.faults) expect(f.firstSeenAt).toMatch(/^\d{4}-/);
    // The fixture's running stories started on fixed dates, so by now they have been silent for days: that is a fault too.
    // The fixture's finished runs ended days ago, and most of their stories have no conversation in its warehouse: a collection fault each.
    expect(new Set(a.faults.map((f) => f.kind))).toEqual(new Set(["run_invalid", "accounting_failed", "accounting_unchecked", "not_scored", "no_workspace_bundle", "job_cancelled", "job_restarted", "machine_idle", "machine_no_activity", "conversation_missing"]));
    const missing = a.faults.filter((f) => f.kind === "conversation_missing");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((f) => f.story)).toBe(true);
  });
});
