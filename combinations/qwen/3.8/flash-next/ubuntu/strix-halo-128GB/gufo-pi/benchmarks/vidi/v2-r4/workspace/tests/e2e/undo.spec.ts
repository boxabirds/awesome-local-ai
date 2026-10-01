/**
 * E2E tests for undo.controls (TC-22, TC-23, TC-24)
 */
import { expect, test, type Page, type Browser, type APIRequestContext } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  notes,
  noteById,
  doubleClickToCreate,
  clickEmptyBoard,
  dragNoteBy,
  typeText,
} from './helpers/sticky';
import { board, setCamera } from './helpers/board';

/** Wait for a page to be connected. */
async function waitForConnected(page: Page): Promise<void> {
  await expect(board(page)).toBeVisible();
  await page.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

/** Create a board via API and return its id. */
async function createBoardApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Open two pages on the same board. */
async function openTwoPages(browser: Browser, request: APIRequestContext) {
  const boardId = await createBoardApi(request);
  const url = `/b/${boardId}`;

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(url);
  await waitForConnected(page1);

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(url);
  await waitForConnected(page2);

  return { ctx1, page1, ctx2, page2, boardId };
}

/** Get the id of a note at a given index. */
async function getNoteId(page: Page, index: number): Promise<string> {
  return notes(page).nth(index).evaluate((el) => (el as HTMLElement).dataset.noteId ?? '');
}

/** Get all note ids on a page. */
async function getAllNoteIds(page: Page): Promise<string[]> {
  return notes(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.noteId ?? ''),
  );
}

/** Wait for N notes to be visible on a page. */
async function waitForNoteCount(page: Page, count: number, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect.poll(async () => notes(page).count(), { timeout }).toBe(count);
}

test.describe('story 8: undo (e2e)', () => {
  test('TC-22: recover an accidental delete while a colleague works', async ({ browser, request }) => {
    const { ctx1, page1: mia, ctx2, page2: raj } = await openTwoPages(browser, request);

    try {
      // Zoom out so notes are small on screen
      // Zoom 0.3, camera (0,0): screen = world * 0.3
      // Notes are 260 world units = 78px screen
      await setCamera(mia, { x: 0, y: 0, zoom: 0.3 });
      await mia.waitForTimeout(100);

      // Create 6 notes in two groups:
      // Group 1 (to delete): in top-left area
      // Group 2 (to keep): in bottom-right area
      const group1 = [
        { x: 150, y: 200 }, { x: 300, y: 200 }, { x: 150, y: 350 }, { x: 300, y: 350 },
      ];
      const group2 = [
        { x: 700, y: 550 }, { x: 850, y: 550 },
      ];

      for (let i = 0; i < group1.length; i++) {
        await doubleClickToCreate(mia, group1[i]!.x, group1[i]!.y);
        await typeText(mia, `del${i}`);
        await clickEmptyBoard(mia, { x: 1000, y: 100 });
        await mia.waitForTimeout(100);
      }
      for (let i = 0; i < group2.length; i++) {
        await doubleClickToCreate(mia, group2[i]!.x, group2[i]!.y);
        await typeText(mia, `keep${i}`);
        await clickEmptyBoard(mia, { x: 1000, y: 100 });
        await mia.waitForTimeout(100);
      }
      await waitForNoteCount(raj, 6);

      // Select group 1 using Ctrl+A then marquee won't help — use Ctrl+A for all
      // and then shift-drag marquee for just the ones to delete
      // Actually use the marquee: shift+drag on empty space around group 1
      await mia.keyboard.down('Shift');
      await mia.mouse.move(50, 120);
      await mia.mouse.down();
      await mia.mouse.move(400, 420, { steps: 10 });
      await mia.mouse.up();
      await mia.keyboard.up('Shift');
      await mia.waitForTimeout(100);

      // Delete selected
      await mia.keyboard.press('Delete');
      await mia.waitForTimeout(500);

      // Verify 2 notes remain (the group2 ones)
      await expect.poll(async () => notes(mia).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(2);
      await expect.poll(async () => notes(raj).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(2);

      // Raj adds a new note
      await setCamera(raj, { x: 0, y: 0, zoom: 0.3 });
      await raj.waitForTimeout(100);
      await doubleClickToCreate(raj, 600, 250);
      await typeText(raj, 'raj-note');
      await clickEmptyBoard(raj, { x: 1000, y: 100 });
      await waitForNoteCount(mia, 3);

      // Mia presses Ctrl+Z to undo the delete
      await mia.keyboard.press('Control+z');
      await mia.waitForTimeout(500);

      // The 4 deleted notes should be back: 2 remaining + 4 restored + 1 raj = 7
      await expect.poll(async () => notes(mia).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(7);
      await expect.poll(async () => notes(raj).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(7);

      // Verify all notes on both pages have the same positions
      const miaState = await notes(mia).evaluateAll((els) =>
        els.map((el) => {
          const h = el as HTMLElement;
          return `${h.dataset.worldX},${h.dataset.worldY}`;
        }).sort(),
      );
      const rajState = await notes(raj).evaluateAll((els) =>
        els.map((el) => {
          const h = el as HTMLElement;
          return `${h.dataset.worldX},${h.dataset.worldY}`;
        }).sort(),
      );
      expect(miaState).toEqual(rajState);

      // Mia clicks Redo → the 4 notes disappear again
      await mia.getByRole('button', { name: 'Redo' }).click();
      await mia.waitForTimeout(500);
      await expect.poll(async () => notes(mia).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      await expect.poll(async () => notes(raj).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('TC-23: colleague deleted my object — undo is safe', async ({ browser, request }) => {
    const { ctx1, page1: mia, ctx2, page2: raj } = await openTwoPages(browser, request);

    try {
      // Mia creates a note
      await setCamera(mia, { x: 0, y: 0, zoom: 1 });
      await mia.waitForTimeout(100);
      await doubleClickToCreate(mia, 400, 400);
      await typeText(mia, 'my-note');
      await clickEmptyBoard(mia, { x: 80, y: 750 });
      await waitForNoteCount(raj, 1);

      const noteId = await getNoteId(mia, 0);

      // Mia moves the note
      const el = noteById(mia, noteId);
      await dragNoteBy(el, { x: 100, y: 100 }, { x: 150, y: 0 });
      await mia.waitForTimeout(300);

      // Raj deletes it
      await setCamera(raj, { x: 0, y: 0, zoom: 1 });
      await raj.waitForTimeout(100);
      const rajEl = noteById(raj, noteId);
      await rajEl.click();
      await raj.waitForTimeout(100);
      await raj.keyboard.press('Delete');
      await raj.waitForTimeout(300);

      // Verify note is gone on both
      await expect.poll(async () => notes(mia).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);

      // Mia presses Ctrl+Z — attempts to undo the move of a deleted object
      const consoleErrors: string[] = [];
      mia.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
      await mia.keyboard.press('Control+z');
      await mia.waitForTimeout(300);

      // No crash, no error; note is still absent
      expect(await notes(mia).count()).toBe(0);
      expect(consoleErrors.filter((e) => !e.includes('favicon'))).toHaveLength(0);

      // Mia's next undo still works (undoes creation or is a no-op)
      await mia.keyboard.press('Control+z');
      await mia.waitForTimeout(200);
      expect(await notes(mia).count()).toBe(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('TC-24: everyone undoing at once (MAX_CONCURRENT_EDITORS)', async ({ browser, request }) => {
    const boardId = await createBoardApi(request);
    const url = `/b/${boardId}`;

    // Create MAX_CONCURRENT_EDITORS pages
    const contexts: { ctx: import('@playwright/test').BrowserContext; page: Page }[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(url);
      await waitForConnected(page);
      contexts.push({ ctx, page });
    }

    try {
      // Pre-create notes from the first context
      // At zoom 0.4, camera at (0,0): screen = world * 0.4
      // Notes (260 units) = 104px on screen; space 250px apart (625 world units)
      const firstPage = contexts[0]!.page;
      await setCamera(firstPage, { x: 0, y: 0, zoom: 0.4 });
      await firstPage.waitForTimeout(100);

      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const sx = 150 + i * 200;
        const sy = 400;
        await doubleClickToCreate(firstPage, sx, sy);
        await typeText(firstPage, `n${i}`);
        await clickEmptyBoard(firstPage, { x: 80, y: 750 });
        await firstPage.waitForTimeout(100);
      }

      // Wait for all contexts to see all notes
      for (const { page } of contexts) {
        await waitForNoteCount(page, MAX_CONCURRENT_EDITORS);
      }
      const noteIds = await getAllNoteIds(firstPage);

      // Each context moves a different note and types in another
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const { page } = contexts[i]!;
        await setCamera(page, { x: 0, y: 0, zoom: 0.4 });
        await page.waitForTimeout(100);

        // Move note i
        const el = noteById(page, noteIds[i]!);
        await dragNoteBy(el, { x: 50, y: 50 }, { x: 30 + i * 5, y: 20 + i * 5 });

        // Type in note (i+1) % MAX
        const targetId = noteIds[(i + 1) % MAX_CONCURRENT_EDITORS]!;
        await noteById(page, targetId).dblclick();
        await page.waitForTimeout(100);
        await typeText(page, String.fromCharCode(65 + i));
        await clickEmptyBoard(page, { x: 80, y: 750 });
        await page.waitForTimeout(50);
      }

      // Wait for all changes to sync
      await firstPage.waitForTimeout(1000);

      // Each context presses Ctrl+Z twice (undo typing, then undo move)
      for (const { page } of contexts) {
        await page.keyboard.press('Control+z');
      }
      await firstPage.waitForTimeout(500);

      for (const { page } of contexts) {
        await page.keyboard.press('Control+z');
      }
      await firstPage.waitForTimeout(1000);

      // Verify all boards have identical state
      const states = await Promise.all(contexts.map(({ page }) =>
        notes(page).evaluateAll((els) =>
          els.map((el) => {
            const h = el as HTMLElement;
            return `${h.dataset.noteId}:${h.dataset.worldX},${h.dataset.worldY}|${h.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? ''}`;
          }).sort().join('#'),
        ),
      ));

      // All boards should be identical
      for (let i = 1; i < states.length; i++) {
        expect(states[i]).toBe(states[0]);
      }
    } finally {
      for (const { ctx } of contexts) {
        await ctx.close();
      }
    }
  });
});
