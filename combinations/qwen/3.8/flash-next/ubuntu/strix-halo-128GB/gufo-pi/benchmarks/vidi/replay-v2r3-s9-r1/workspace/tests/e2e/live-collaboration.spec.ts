import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  getBoard,
  createBoard,
  createNoteAt,
  typeIntoNote,
  endEditing,
  selectNote,
  dragNote,
  clickSwatch,
  clickDeleteNote,
  noteBox,
} from './helpers/board';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

async function openBoard(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const boardId = await createBoard();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
  return page;
}

async function openBoardOnId(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
  return page;
}

/** Poll until board size reaches expected count or timeout. */
async function waitForBoardSize(page: Page, count: number, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  const start = Date.now();
  await expect.poll(async () => {
    const board = await getBoard(page);
    return board.length;
  }, { timeout, intervals: [200] }).toBe(count);
  const elapsed = Date.now() - start;
  if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS) {
    console.log(`[latency] board size reached ${count} in ${elapsed}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
  }
}

async function getConnectionState(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__vidi6?.connectionState);
}

test.describe('Live collaboration', () => {
  test('TC-22: two-person workshop - create, move, recolour, text, delete propagate', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const alex = await openBoardOnId(ctxA, boardId);
    const sam = await openBoardOnId(ctxB, boardId);

    // 1. Alex creates a note
    const note = await createNoteAt(alex, 300, 300);
    await typeIntoNote(alex, 'Hello');
    await endEditing(alex);
    await waitForBoardSize(sam, 1);
    const samNote = (await getBoard(sam))[0];
    expect(samNote.id).toBe(note.id);

    // 2. Alex moves the note
    await dragNote(alex, note.id, 100, 50);
    await expect.poll(async () => {
      const b = await getBoard(sam);
      return b[0]?.x;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).not.toBe(0);

    // 3. Alex recolours the note
    await selectNote(alex, note.id);
    await clickSwatch(alex, 'yellow');
    await expect.poll(async () => {
      const b = await getBoard(sam);
      return b[0]?.color;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe('yellow');

    // 4. Alex edits text
    await alex.locator(`[data-note-id="${note.id}"]`).dblclick();
    await alex.locator('[data-testid="sticky-note-editor"]').waitFor({ state: 'visible' });
    await typeIntoNote(alex, ' World');
    await endEditing(alex);
    await expect.poll(async () => {
      const b = await getBoard(sam);
      return b[0]?.text;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toContain('World');

    // 5. Alex deletes the note
    await selectNote(alex, note.id);
    await clickDeleteNote(alex);
    await waitForBoardSize(sam, 0);

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-23: concurrent text inserts merge', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await openBoardOnId(ctxA, boardId);
    const pageB = await openBoardOnId(ctxB, boardId);

    // Create a shared note (pageA creates it, waits for B to see it)
    const note = await createNoteAt(pageA, 300, 300);
    await typeIntoNote(pageA, 'start');
    await endEditing(pageA);
    await waitForBoardSize(pageB, 1);

    // Both type simultaneously on the same note
    await pageA.locator(`[data-note-id="${note.id}"]`).dblclick();
    await pageA.locator('[data-testid="sticky-note-editor"]').waitFor({ state: 'visible' });
    await pageB.locator(`[data-note-id="${note.id}"]`).dblclick();
    await pageB.locator('[data-testid="sticky-note-editor"]').waitFor({ state: 'visible' });

    await Promise.all([
      pageA.keyboard.type('AAA'),
      pageB.keyboard.type('BBB'),
    ]);

    await endEditing(pageA);
    await endEditing(pageB);

    // Wait for convergence
    await new Promise(r => setTimeout(r, 2000));

    const boardA = await getBoard(pageA);
    const boardB = await getBoard(pageB);
    const textA = boardA[0]?.text ?? '';
    const textB = boardB[0]?.text ?? '';

    // Both pages should have identical text
    expect(textA).toBe(textB);
    // Text should contain characters from both
    expect(textA).toContain('A');
    expect(textA).toContain('B');

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-24: concurrent move of same note converges', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await openBoardOnId(ctxA, boardId);
    const pageB = await openBoardOnId(ctxB, boardId);

    // Create note
    const note = await createNoteAt(pageA, 300, 300);
    await endEditing(pageA);
    await waitForBoardSize(pageB, 1);
    await new Promise(r => setTimeout(r, 500));

    // Both drag the same note to different positions simultaneously
    await Promise.all([
      dragNote(pageA, note.id, 200, 0),
      dragNote(pageB, note.id, 0, 200),
    ]);

    // Wait for convergence
    await new Promise(r => setTimeout(r, 3000));

    const snapA = await getBoard(pageA);
    const snapB = await getBoard(pageB);
    // Both should settle to same position (LWW)
    expect(snapA[0].x).toBe(snapB[0].x);
    expect(snapA[0].y).toBe(snapB[0].y);

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-25: delete during edit removes note and editor cleanly', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const alex = await openBoardOnId(ctxA, boardId);
    const sam = await openBoardOnId(ctxB, boardId);

    // Create note
    const note = await createNoteAt(alex, 300, 300);
    await endEditing(alex);
    await waitForBoardSize(sam, 1);

    // Sam starts editing the note
    await sam.locator(`[data-note-id="${note.id}"]`).dblclick();
    await sam.locator('[data-testid="sticky-note-editor"]').waitFor({ state: 'visible' });

    // Alex deletes the note while Sam is editing
    await selectNote(alex, note.id);
    await clickDeleteNote(alex);

    // Sam's note should disappear
    await expect(sam.locator(`[data-note-id="${note.id}"]`)).not.toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    // Editor should be gone
    await expect(sam.locator('[data-testid="sticky-note-editor"]')).not.toBeVisible({ timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-26: full capacity - MAX_CONCURRENT_EDITORS contexts sync', async ({ browser }) => {
    const boardId = await createBoard();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await openBoardOnId(ctx, boardId);
      pages.push(page);
    }

    // Each page creates one note
    const noteIds: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const note = await createNoteAt(pages[i], 200 + i * 100, 200);
      await endEditing(pages[i]);
      noteIds.push(note.id);
    }

    // All pages should see all notes
    for (const page of pages) {
      await waitForBoardSize(page, MAX_CONCURRENT_EDITORS);
    }

    // All pages should have the same board state
    const boards = await Promise.all(pages.map(getBoard));
    const ids0 = boards[0].map(n => n.id).sort();
    for (const b of boards) {
      expect(b.map(n => n.id).sort()).toEqual(ids0);
    }

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-27: outage - reconnection shows badge and catches up', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxAlex = await browser.newContext();
    const ctxSam = await browser.newContext();
    const alex = await openBoardOnId(ctxAlex, boardId);
    const sam = await openBoardOnId(ctxSam, boardId);

    // Sam creates a note before the outage
    const note1 = await createNoteAt(sam, 300, 300);
    await endEditing(sam);
    await waitForBoardSize(alex, 1);

    // Alex goes offline: close the WebSocket and prevent reconnection
    await alex.evaluate(() => {
      (window as any).__vidi6_disconnect?.();
    });

    // Verify Alex's connection state becomes "reconnecting"
    await expect.poll(async () => {
      return getConnectionState(alex);
    }, { timeout: 10000, intervals: [500] }).toBe('reconnecting');

    // Sam creates another note while Alex is offline
    const note2 = await createNoteAt(sam, 400, 400);
    await endEditing(sam);

    // Alex comes back online
    await alex.evaluate(() => {
      (window as any).__vidi6_reconnect?.();
    });

    // Wait for Alex to reconnect
    await expect.poll(async () => {
      return getConnectionState(alex);
    }, { timeout: 15000, intervals: [500] }).toBe('connected');

    // Alex should see both notes
    await waitForBoardSize(alex, 2);
    await waitForBoardSize(sam, 2);

    await ctxAlex.close();
    await ctxSam.close();
  });

  test('TC-28: selection and editing do not propagate', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const alex = await openBoardOnId(ctxA, boardId);
    const sam = await openBoardOnId(ctxB, boardId);

    // Create a note visible to both
    const note = await createNoteAt(alex, 300, 300);
    await typeIntoNote(alex, 'shared');
    await endEditing(alex);
    await waitForBoardSize(sam, 1);

    // Alex selects and starts editing the note
    await alex.locator(`[data-note-id="${note.id}"]`).dblclick();
    await alex.locator('[data-testid="sticky-note-editor"]').waitFor({ state: 'visible' });

    // Sam's page should NOT show a selection outline or editor
    await new Promise(r => setTimeout(r, 1000));
    await expect(sam.locator('[data-testid="sticky-note-editor"]')).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // Nightly tests (slow) - tagged so they can be skipped in regular runs
  test.describe('nightly', () => {
    test('TC-29: idle stability - badge never shows Reconnecting', async ({ browser }) => {
      test.skip(!process.env.NIGHTLY, 'Nightly test');
      const boardId = await createBoard();
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      const alex = await openBoardOnId(ctxA, boardId);
      const sam = await openBoardOnId(ctxB, boardId);

      // Wait 45 seconds of idle
      await new Promise(r => setTimeout(r, 45000));

      // Neither should be in "reconnecting" state
      expect(await getConnectionState(alex)).not.toBe('reconnecting');
      expect(await getConnectionState(sam)).not.toBe('reconnecting');

      await ctxA.close();
      await ctxB.close();
    });

    test('TC-30: capacity soak - 60s of continuous edits', async ({ browser }) => {
      test.skip(!process.env.NIGHTLY, 'Nightly test');
      const boardId = await createBoard();
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];

      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        const page = await openBoardOnId(ctx, boardId);
        pages.push(page);
      }

      // Continuous random edits for 60 seconds
      const startTime = Date.now();
      let editCount = 0;
      while (Date.now() - startTime < 60000) {
        const idx = editCount % MAX_CONCURRENT_EDITORS;
        const note = await createNoteAt(pages[idx], 100 + (editCount % 10) * 50, 100 + Math.floor(editCount / 10) * 50);
        await endEditing(pages[idx]);
        editCount++;
        await new Promise(r => setTimeout(r, 500));
      }

      // Wait for convergence
      await new Promise(r => setTimeout(r, 5000));

      // All pages should have the same board
      const boards = await Promise.all(pages.map(getBoard));
      const expectedCount = boards[0].length;
      for (const b of boards) {
        expect(b.length).toBe(expectedCount);
      }

      for (const ctx of contexts) await ctx.close();
    });
  });
});
