import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { State } from "../shared/types.ts";
import { LAKE_PORT } from "../playwright.config.ts";

// W-2 (story 23, readers.benchmarker): the app over a lake. The second server reads bench-lake's fixture lake through
// the real bench-lake command; the host checkout (e2e/fixtures/lake-checkout) holds only the packs' bench.json and one
// archived marker, and no run folders. Nothing is read from git.

const BASE = `http://127.0.0.1:${LAKE_PORT}`;
const LAKE = resolve(import.meta.dirname, "../../bench-lake/tests/fixtures/lake");
const SWIFT = "qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi";
const FRESH = `combinations/${SWIFT}/benchmarks/vidi/v2-fresh-r1`;
const enc = encodeURIComponent;

const state = async (request: import("@playwright/test").APIRequestContext) => (await (await request.get(`${BASE}/api/state`)).json()) as State;

test("TC-50: the runs in the lake are listed, with no run folder in the checkout", async ({ request }) => {
  let s = await state(request);
  for (let i = 0; i < 50 && !s.rows.length; i++) s = await state(request); // the first read runs just after start
  // The fixture lake's six runs, less: dryrun-v2r2-s2 (archived, TC-52); sonnet-5.5 v2-r1 (its run.json marks it
  // invalid, and an invalid run is never shown); v2-q36fork-b-r2 and flash-next v2-r1, whose preferred copies (node-d,
  // the node that ran them) the fixture trimmed to the note alone: a run is a folder with a run.json, as it always was.
  expect(s.rows.map((r) => `${r.stack} ${r.runId}`).sort()).toEqual([`${SWIFT} v2-fresh-r1`, "reference/opus-5.5 run-1"]);
});

test("TC-52: a run the checkout marks archived is not listed, on the page or in its data", async ({ page, request }) => {
  expect((await state(request)).rows.some((r) => r.runId === "dryrun-v2r2-s2")).toBe(false);
  await page.goto(`${BASE}/#/vidi/c/${enc(SWIFT)}`);
  await expect(page.getByText("v2-fresh-r1").first()).toBeVisible();
  await expect(page.getByText("dryrun-v2r2-s2")).toHaveCount(0);
});

test("TC-53: the run's record opens in the app, and serves the lake's documents as written", async ({ page, request }) => {
  await page.goto(`${BASE}/#/vidi/r/${enc(SWIFT)}/v2-fresh-r1`);
  const record = page.locator('[data-page="run"] [data-section="links"]').getByRole("link", { name: "record" });
  await expect(record).toHaveAttribute("href", `/record/${FRESH}/`);
  const listing = await request.get(`${BASE}/record/${FRESH}/`);
  expect(listing.status()).toBe(200);
  expect(await listing.text()).toContain(`<a href="/record/${FRESH}/metrics.json">metrics.json</a>`);
  const metrics = await request.get(`${BASE}/record/${FRESH}/metrics.json`);
  expect(await metrics.text()).toBe(readFileSync(`${LAKE}/collected/node-a/${FRESH}/metrics.json`, "utf8"));
});
