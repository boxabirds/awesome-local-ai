import { expect, test } from "@playwright/test";

// W-1 (story 23, TC-B1), driven by tests/no-github-e2e-test.sh: the run the node made with no git remote is listed by
// the app, and its run page shows the score of record that finalize wrote on the node and the collector brought.
const STACK = process.env.W1_STACK ?? "";
const RUN = process.env.W1_RUN ?? "";
const SCORE = process.env.W1_SCORE ?? "";
const PACK = process.env.W1_PACK ?? "";

test("the run made with no git remote is shown with its score of record", async ({ page, request, baseURL }) => {
  expect(baseURL && PACK && STACK && RUN && SCORE, "W1_BASE, W1_PACK, W1_STACK, W1_RUN and W1_SCORE are set by the script").toBeTruthy();
  const rows = async () => ((await (await request.get("/api/state")).json()).rows as { stack: string; runId: string }[])
    .map((r) => `${r.stack} ${r.runId}`);
  await expect.poll(rows, { timeout: 30_000 }).toEqual([`${STACK} ${RUN}`]);   // the server's first read may still be under way
  await page.goto(`/#/${PACK}/r/${encodeURIComponent(STACK)}/${RUN}`);
  await expect(page.locator('[data-page="run"] [data-section="header"] [data-stat="scoreOfRecord"] .lead-n')).toHaveText(SCORE);
});
