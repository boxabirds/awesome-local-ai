/**
 * Multi-participant e2e helpers (story 3: live collaboration).
 *
 * Opens N isolated browser contexts on the same board, drives the real UI,
 * and asserts cross-participant convergence with a generous functional
 * timeout. Change-delivery latency is *reported*, not asserted: the model,
 * the browsers and the server share one machine, so wall-clock timing there
 * is not a reliable pass/fail signal (see config LIVE_UPDATE_LATENCY_BUDGET_MS).
 */
import { expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';
import { setCamera } from './board';

export interface Participant {
  name: string;
  context: import('@playwright/test').BrowserContext;
  page: Page;
  boardId: string;
  close(): Promise<void>;
}

/**
 * Open `n` isolated browser contexts on the same board and wait for each to
 * report the mapped connection state 'connected'. The camera is normalised so
 * note geometry is directly comparable across participants.
 */
export async function openParticipants(
  browser: Browser,
  n: number,
  boardId: string = newBoardId(),
): Promise<Participant[]> {
  const participants: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(
      () => (window as { __vidi6?: { connectionState: string } }).__vidi6?.connectionState === 'connected',
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    );
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    participants.push({
      name: `P${i}`,
      context,
      page,
      boardId,
      close: async () => {
        await context.close();
      },
    });
  }
  return participants;
}

/**
 * `expect.poll` wrapper with the shared functional timeout. Records how long
 * the condition took to become true and logs it against the latency budget
 * (reported, never asserted).
 */
export async function expectEventually(
  condition: () => Promise<boolean> | boolean,
  description: string,
  timeout: number = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  await expect.poll(condition, { timeout, message: description }).toBe(true);
  const took = Date.now() - start;
  const over = took > LIVE_UPDATE_LATENCY_BUDGET_MS;
  console.log(
    `[latency] ${description}: ${took}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms${
      over ? ' — EXCEEDED, reported only' : ''
    })`,
  );
}

const NOTE = '[data-testid="sticky-note"]';
const TEXTAREA = '[data-testid="sticky-textarea"]';
// The note's text lives in a dedicated display element; the note's own
// textContent also includes selection UI chrome (e.g. the delete button),
// so we read the display element for a clean, comparable text value.
const DISPLAY = '[data-sticky-display]';

/** Number of sticky notes currently rendered on the page. */
export async function noteCount(page: Page): Promise<number> {
  return page.locator(NOTE).count();
}

/** Double-click to create a note at a screen point, optionally typing text. */
export async function createNote(
  page: Page,
  x: number,
  y: number,
  text = '',
): Promise<void> {
  await page.mouse.dblclick(x, y);
  const textarea = page.locator(TEXTAREA);
  // Bounded wait: if the dblclick landed on an existing note (no new editor),
  // throw rather than hang the whole soak.
  await textarea.waitFor({ state: 'visible', timeout: 5000 });
  if (text) await textarea.fill(text);
  await page.keyboard.press('Escape');
}

/** Drag the note at `index` by (dx, dy) screen pixels. */
export async function moveNote(
  page: Page,
  index: number,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await page.locator(NOTE).nth(index).boundingBox();
  if (!box) throw new Error(`note ${index} not found`);
  const gx = box.x + box.width / 2;
  const gy = box.y + box.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + dx, gy + dy, { steps: 8 });
  await page.mouse.up();
}

/** Select the note at `index` and apply a colour swatch (e.g. 'swatch-blue'). */
export async function recolorNote(page: Page, index: number, swatchTestid: string): Promise<void> {
  await page.locator(NOTE).nth(index).click({ timeout: 5000 });
  await page.locator(`[data-testid="${swatchTestid}"]`).click({ timeout: 5000 });
}

/** Select the note at `index` and delete it. */
export async function deleteNote(page: Page, index: number): Promise<void> {
  await page.locator(NOTE).nth(index).click({ timeout: 5000 });
  await page.keyboard.press('Delete');
}

/**
 * A normalised, order-independent snapshot of the board: each note's rounded
 * position, colour and text, sorted so it is comparable across participants.
 */
export async function boardSnapshot(page: Page): Promise<string> {
  const notes = page.locator(NOTE);
  const count = await notes.count();
  const items: Array<{ x: number; y: number; text: string; color: string }> = [];
  for (let i = 0; i < count; i++) {
    const note = notes.nth(i);
    const box = await note.boundingBox();
    const text = ((await note.locator(DISPLAY).textContent()) ?? '').trim();
    const color = await note.evaluate((el) => getComputedStyle(el).backgroundColor);
    items.push({
      x: Math.round(box?.x ?? 0),
      y: Math.round(box?.y ?? 0),
      text,
      color,
    });
  }
  items.sort((a, b) => a.x - b.x || a.y - b.y || a.text.localeCompare(b.text));
  return JSON.stringify(items);
}

/** The text content of the note at `index` (from the display element). */
export async function noteText(page: Page, index: number): Promise<string> {
  return ((await page.locator(NOTE).nth(index).locator(DISPLAY).textContent()) ?? '').trim();
}

/** The mapped connection state exposed on the test hook. */
export async function connectionState(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as { __vidi6?: { connectionState: string } }).__vidi6?.connectionState ?? 'unknown',
  );
}

/** Every connection-state change since load, in order. */
export async function connectionStateLog(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as { __vidi6?: { connectionStateLog: string[] } }).__vidi6?.connectionStateLog ?? [],
  );
}

/** Close the page's board WebSocket to simulate a network drop. */
export async function disconnectPage(page: Page): Promise<void> {
  await page.evaluate(
    () => (window as { __vidi6?: { disconnect?: () => void } }).__vidi6?.disconnect?.(),
  );
}
