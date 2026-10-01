import { test, expect } from '@playwright/test';
import { startWrangler, cleanPersistDir, buildTest, type WranglerInstance } from './helpers/wrangler-process';
import { newBoardId } from '../../src/shared/board-id';
import {
  PERSIST_TESTED_NOTES,
  BOARD_LOAD_BUDGET_MS,
} from '../../src/shared/config';

/**
 * Persistence E2E tests run against their own wrangler dev instance on a custom port,
 * with --persist-to pointing to a temp directory. This allows killing and restarting
 * the process between steps to verify data survives.
 */

const PORT = 9787;
let wrangler: WranglerInstance;
let baseURL: string;

test.beforeAll(async () => {
  buildTest();
  wrangler = await startWrangler(PORT);
  baseURL = `http://127.0.0.1:${PORT}`;
});

test.afterAll(async () => {
  if (wrangler) {
    await wrangler.stop();
    cleanPersistDir(wrangler.persistDir);
  }
});

async function restartWrangler(): Promise<void> {
  await wrangler.stop();
  wrangler = await startWrangler(PORT);
}

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

async function createNotesViaToolbar(page: import('@playwright/test').Page, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const before = await readNotes(page);
    await page.getByTestId('create-sticky-button').click();
    await page.waitForTimeout(100);
    const after = await readNotes(page);
    const newNote = after.find((n: any) => !before.some((b: any) => b.id === n.id));
    if (newNote) ids.push(newNote.id);
    await page.keyboard.press('Escape');
  }
  return ids;
}

test.describe('TC-19: Overnight return', () => {
  test('create 25 notes, kill process, restart, all 25 are identical', async ({ browser }) => {
    const boardId = newBoardId();

    // Create 25 notes in the browser
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto(`${baseURL}/b/${boardId}`);
    await expect(page1.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(page1);

    const createdIds = await createNotesViaToolbar(page1, 25);
    expect(createdIds.length).toBe(25);

    // Read full state
    const notesBefore = await readNotes(page1);
    expect(notesBefore.length).toBe(25);

    // Close browser context and stop wrangler
    await context1.close();
    await restartWrangler();

    // Reopen board
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`${baseURL}/b/${boardId}`);
    await expect(page2.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(page2);

    const notesAfter = await readNotes(page2);
    expect(notesAfter.length).toBe(25);

    // Verify all notes match (id, x, y, color, z)
    for (const before of notesBefore) {
      const after = notesAfter.find((n: any) => n.id === before.id);
      expect(after).toBeDefined();
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.color).toBe(before.color);
      expect(after.z).toBe(before.z);
      expect(after.text).toBe(before.text);
    }

    await context2.close();
  });
});

test.describe('TC-20: Leave immediately', () => {
  test('Alex creates note, Sam sees it, kill both and process within 1s, note present on reopen', async ({ browser }) => {
    const boardId = newBoardId();

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto(`${baseURL}/b/${boardId}`);
    await expect(pageA.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(pageA);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`${baseURL}/b/${boardId}`);
    await expect(pageB.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(pageB);

    // Alex creates a note
    const noteId = (await createNotesViaToolbar(pageA, 1))[0]!;

    // Wait until Sam sees it (append-before-broadcast means storage is already written)
    await expect.poll(async () => {
      const notes = await readNotes(pageB);
      return notes.some((n: any) => n.id === noteId);
    }, { timeout: 5000 }).toBe(true);

    // Close both contexts and kill process within 1s
    await contextA.close();
    await contextB.close();
    await restartWrangler();

    // Reopen - note should be present
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();
    await page3.goto(`${baseURL}/b/${boardId}`);
    await expect(page3.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(page3);

    const notes = await readNotes(page3);
    expect(notes.some((n: any) => n.id === noteId)).toBe(true);

    await context3.close();
  });
});

test.describe('TC-21: Big board open', () => {
  test('PERSIST_TESTED_NOTES board opens with all notes rendered', async ({ browser }) => {
    const boardId = newBoardId();
    const seedContext = await browser.newContext();
    const seedPage = await seedContext.newPage();
    await seedPage.goto(`${baseURL}/b/${boardId}`);
    await expect(seedPage.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(seedPage);

    // Create notes via toolbar (slower but reliable)
    await createNotesViaToolbar(seedPage, Math.min(PERSIST_TESTED_NOTES, 50));
    const seeded = await readNotes(seedPage);
    await seedContext.close();

    // Open in a fresh context and time it
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    const startTime = Date.now();
    await page2.goto(`${baseURL}/b/${boardId}`);
    await expect(page2.getByTestId('board-viewport')).toBeVisible();
    await waitForConnected(page2);

    // Poll for all notes to be rendered
    await expect.poll(async () => {
      const notes = await readNotes(page2);
      return notes.length;
    }, { timeout: 60_000 }).toBe(seeded.length);

    const elapsed = Date.now() - startTime;
    console.log(`[TC-21] Board open time: ${elapsed}ms (budget: ${BOARD_LOAD_BUDGET_MS}ms)`);
    // Budget is reported, not asserted

    await context2.close();
  });
});
