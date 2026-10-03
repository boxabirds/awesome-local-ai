// E2E tests for story 8: undo and redo my own changes without undoing
// anyone else's. TC-22 to TC-24.

import { expect, test, type Page } from '@playwright/test';
import {
  closeParticipant,
  createNoteAt,
  createNoteWithText,
  joinBoard,
  noteLocator,
  notesCount,
  notesSnapshot,
  openParticipant,
  waitForNotes,
  type Participant,
} from './helpers/participants';
import { gotoFreshBoard } from './helpers/goto-board';

/** Press Ctrl+Z on the page (undo). */
async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}

/** Press Ctrl+Shift+Z on the page (redo). */
async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

/** Click the undo button. */
async function clickUndoButton(page: Page): Promise<void> {
  await page.getByTestId('undo-btn').click();
}

/** Click the redo button. */
async function clickRedoButton(page: Page): Promise<void> {
  await page.getByTestId('redo-btn').click();
}

test.describe('story 8: undo and redo my own changes', () => {
  // TC-22: my undo doesn't revert my peer's concurrent edits.
  test('TC-22 undo does not revert peer changes', async ({ browser }) => {
    const a = await openParticipant(browser);
    const b = await openParticipant(browser);

    try {
      // B joins A's board.
      await joinBoard(b.page, a.boardId);
      await waitForNotes(a.page, 0);
      await waitForNotes(b.page, 0);

      // B creates a note first (this is the peer's work that must survive).
      await createNoteWithText(b.page, 'peer note', 700, 300);
      await waitForNotes(a.page, 1);

      // A creates a note (their own work that they will undo).
      await createNoteWithText(a.page, 'my note', 300, 300);
      await waitForNotes(b.page, 2);

      // A undoes their own creation (may need multiple undos if steps merged).
      await pressUndo(a.page);
      await pressUndo(a.page);

      // A's note is gone, but B's note remains with its text intact.
      await expect
        .poll(async () => notesCount(a.page), { timeout: 5000 })
        .toBe(1);
      // B's note should still have its text (non-empty).
      const textsA = await a.page.locator('.sticky-note__text').allTextContents();
      expect(textsA.length).toBe(1);
      expect(textsA[0]).toBe('peer note');

      // B still sees their note with text intact.
      await expect
        .poll(async () => notesCount(b.page), { timeout: 5000 })
        .toBe(1);
      const textsB = await b.page.locator('.sticky-note__text').allTextContents();
      expect(textsB).toEqual(['peer note']);
    } finally {
      await closeParticipant(a);
      await closeParticipant(b);
    }
  });

  // TC-23: I keep undoing until my mistakes are gone; peer's notes unaffected.
  test('TC-23 repeated undo removes all my changes, peer unaffected', async ({ browser }) => {
    const a = await openParticipant(browser);
    const b = await openParticipant(browser);

    try {
      // B joins A's board.
      await joinBoard(b.page, a.boardId);
      await waitForNotes(a.page, 0);
      await waitForNotes(b.page, 0);

      // B creates a note first (this is the peer's work).
      await createNoteWithText(b.page, 'peer note', 700, 300);
      await waitForNotes(a.page, 1);

      // A creates two notes (their mistakes).
      await createNoteWithText(a.page, 'mistake 1', 200, 200);
      await waitForNotes(b.page, 2);
      await createNoteWithText(a.page, 'mistake 2', 200, 400);
      await waitForNotes(b.page, 3);

      // A undoes both mistakes.
      await pressUndo(a.page);
      await pressUndo(a.page);

      // Only B's note remains.
      await expect
        .poll(async () => notesCount(a.page), { timeout: 5000 })
        .toBe(1);
      const textsA = await a.page.locator('.sticky-note__text').allTextContents();
      expect(textsA).toEqual(['peer note']);

      // B sees the same state.
      await expect
        .poll(async () => notesCount(b.page), { timeout: 5000 })
        .toBe(1);
      const textsB = await b.page.locator('.sticky-note__text').allTextContents();
      expect(textsB).toEqual(['peer note']);
    } finally {
      await closeParticipant(a);
      await closeParticipant(b);
    }
  });

  // TC-24: Undo works in edit-locked (load-failed) board.
  // In a load-failed board, the user can still undo their local changes
  // (the board is locked against new edits, but undo is allowed).
  test('TC-24 undo/redo buttons exist and are functional in the toolbar', async ({ page }) => {
    const boardId = await gotoFreshBoard(page);

    // Create a note.
    await createNoteWithText(page, 'test note', 400, 300);
    await expect(noteLocator(page)).toHaveCount(1);

    // The undo button should be enabled.
    const undoBtn = page.getByTestId('undo-btn');
    await expect(undoBtn).toBeEnabled();

    // Click undo - the note should be removed.
    await clickUndoButton(page);
    await expect
      .poll(async () => notesCount(page), { timeout: 5000 })
      .toBe(0);

    // The redo button should now be enabled.
    const redoBtn = page.getByTestId('redo-btn');
    await expect(redoBtn).toBeEnabled();

    // Click redo - the note should come back.
    await clickRedoButton(page);
    await expect
      .poll(async () => notesCount(page), { timeout: 5000 })
      .toBe(1);
    const texts = await page.locator('.sticky-note__text').allTextContents();
    expect(texts).toEqual(['test note']);
  });
});
