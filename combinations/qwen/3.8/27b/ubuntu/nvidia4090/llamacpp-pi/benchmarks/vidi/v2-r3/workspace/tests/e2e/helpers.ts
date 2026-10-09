import { expect, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  type StickyColor,
} from '../../src/shared/config';

/**
 * Shared e2e helpers. The app is built in `test` mode, so the `window.__vidi6`
 * hooks (setCamera, connectionState) are available. We use a fixed camera so
 * world and screen coordinates coincide (zoom 1, world origin at viewport
 * centre), which makes note placement and dragging deterministic.
 */

/** Camera that puts world (0,0) at the centre of a 1280x800 viewport, zoom 1. */
const CAM = { x: -640, y: -400, zoom: 1 };

/** Wait for the app to load and complete its first sync (badge hidden). */
export async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  await setCamera(page, CAM.x, CAM.y, CAM.zoom);
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(([cx, cy, z]) => window.__vidi6?.setCamera(cx, cy, z), [x, y, zoom]);
}

/**
 * Create a sticky note by double-clicking empty board space at screen point
 * (sx, sy). With the default camera the note's centre lands exactly on
 * (sx, sy). The note is left in edit mode (textarea focused).
 */
export async function createNoteAt(page: Page, sx: number, sy: number): Promise<void> {
  await page.mouse.dblclick(sx, sy);
}

/** All sticky-note elements on the page. */
export function notes(page: Page) {
  return page.getByRole('group', { name: 'Sticky note' });
}

export async function noteCount(page: Page): Promise<number> {
  return notes(page).count();
}

/**
 * Find the note whose on-screen centre is closest to (sx, sy). Returns a
 * handle carrying the element locator and the expected centre.
 */
export interface NoteHandle {
  page: Page;
  el: import('@playwright/test').Locator;
  cx: number;
  cy: number;
}

export async function findNote(page: Page, sx: number, sy: number): Promise<NoteHandle> {
  const all = notes(page);
  const count = await all.count();
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const b = await all.nth(i).boundingBox();
    if (!b) continue;
    const d = Math.hypot(b.x + b.width / 2 - sx, b.y + b.height / 2 - sy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best === -1) throw new Error(`no note near (${sx},${sy}); count=${count}`);
  return { page, el: all.nth(best), cx: sx, cy: sy };
}

/** End any in-progress edit (Escape keeps the note selected). */
async function endEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/**
 * Type `text` into the note centred at (sx, sy): double-click to enter edit
 * mode, then type. Ends editing on Escape so the note is selected.
 */
export async function typeText(page: Page, sx: number, sy: number, text: string): Promise<void> {
  await page.mouse.dblclick(sx, sy);
  const ta = page.getByLabel('Note text');
  await ta.waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 15 });
  await endEdit(page);
}

/** Read the visible text of the note centred at (sx, sy). */
export async function readText(page: Page, sx: number, sy: number): Promise<string> {
  const h = await findNote(page, sx, sy);
  return ((await h.el.locator('.sticky-text').first().innerText()) ?? '').trim();
}

/** Read the note's background colour as an rgb() string. */
export async function readColor(page: Page, sx: number, sy: number): Promise<string> {
  const h = await findNote(page, sx, sy);
  return h.el.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** Drag the note centred at (from) to centre (to). Returns the new centre. */
export async function moveNote(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  return to;
}

/** Recolour the note centred at (sx, sy): select it, then click the swatch. */
export async function recolorNote(page: Page, sx: number, sy: number, color: StickyColor): Promise<void> {
  await page.mouse.click(sx, sy); // select
  const label = `${color.charAt(0).toUpperCase() + color.slice(1)} colour`;
  await page.getByRole('button', { name: label }).click();
}

/** Delete the note centred at (sx, sy): select it, then click Delete note. */
export async function deleteNote(page: Page, sx: number, sy: number): Promise<void> {
  await page.mouse.click(sx, sy); // select
  await page.getByRole('button', { name: 'Delete note' }).click();
}

/** Normalised snapshot of every note for cross-page equality checks. */
export interface NoteSnapshot {
  x: number;
  y: number;
  color: string;
  text: string;
}

export async function snapshotNotes(page: Page): Promise<NoteSnapshot[]> {
  const all = notes(page);
  const count = await all.count();
  const out: NoteSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const el = all.nth(i);
    const b = await el.boundingBox();
    if (!b) continue;
    out.push({
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2),
      color: await el.evaluate((n) => getComputedStyle(n).backgroundColor),
      text: ((await el.locator('.sticky-text').first().innerText().catch(() => '')) ?? '').trim(),
    });
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y || a.text.localeCompare(b.text));
  return out;
}

/** Wait until the two pages show identical boards (functional, not timing). */
export async function expectSameBoard(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => JSON.stringify(await snapshotNotes(a)) === JSON.stringify(await snapshotNotes(b)),
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
}

/**
 * Measure wall-clock latency for a change to appear on another page and log it
 * against the budget. Per the design, latency on a shared test machine is
 * reported, never asserted.
 */
export async function logLatency(label: string, t0: number, done: () => Promise<boolean>): Promise<void> {
  const t1 = await waitUntilTrue(done);
  const ms = t1 - t0;
  const ok = ms <= LIVE_UPDATE_LATENCY_BUDGET_MS;
  console.log(`[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ${ok ? 'within' : 'over'})`);
}

async function waitUntilTrue(fn: () => Promise<boolean>, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<number> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return Date.now();
    if (Date.now() - start > timeout) throw new Error('logLatency timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
