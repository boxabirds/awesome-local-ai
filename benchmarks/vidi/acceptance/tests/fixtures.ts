// Shared fixtures and helpers for the held-out vidi6 acceptance suite.
//
// Every locator here comes from the spec's PRD copy or the design's declared
// DOM contract (aria-labels, roles, keyboard shortcuts). Nothing depends on an
// implementation's internal structure, so the suite runs unchanged against any
// combination's workspace.
import { test as base, expect, type Page, type Locator, type BrowserContext } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_URL, CONTROL_URL } from './app-server';

const SHOT_DIR = process.env.SHOT_DIR ?? '';

export const DONE = new Set(
  (process.env.DONE_STORIES ?? '').split(',').filter(Boolean).map(Number),
);

// Skip a test unless every story it depends on has been implemented at this checkpoint.
export function requires(...stories: number[]) {
  const missing = stories.filter((s) => !DONE.has(s));
  base.skip(missing.length > 0, `needs stories ${missing.join(',')}`);
}

// Handle on the server started by global-setup.ts.
export const app = {
  url: APP_URL,
  async restart() {
    const r = await fetch(CONTROL_URL + '/restart', { method: 'POST' });
    if (!r.ok) throw new Error(`restart failed: ${await r.text()}`);
  },
};

// newPerson(): a separate browser context (another person), pointed at the app.
type TestFixtures = { app: typeof app; newPerson: () => Promise<Page> };

export const test = base.extend<TestFixtures>({
  app: async ({}, use) => use(app),
  baseURL: async ({}, use) => use(APP_URL),
  newPerson: async ({ browser, contextOptions, viewport, permissions }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const ctx = await browser.newContext({ ...contextOptions, baseURL: APP_URL, viewport, permissions });
      contexts.push(ctx);
      return ctx.newPage();
    });
    for (const c of contexts) await c.close();
  },
});
export { expect };

// ---------- board helpers ----------

export const BOARD_URL_RE = /\/b\/[A-Za-z0-9_-]{22}$/;
export const BOARD_CENTRE = { x: 640, y: 400 };

// PRD share.rate_limit: more than 10 boards per visitor per minute is refused.
// The suite is one visitor creating a board per test, so it paces itself to stay
// inside that setting instead of tripping it (which a correct app must do).
const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 60_000;
const CREATE_WINDOW_MARGIN_MS = 2_000;
// Kept on disk: Playwright replaces the worker process after any failed test,
// which would silently reset an in-memory count. Stale entries age out below.
const CREATE_TIMES_FILE = join(tmpdir(), `vidi-accept-creates-${new URL(APP_URL).port}.json`);

function readCreateTimes(): number[] {
  try { return JSON.parse(readFileSync(CREATE_TIMES_FILE, 'utf8')); } catch { return []; }
}

async function paceCreate(page: Page) {
  const span = CREATE_WINDOW_MS + CREATE_WINDOW_MARGIN_MS;
  const now = Date.now();
  const times = readCreateTimes().filter((t) => now - t < span);
  if (times.length >= CREATE_LIMIT) {
    const waitMs = times[times.length - CREATE_LIMIT] + span - now;
    test.info().setTimeout(test.info().timeout + waitMs);
    await page.waitForTimeout(waitMs);
  }
  writeFileSync(CREATE_TIMES_FILE, JSON.stringify([...times, Date.now()]));
}

// Click "Create a board" on the home page and wait for the new board's address.
// Returns when the click happened, so timing checks exclude any pacing wait.
export async function createBoard(page: Page): Promise<number> {
  await paceCreate(page);
  const clickedAt = Date.now();
  await page.getByRole('button', { name: 'Create a board' }).click();
  await page.waitForURL(BOARD_URL_RE);
  return clickedAt;
}

// Open a fresh board. Before story 5 the app shows (or redirects to) a board
// at '/'; from story 5 on '/' is the home page with "Create a board".
export async function openBoard(page: Page): Promise<string> {
  await page.goto('/');
  if (DONE.has(5)) await createBoard(page);
  await expect(zoomLabel(page)).toBeVisible();
  if (DONE.has(3)) await waitConnected(page);
  return page.url();
}

// Open an existing board address in another page (another person).
export async function joinBoard(page: Page, url: string) {
  await page.goto(url);
  await expect(zoomLabel(page)).toBeVisible();
  await waitConnected(page);
}

export async function waitConnected(page: Page) {
  // Badge is hidden while connected normally (story 3).
  await expect(page.getByText(/Connecting…|Opening board…/)).toHaveCount(0, { timeout: 15_000 });
}

export const zoomLabel = (page: Page) => page.getByText(/^\d+%$/).first();
export const notes = (page: Page): Locator => page.locator('[role="group"][aria-label="Sticky note"]');
export const hint = (page: Page) => page.getByText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

// The design lets the view (and its zoom label) update on the next animation frame, so a
// test must wait for each step to land before clicking again or reading the zoom.
export async function zoomStep(page: Page, name: 'Zoom in' | 'Zoom out') {
  const before = await zoomLabel(page).innerText();
  await page.getByRole('button', { name }).click();
  await expect(zoomLabel(page)).not.toHaveText(before);
}

export async function zoomOutBy(page: Page, steps: number): Promise<number> {
  for (let i = 0; i < steps; i++) await zoomStep(page, 'Zoom out');
  return (await zoomPercent(page)) / 100;
}

export async function zoomPercent(page: Page): Promise<number> {
  return Number((await zoomLabel(page).innerText()).replace('%', ''));
}

export async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return b;
}

export const centreOf = (b: { x: number; y: number; width: number; height: number }) =>
  ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number },
                           opts: { steps?: number; shift?: boolean } = {}) {
  const STEPS = opts.steps ?? 12;
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: STEPS });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

// Create a sticky note by double-clicking empty board space, type, end editing.
export async function createNote(page: Page, at: { x: number; y: number }, text: string) {
  const before = await notes(page).count();
  await page.mouse.dblclick(at.x, at.y);
  await expect(notes(page)).toHaveCount(before + 1);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const note = text ? notes(page).filter({ hasText: text }) : notes(page).nth(before);
  await expect(note).toHaveCount(1);
  return note;
}

export async function clickEmpty(page: Page, at = { x: 1000, y: 150 }) {
  await page.mouse.click(at.x, at.y);
}

export async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// Put the caret at the start or end of whatever editor has focus (textarea,
// input or contenteditable), without relying on platform-specific keys.
export async function caretTo(page: Page, where: 'start' | 'end') {
  await page.evaluate((w) => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const pos = w === 'start' ? 0 : el.value.length;
      el.setSelectionRange(pos, pos);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(w === 'start');
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, where);
}
