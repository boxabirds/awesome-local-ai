import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

/**
 * TC-24: E2E broken board - honest failure, edit lock, recovery without reload.
 *
 * 1. Create a 25-note board, compact it, call corrupt hook.
 * 2. Open board in fresh context → red "This board couldn't be loaded. Retrying…";
 *    dblclick and Sticky note button create nothing.
 * 3. Call repair hook; wait > LOAD_RETRY_MIN_INTERVAL_MS → board appears with 25 notes,
 *    badge gone, creating a note works — no page reload.
 */

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? '8787'}`;

async function waitForConnected(page: import('@playwright/test').Page, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => (window as any).__vidi6?.connectionState);
    if (state === 'connected' || state === 'confirmed') return;
    await page.waitForTimeout(200);
  }
  throw new Error('Timed out waiting for connection');
}

async function readNotes(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).__vidi6?.getStickyNotes() ?? []);
}

async function createNoteViaToolbar(page: import('@playwright/test').Page): Promise<string | null> {
  const before = await readNotes(page);
  await page.getByTestId('create-sticky-button').click({ trial: false });
  await page.waitForTimeout(300);
  const after = await readNotes(page);
  const newNote = after.find((n: any) => !before.some((b: any) => b.id === n.id));
  if (newNote) {
    await page.keyboard.press('Escape');
    return newNote.id;
  }
  return null;
}

async function corruptBoard(boardId: string): Promise<void> {
  const res = await fetch(`${BASE}/__test/boards/${boardId}/corrupt-snapshot`, { method: 'POST' });
  const body = await res.json();
  if (!body.ok) throw new Error(`corrupt-snapshot failed: ${JSON.stringify(body)}`);
}

async function repairBoard(boardId: string): Promise<void> {
  const res = await fetch(`${BASE}/__test/boards/${boardId}/repair`, { method: 'POST' });
  const body = await res.json();
  if (!body.ok) throw new Error(`repair failed: ${JSON.stringify(body)}`);
}

test.describe('TC-24: Broken board', () => {
  test('honest failure, edit lock, recovery without reload', async ({ browser }) => {
    const boardId = newBoardId();

    // Step 1: Create 25 notes, trigger compaction
    const seedContext = await browser.newContext();
    const seedPage = await seedContext.newPage();
    await seedPage.goto(`${BASE}/b/${boardId}`);
    await expect(seedPage.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(seedPage);

    for (let i = 0; i < 25; i++) {
      await createNoteViaToolbar(seedPage);
    }
    const notesBefore = await readNotes(seedPage);
    expect(notesBefore.length).toBe(25);

    // Close the board context to allow compaction
    await seedContext.close();

    // Wait a moment for any final persistence
    await new Promise(r => setTimeout(r, 1000));

    // Corrupt the snapshot
    await corruptBoard(boardId);

    // Step 2: Open board in fresh context → should show error state
    const brokenContext = await browser.newContext();
    const brokenPage = await brokenContext.newPage();
    await brokenPage.goto(`${BASE}/b/${boardId}`);
    await expect(brokenPage.getByTestId('board-viewport')).toBeVisible();

    // Wait for load_failed state
    await expect.poll(async () => {
      const state = await brokenPage.evaluate(() => (window as any).__vidi6?.connectionState);
      return state;
    }, { timeout: 10_000 }).toBe('load_failed');

    // Verify red badge message
    const badge = brokenPage.getByTestId('connection-status');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("This board couldn't be loaded. Retrying…");

    // Verify editing is blocked: double-click creates nothing
    const beforeAttempt = await readNotes(brokenPage);
    await brokenPage.mouse.dblclick(640, 400);
    await brokenPage.waitForTimeout(500);
    const afterDblClick = await readNotes(brokenPage);
    expect(afterDblClick.length).toBe(beforeAttempt.length); // No new note

    // Verify Sticky note button creates nothing
    const createBtn = brokenPage.getByTestId('create-sticky-button');
    // Even if not disabled, clicking should not create a note
    const beforeClick = await readNotes(brokenPage);
    await createBtn.click({ force: true });
    await brokenPage.waitForTimeout(500);
    const afterClick = await readNotes(brokenPage);
    expect(afterClick.length).toBe(beforeClick.length); // No new note

    // Step 3: Repair, wait for retry interval, board recovers without page reload
    await repairBoard(boardId);

    // Wait > LOAD_RETRY_MIN_INTERVAL_MS for the provider to retry
    await brokenPage.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 2000);

    // The board should recover (provider reconnects and load succeeds)
    await expect.poll(async () => {
      const state = await brokenPage.evaluate(() => (window as any).__vidi6?.connectionState);
      return state;
    }, { timeout: 30_000 }).toBe('connected');

    // Badge should be gone
    await expect(brokenPage.getByTestId('connection-status')).not.toBeVisible();

    // Notes are present
    const notesAfter = await readNotes(brokenPage);
    expect(notesAfter.length).toBe(25);

    // Creating a note works again
    const newId = await createNoteViaToolbar(brokenPage);
    expect(newId).not.toBeNull();

    await brokenContext.close();
  });
});
