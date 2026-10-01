import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../../src/shared/config';

export interface Participant {
  context: BrowserContext;
  page: Page;
  label: string;
}

/** Open two isolated browser contexts on the same board. */
export async function openPair(
  browser: Browser,
  boardId: string,
): Promise<[Participant, Participant]> {
  const [a, b] = await openParticipants(browser, boardId, 2);
  if (!a || !b) throw new Error('openParticipants returned fewer than 2');
  return [a, b];
}

/** Initialize a board via test hook (only works when TEST_HOOKS=1). */
export async function initializeBoard(page: Page, boardId: string): Promise<void> {
  const res = await page.request.post(`/__test/boards/${boardId}/initialize`);
  if (!res.ok()) throw new Error(`Failed to initialize board ${boardId}: ${res.status()}`);
}

/** Open N isolated browser contexts on the same board and wait for them to sync. */
export async function openParticipants(
  browser: Browser,
  boardId: string,
  count: number,
): Promise<Participant[]> {
  // Initialize the board via test hook so it exists
  const initCtx = await browser.newContext();
  const initPage = await initCtx.newPage();
  await initializeBoard(initPage, boardId);
  await initCtx.close();
  const participants: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    participants.push({ context, page, label: `P${i}` });
  }

  // Wait for all to connect (confirmed state visible, or just stable)
  for (const p of participants) {
    await expect.poll(async () => {
      const state = await p.page.evaluate(() => window.__vidi6?.connectionState);
      return state === undefined || state === 'connected' || state === 'confirmed';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
  }

  return participants;
}

/** Close all participants. */
export async function closeParticipants(participants: Participant[]): Promise<void> {
  for (const p of participants) {
    await p.context.close();
  }
}

/**
 * Wait for a condition to eventually become true across pages.
 * Records and logs the time taken for latency reporting.
 */
export async function expectEventually(
  description: string,
  assertion: () => Promise<void>,
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  const deadline = start + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      const elapsed = Date.now() - start;
      const within = elapsed <= LIVE_UPDATE_LATENCY_BUDGET_MS ? '✓' : '⚠';
      console.log(`[latency] ${within} ${description}: ${elapsed}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const elapsed = Date.now() - start;
  console.log(`[latency] ✗ ${description}: timed out after ${elapsed}ms`);
  if (lastError) throw lastError;
  throw new Error(`Timed out waiting for: ${description}`);
}

/** Read the current notes from a page via test hooks. */
export async function readBoardNotes(page: Page) {
  return page.evaluate(() => window.__vidi6?.getStickyNotes() ?? []);
}

/** Read the connection state from a page via test hooks. */
export async function readConnectionState(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__vidi6?.connectionState);
}

/**
 * Double-click at a world coordinate on a page (creating a sticky note).
 * We use the toolbar button instead since it avoids coordinate math.
 */
export async function createNoteViaToolbar(page: Page): Promise<string> {
  const before = await readBoardNotes(page);
  await page.getByTestId('create-sticky-button').click();
  // Wait for a new note to appear
  await expect.poll(async () => {
    const after = await readBoardNotes(page);
    return after.length > before.length;
  }, { timeout: 5000 }).toBe(true);
  const after = await readBoardNotes(page);
  const newNote = after.find((n) => !before.some((b) => b.id === n.id));
  if (!newNote) throw new Error('Could not find newly created note');
  // Dismiss the editor by pressing Escape
  await page.keyboard.press('Escape');
  return newNote.id;
}

/**
 * Move a note by selecting it then using keyboard or drag.
 * For E2E we read positions and drag via mouse.
 */
export async function moveNoteViaDrag(
  page: Page,
  noteId: string,
  dx: number,
  dy: number,
): Promise<void> {
  const noteEl = page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
  const box = await noteEl.boundingBox();
  if (!box) throw new Error(`Note ${noteId} not found`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
}

/** Type text into the currently selected note's editor. */
export async function typeIntoNote(page: Page, noteId: string, text: string): Promise<void> {
  const noteEl = page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
  await noteEl.click({ clickCount: 2 }); // Double-click to edit
  // Wait for the editor textarea to appear
  const textarea = noteEl.locator('textarea');
  await textarea.waitFor({ state: 'visible' });
  await textarea.fill('');
  await textarea.type(text, { delay: 10 });
  await page.keyboard.press('Escape');
}

/** Delete a note by selecting it and pressing Delete. */
export async function deleteNoteById(page: Page, noteId: string): Promise<void> {
  const noteEl = page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
  await noteEl.click();
  await page.keyboard.press('Delete');
}

/** Wait for the connection status badge to show specific text. */
export async function waitForConnectionBadge(
  page: Page,
  text: string,
  timeout = E2E_EVENTUAL_TIMEOUT_MS,
): Promise<void> {
  const badge = page.getByTestId('connection-status');
  await expect(badge).toBeVisible({ timeout });
  await expect(badge).toContainText(text, { timeout });
}
