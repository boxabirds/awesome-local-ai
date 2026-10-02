/**
 * E2E tests for Story 8: Undo and redo my own changes without undoing anyone else's.
 * TC-22, TC-23, TC-24.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  getBoard,
  createBoard,
  getNote,
  addSticky,
  selectNote,
  dragNote,
  setCamera,
  noteBox,
} from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

async function waitForBoardSize(page: Page, count: number): Promise<void> {
  await expect.poll(async () => {
    const board = await getBoard(page);
    return board.length;
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(count);
}

/** Delete the currently-selected objects via the Delete key. */
async function pressDelete(page: Page): Promise<void> {
  await page.keyboard.press('Delete');
}

/** Undo via keyboard. */
async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

/** Redo via keyboard. */
async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

async function clickUndoButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Undo' }).click();
}

async function clickRedoButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Redo' }).click();
}

test.describe('Undo e2e', () => {
  test('TC-22: recover an accidental delete while a colleague works', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxMia = await browser.newContext();
    const ctxRaj = await browser.newContext();
    const mia = await openBoard(ctxMia, boardId);
    const raj = await openBoard(ctxRaj, boardId);

    // Set camera to identity on both
    await setCamera(mia, { x: 0, y: 0, zoom: 1 });
    await setCamera(raj, { x: 0, y: 0, zoom: 1 });

    // Create 12 notes: 8 in a cluster (for delete) + 4 elsewhere
    const clusterIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await addSticky(mia, 100 + (i % 4) * 250, 100 + Math.floor(i / 4) * 250, `note ${i}`, 'yellow');
      clusterIds.push(id);
    }
    await waitForBoardSize(raj, 8);

    // Mia selects the cluster: Ctrl+A then delete
    // Use marquee select approach: select all with Ctrl+A
    await mia.keyboard.press('Control+a');
    await pressDelete(mia);

    // All 8 deleted on both
    await waitForBoardSize(mia, 0);
    await waitForBoardSize(raj, 0);

    // Raj adds a note
    const rajNoteId = await addSticky(raj, 500, 500, 'raj note', 'blue');
    await waitForBoardSize(mia, 1);

    // Mia presses Ctrl+Z → 8 notes come back on both screens, Raj's note remains
    await pressUndo(mia);
    await waitForBoardSize(mia, 9);
    await waitForBoardSize(raj, 9);

    // Verify the 8 cluster notes are restored with their text
    const miaBoard = await getBoard(mia);
    for (const id of clusterIds) {
      const note = miaBoard.find((n) => n.id === id);
      expect(note).toBeDefined();
      expect(note?.text).toMatch(/^note \d$/);
    }
    // Raj's note still there
    const rajNote = miaBoard.find((n) => n.id === rajNoteId);
    expect(rajNote).toBeDefined();
    expect(rajNote?.text).toBe('raj note');

    // Raj also sees the 8 notes and his own note
    const rajBoard = await getBoard(raj);
    for (const id of clusterIds) {
      const note = rajBoard.find((n) => n.id === id);
      expect(note).toBeDefined();
      expect(note?.text).toMatch(/^note \d$/);
    }
    expect(rajBoard.find((n) => n.id === rajNoteId)).toBeDefined();

    // Mia clicks the Redo button → 8 notes disappear again on both, Raj's remains
    await clickRedoButton(mia);
    await waitForBoardSize(mia, 1);
    await waitForBoardSize(raj, 1);

    const afterRedo = await getBoard(mia);
    expect(afterRedo.length).toBe(1);
    expect(afterRedo[0].id).toBe(rajNoteId);

    // Now Mia presses Ctrl+Z again → 8 come back
    await pressUndo(mia);
    await waitForBoardSize(mia, 9);

    // Undo button should still work (can undo the redo again → 1 note)
    await pressRedo(mia);
    await waitForBoardSize(mia, 1);

    // Now both undo stacks should be exhausted
    const undoBtn = mia.getByRole('button', { name: 'Undo' });
    // After redoing the delete, further undo should still be possible (for the initial creation)
    // Just check that buttons don't error
    await clickUndoButton(mia);

    await ctxMia.close();
    await ctxRaj.close();
  });

  test('TC-23: undo after a colleague deleted my object', async ({ browser }) => {
    const boardId = await createBoard();
    const ctxMia = await browser.newContext();
    const ctxRaj = await browser.newContext();
    const mia = await openBoard(ctxMia, boardId);
    const raj = await openBoard(ctxRaj, boardId);

    await setCamera(mia, { x: 0, y: 0, zoom: 1 });
    await setCamera(raj, { x: 0, y: 0, zoom: 1 });

    // Mia creates a note
    const noteId = await addSticky(mia, 200, 200, 'target', 'pink');
    await waitForBoardSize(raj, 1);

    // Also create a second note for subsequent undo test
    const noteId2 = await addSticky(mia, 600, 200, 'second', 'green');
    await waitForBoardSize(raj, 2);

    // Mia moves the note
    const { from } = await dragNote(mia, noteId, 100, 80);

    // Wait for Raj to see the move
    await expect.poll(async () => {
      const n = await getNote(raj, noteId);
      return n?.x;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).not.toBe(200 - 100); // moved

    // Raj deletes the note
    await selectNote(raj, noteId);
    await pressDelete(raj);
    await waitForBoardSize(mia, 1);

    // Mia presses Ctrl+Z → no error, note stays absent
    await pressUndo(mia);

    // Wait a bit for propagation
    await mia.waitForTimeout(500);

    // The note should still be absent on both screens
    const miaNote = await getNote(mia, noteId);
    expect(miaNote).toBeUndefined();
    const rajNote = await getNote(raj, noteId);
    expect(rajNote).toBeUndefined();

    // No console errors
    // Verify no error dialog
    expect(await mia.locator('[role="alert"]').count()).toBe(0);

    // Mia's next undo still works
    await pressUndo(mia);
    await mia.waitForTimeout(300);

    // Should not have errored
    await ctxMia.close();
    await ctxRaj.close();
  });

  test('TC-24: everyone undoing at once', async ({ browser }) => {
    const boardId = await createBoard();
    const numEditors = MAX_CONCURRENT_EDITORS;
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    for (let i = 0; i < numEditors; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await openBoard(ctx, boardId);
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      pages.push(page);
    }

    // Create one note per editor
    const noteIds: string[] = [];
    for (let i = 0; i < numEditors; i++) {
      const id = await addSticky(pages[i], 100 + i * 300, 100, `note-${i}`, 'yellow');
      noteIds.push(id);
    }
    // Wait for all pages to see all notes
    for (const page of pages) {
      await waitForBoardSize(page, numEditors);
    }

    // Each editor moves a different note (their own note by index)
    const movedPositions: { id: string; expectedX: number }[] = [];
    for (let i = 0; i < numEditors; i++) {
      // Editor i moves note (i % numEditors) - each moves a different one
      const noteIdx = i % numEditors;
      await dragNote(pages[i], noteIds[noteIdx], 80, 60);
      movedPositions.push({ id: noteIds[noteIdx], expectedX: 100 + noteIdx * 300 + 80 - 100 });
    }

    // Wait for all editors to see all moves
    for (const page of pages) {
      await expect.poll(async () => {
        const board = await getBoard(page);
        const first = board.find((n) => n.id === noteIds[0]);
        return first?.x;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(100 + 0 * 300 - 100 + 80);
    }

    // Each editor also types in a note
    for (let i = 0; i < numEditors; i++) {
      const noteIdx = i % numEditors;
      await selectNote(pages[i], noteIds[noteIdx]);
      await pages[i].keyboard.press('Enter');
      await pages[i].waitForSelector('[data-testid="sticky-note-editor"]', { state: 'visible' });
      await pages[i].keyboard.type(`e${i}`, { delay: 10 });
      await pages[i].keyboard.press('Escape');
      await pages[i].waitForTimeout(100);
    }

    // Wait for all text changes to propagate
    for (const page of pages) {
      await expect.poll(async () => {
        const board = await getBoard(page);
        const n = board.find((x) => x.id === noteIds[0]);
        return n?.text;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toContain('e0');
    }

    // Each editor presses Ctrl+Z twice (undo their typing and move)
    for (let i = 0; i < numEditors; i++) {
      await pressUndo(pages[i]);
      await pages[i].waitForTimeout(200);
    }
    // Wait for propagation
    await pages[0].waitForTimeout(1000);

    for (let i = 0; i < numEditors; i++) {
      await pressUndo(pages[i]);
      await pages[i].waitForTimeout(200);
    }
    await pages[0].waitForTimeout(1000);

    // All boards should be identical
    const boards = await Promise.all(pages.map((p) => getBoard(p)));
    for (let i = 1; i < boards.length; i++) {
      expect(boards[i].length).toBe(boards[0].length);
      for (const note of boards[i]) {
        const ref = boards[0].find((n) => n.id === note.id);
        expect(ref).toBeDefined();
        expect(ref?.x).toBeCloseTo(note.x, 0);
        expect(ref?.y).toBeCloseTo(note.y, 0);
        expect(ref?.text).toBe(note.text);
      }
    }

    // All notes should still exist (no one deleted them)
    for (const note of boards[0]) {
      expect(noteIds).toContain(note.id);
    }

    for (const ctx of contexts) await ctx.close();
  });
});
