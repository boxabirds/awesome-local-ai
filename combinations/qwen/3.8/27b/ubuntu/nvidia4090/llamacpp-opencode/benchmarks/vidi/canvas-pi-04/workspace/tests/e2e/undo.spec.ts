// Story 8, e2e (TC-22 .. TC-24): per-client undo/redo over the live
// protocol — delete-eight restore, a peer-deleted note that never
// resurrects, and five concurrent editors each undoing only their own
// typing (undo.delete8, undo.peer_deleted, undo.multi, editor.budget).
// Runs against `wrangler dev` (chromium required).

import { expect, test, type Page } from '@playwright/test';
import {
  newBoard,
  openParticipant,
  closeParticipant,
  expectWithin,
  type Participant,
} from './participants';
import {
  seedNotes,
  parkCamera,
  expectNoteCount,
  noteWorld,
  noteId,
  dragNote,
} from './helpers/story7';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

// Camera with the origin at the viewport origin (1:1 world/screen).
const ZOOM1 = { x: 0, y: 0, zoom: 1 };

const UNDO_BTN = 'button[aria-label="Undo"]';
const REDO_BTN = 'button[aria-label="Redo"]';
const DELETE_SELECTION = 'button[aria-label="Delete selection"]';

/** Collect uncaught page errors and console.error entries from `page`. */
function captureErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe('story 8 e2e (TC-22..TC-24)', () => {
  test('TC-22: delete eight -> undo restores, redo re-deletes, buttons track the stacks', async ({ page, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    await seedNotes(baseURL!, boardId, 8);
    await page.goto(`/b/${boardId}`);
    await expectNoteCount(page, 8);
    await parkCamera(page, ZOOM1);

    const undoBtn = page.locator(UNDO_BTN);
    const redoBtn = page.locator(REDO_BTN);

    // No local history yet: both buttons disabled (the seed is not mine).
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Delete all eight (select all, then the selection bar's delete).
    await page.keyboard.press('Control+a');
    expect(await page.locator('.sticky-note[data-selected]').count()).toBe(8);
    await page.locator(DELETE_SELECTION).click();
    await expect(page.locator('.sticky-note')).toHaveCount(0);
    await expect(undoBtn).toBeEnabled();

    // Undo restores every note; the redo stack now holds the delete.
    await undoBtn.click();
    await expectNoteCount(page, 8);
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeEnabled();

    // Redo deletes them again.
    await redoBtn.click();
    await expect(page.locator('.sticky-note')).toHaveCount(0);
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();

    // Undo once more, via the shortcut this round.
    await page.keyboard.press('Control+z');
    await expectNoteCount(page, 8);
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeEnabled();

    // A new local change clears the redo stack.
    await page.locator('button[aria-label="Sticky note"]').click();
    await expectNoteCount(page, 9);
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();
  });

  test('TC-23: undoing my own move never resurrects a peer-deleted note and never throws', async ({ browser, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    const lee = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await seedNotes(baseURL!, boardId, 4);
      for (const p of [lee, sam]) {
        await p.page.goto(`/b/${boardId}`);
        await expectNoteCount(p.page, 4);
        await parkCamera(p.page, ZOOM1);
      }
      const errors = captureErrors(lee.page);

      // Lee drags note 0 by (+100, 0): his only local step.
      const id0 = (await noteId(lee.page, 0)) as string;
      const start = await noteWorld(lee.page, id0);
      await dragNote(lee.page, id0, 100, 0, ZOOM1.zoom);
      const moved = await noteWorld(lee.page, id0);
      expect(moved.x).toBeGreaterThan(start.x + 90);

      // Sam deletes note 2.
      const id2 = (await noteId(sam.page, 2)) as string;
      await sam.page.locator(`.sticky-note[data-note-id="${id2}"]`).click();
      await sam.page.keyboard.press('Delete');

      // Lee sees the deletion live (three notes remain).
      await expectWithin(() => lee.page.locator('.sticky-note').count(), 3, 8000);

      // Lee undoes his own move: note 0 returns to its start position...
      await lee.page.keyboard.press('Control+z');
      const undone = await noteWorld(lee.page, id0);
      expect(undone.x).toBeCloseTo(start.x, -1);
      expect(undone.y).toBeCloseTo(start.y, -1);
      // ...and note 2 stays deleted on BOTH clients (no resurrection).
      await expect(lee.page.locator('.sticky-note')).toHaveCount(3);
      await expect(sam.page.locator('.sticky-note')).toHaveCount(3);
      expect(
        await sam.page.locator(`.sticky-note[data-note-id="${id2}"]`).count(),
      ).toBe(0);

      // Server truth: four seeded, one deleted -> three durable.
      const res = await fetch(`${baseURL}/__test/boards/${boardId}/notes`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok: boolean; notes: number };
      expect(data.ok).toBe(true);
      expect(data.notes).toBe(3);

      // No errors on Lee's client (the dead-step skip is silent).
      expect(errors).toEqual([]);
    } finally {
      await closeParticipant(lee);
      await closeParticipant(sam);
    }
  });

  test('TC-24: five concurrent editors each undo only their own typing', async ({ browser, baseURL }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const boardId = await newBoard(baseURL!);
    const participants: Participant[] = [];
    try {
      for (let c = 0; c < n; c++) {
        participants.push(await openParticipant(browser, boardId));
      }
      await seedNotes(baseURL!, boardId, n);
      for (const p of participants) {
        await p.page.goto(`/b/${boardId}`);
        await expectNoteCount(p.page, n);
        await parkCamera(p.page, ZOOM1);
      }

      // All five editors are live at once (editor.budget): editor c opens
      // note c's editor, types a unique burst, then undoes it INSIDE the
      // editor (Ctrl+Z is handled by the editor, not the native textarea).
      for (let c = 0; c < n; c++) {
        const page = participants[c].page;
        const id = (await noteId(page, c)) as string;
        await page.locator(`.sticky-note[data-note-id="${id}"]`).dblclick();
        const ta = page.locator('.sticky-note__textarea');
        await expect(ta).toBeVisible();
        await ta.fill(`editor${c}-burst`);
        expect(await ta.inputValue()).toBe(`editor${c}-burst`);

        // Ctrl+Z inside the editor undoes the typing burst...
        await page.keyboard.press('Control+z');
        await expect(ta).toHaveValue('');
        // ...and closes the editor.
        await page.keyboard.press('Escape');
      }

      // Every client converges to the same truth: all texts empty (each
      // editor undid only its own typing)...
      await expectWithin(
        async () => {
          for (const p of participants) {
            const texts = await p.page
              .locator('.sticky-note__text')
              .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
            if (texts.some((t) => t !== '')) return false;
          }
          return true;
        },
        true,
        12_000,
      );
      // ...and exactly n notes remain.
      for (const p of participants) {
        expect(await p.page.locator('.sticky-note').count()).toBe(n);
      }
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});
