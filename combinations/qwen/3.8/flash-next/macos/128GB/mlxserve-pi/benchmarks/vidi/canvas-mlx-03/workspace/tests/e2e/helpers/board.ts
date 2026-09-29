import { type Page, type Locator, expect } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id.ts';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function baseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5178';
}

/** ws:// base for the room endpoint (mirrors the client's wsServerUrl()). */
export function wsBaseUrl(): string {
  return baseUrl().replace(/^http/, 'ws');
}

/**
 * Create a board for a test, through the test-only `initialize` hook
 * (src/worker/test-hooks.ts).
 *
 * Why a hook and not `POST /api/boards`: that endpoint is rate limited per
 * visitor (PRD share.rate_limit), and a suite creates far more than 10 boards a
 * minute — the limit is exactly what story 5's own tests measure, so test setup
 * must not consume it. The hook creates the same board the API would: the same
 * `BoardRoom.initialize()` call, without the limiter in front of it.
 *
 * Safe to call on a board that already exists (creating is create-once), which is
 * what lets a spec re-open a board after a server restart through the same path.
 */
export async function createBoardForTests(page: Page, boardId = newBoardId()): Promise<string> {
  void page;
  return ensureBoard(boardId);
}

/**
 * Create a board from the test worker itself, with no browser page involved: the
 * same `/__test/boards/:id/initialize` call, the same `BoardRoom.initialize()`.
 *
 * A Node-side collaborator (`RawClient`) needs this before it can connect: since
 * story 5 a link to a board that does not exist is a 404, and opening a socket no
 * longer brings a board into existence. Worker-side on purpose — a browser request
 * would be visible to `page.route()` interception, and test setup is not what those
 * tests are measuring.
 *
 * `origin` names the server to create it on; the persistence suite starts its own
 * `wrangler dev` per test, so it passes that server's address.
 */
export async function ensureBoard(
  boardId = newBoardId(),
  origin: string = baseUrl(),
): Promise<string> {
  const response = await fetch(`${origin}/__test/boards/${boardId}/initialize`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`test setup could not create board ${boardId}: HTTP ${response.status}`);
  }
  return boardId;
}

/**
 * Open a board at its own link and wait until it is connected.
 *
 * Since story 5 a link only opens if a board exists behind it, so this creates the
 * board first (idempotent) — that is the whole reason it takes an optional id and
 * returns the one it used.
 */
export async function openSharedBoard(page: Page, boardId?: string): Promise<string> {
  const id = await createBoardForTests(page, boardId ?? newBoardId());
  await page.goto(`/b/${id}`);
  // The viewport proves React mounted and the link check passed; the hidden badge
  // proves the first sync.
  await expect(page.getByTestId('viewport')).toBeVisible();
  await waitForConnection(page);
  return id;
}

/** A fresh board of the current run, opened at its own link. */
export async function openBoard(page: Page): Promise<string> {
  return openSharedBoard(page);
}

export function connectionStatus(page: Page): Locator {
  return page.getByTestId('connection-status');
}

/** Wait until the badge is hidden (stably connected). */
export async function waitForConnection(page: Page): Promise<void> {
  await expect(connectionStatus(page)).toBeHidden({ timeout: 20000 });
}

/** Force the client to disconnect from the room (test build only). The badge
 *  goes to Reconnecting and stays down until restoreConnection(). */
async function callBoardHook(page: Page, name: 'simulateDrop' | 'restoreConnection'): Promise<void> {
  await page.waitForFunction((n) => !!(window).__vidi6?.[n], name, { timeout: 10000 });
  await page.evaluate((n) => {
    (window).__vidi6![n]!();
  }, name);
}

export function simulateDrop(page: Page): Promise<void> {
  return callBoardHook(page, 'simulateDrop');
}

/** Reconnect after simulateDrop(): real reconnect + resync. */
export function restoreConnection(page: Page): Promise<void> {
  return callBoardHook(page, 'restoreConnection');
}

/** The mapped connection state from the test hook (undefined if not present). */
export function connectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window).__vidi6?.connectionState);
}

export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

export function zoomInButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom in' });
}

export function zoomOutButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom out' });
}

export function resetButton(page: Page) {
  return page.getByRole('button', { name: 'Reset view' });
}

// Centre of the origin crosshair in viewport/CSS pixels.
export async function originCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Background size of the grid in CSS pixels ([gx, gy]).
export async function gridSpacingPx(page: Page): Promise<{ gx: number; gy: number }> {
  return page.getByTestId('viewport').evaluate((el) => {
    const cs = getComputedStyle(el).backgroundSize; // e.g. "24px 24px"
    const [gx, gy] = cs.split(/\s+/).map((s) => parseFloat(s));
    return { gx, gy };
  });
}

// Jump the camera via the test-only window.__vidi6 hook (test build only).
export async function setCamera(page: Page, cam: CameraState) {
  await page.waitForFunction(() => !!window.__vidi6);
  await page.evaluate(async (c) => {
    window.__vidi6!.setCamera(c);
    // Let the camera's requestAnimationFrame coalescing flush into the DOM.
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  }, cam);
}

// ---------------------------------------------------------------------------
// Collaboration helpers
// ---------------------------------------------------------------------------

export interface NoteInfo {
  id: string;
  x: number; // world left
  y: number; // world top
  z: number;
  cx: number; // screen centre x
  cy: number;
  w: number;
  h: number;
}

/** Read every sticky's id, world x/y, z, and screen centre. */
export async function notes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]'),
    ) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.noteId ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        z: parseFloat(el.style.zIndex),
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        w: r.width,
        h: r.height,
      };
    });
  });
}

export async function noteCount(page: Page): Promise<number> {
  return (await notes(page)).length;
}

export async function noteIds(page: Page): Promise<string[]> {
  return (await notes(page))
    .map((n) => n.id)
    .sort();
}

export async function noteTexts(page: Page): Promise<string[]> {
  const t = await page
    .getByTestId('sticky-text')
    .allInnerTexts();
  return t.map((s) => s.trim()).filter((s) => s.length > 0).sort();
}

/** Find the sticky showing `text`, or undefined. Matches the sticky-text label so
 *  it is stable regardless of the note's other overlay text. */
export async function noteByTest(page: Page, text: string): Promise<NoteInfo | undefined> {
  return page.evaluate((needle) => {
    const labels = Array.from(document.querySelectorAll('[data-testid="sticky-text"]'));
    const hit = labels.find((el) => (el.textContent ?? '').trim() === needle);
    const group = hit?.closest('[role="group"][aria-label="Sticky note"]') as HTMLElement | null;
    if (!group) return undefined;
    const r = group.getBoundingClientRect();
    return {
      id: group.dataset.noteId ?? '',
      x: parseFloat(group.style.left),
      y: parseFloat(group.style.top),
      z: parseFloat(group.style.zIndex),
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
      w: r.width,
      h: r.height,
    };
  }, text);
}

/** Create a sticky by double-clicking the canvas at a screen point, then typing. */
export async function createSticky(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(80);
  await page.keyboard.type(text);
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}
