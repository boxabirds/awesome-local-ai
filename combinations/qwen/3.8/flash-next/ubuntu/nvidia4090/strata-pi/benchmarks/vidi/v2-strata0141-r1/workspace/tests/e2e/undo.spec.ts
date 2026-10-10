import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, type StickyColor } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { openBoard, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from './helpers/board';
import { joinBoard, newLiveBoardId, trackErrors } from './helpers/live';
import {
  clickDeleteSelection,
  marqueeSelect,
  setFlatCamera,
  waitForSelectedIds,
  type PlaceNote,
} from './helpers/selection';
import {
  clickCreateStickyButton,
  clickDeleteButton,
  dragNote,
  getNotes,
  noteCard,
  selectNote,
} from './helpers/sticky';

/**
 * Story 8, task 5: recovering my own mistakes while colleagues work, through the
 * real product - a real browser, the real client build and the real sync provider
 * (`tests/e2e`, anchor `undo.controls`).
 *
 * TC-22, TC-23, TC-24.
 */

/** A note as data, so a note on one screen can be compared to the same note on another. */
function noteAsData(note: StickySnapshot) {
  return {
    id: note.id,
    x: note.x,
    y: note.y,
    z: note.z,
    color: note.color,
    text: note.text,
    width: note.width ?? null,
    height: note.height ?? null,
  };
}

const boardAsData = (notes: readonly StickySnapshot[]) =>
  JSON.stringify(notes.map(noteAsData));

const positionOf = (notes: readonly StickySnapshot[], id: string) => {
  const note = notes.find((candidate) => candidate.id === id);
  return note ? { x: note.x, y: note.y } : null;
};

const undoButton = (page: Page) => page.getByTestId('undo');
const redoButton = (page: Page) => page.getByTestId('redo');

/** Ctrl/Cmd+Z, sent to whatever the page has focused - the board, in these tests. */
const pressUndo = async (page: Page): Promise<void> => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(60);
};

const pressRedo = async (page: Page): Promise<void> => {
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(60);
};

/** Leave a note that was just created (or opened) back in its ordinary state. */
async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
}

/** Put notes on the board through the model, each with its own colour and text. */
async function seedNotes(page: Page, seeds: readonly PlaceNote[]): Promise<string[]> {
  const ids = await page.evaluate((specs) => {
    const api = window.__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return specs.map((spec) => api.createNote({ at: spec, color: spec.color, text: spec.text }));
  }, seeds);
  await expect
    .poll(async () => (await getNotes(page)).filter((note) => ids.includes(note.id)).length, {
      timeout: 15_000,
    })
    .toBe(ids.length);
  return ids;
}

/** Wait until every page holds the same board, and return it. */
async function waitForBoardsToAgree(pages: readonly Page[]): Promise<readonly StickySnapshot[]> {
  let first: readonly StickySnapshot[] = [];
  await expect
    .poll(
      async () => {
        const boards = await Promise.all(pages.map((page) => getNotes(page)));
        first = boards[0]!;
        return boards.every((board) => boardAsData(board) === boardAsData(first));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return first;
}

/**
 * Notes laid out in a grid the viewport can show at zoom 1.
 *
 * With the camera parked at the origin (see `setFlatCamera`) a world point *is* a
 * screen point, so the grid is placed where the screen is: `centre` is the middle
 * of the grid, and the world coordinates of a note are where its card is painted.
 */
function grid(columns: number, rows: number, spacing: number, centre: PlaceNote): PlaceNote[] {
  const notes: PlaceNote[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      notes.push({
        x: centre.x + (column - (columns - 1) / 2) * spacing,
        y: centre.y + (row - (rows - 1) / 2) * spacing,
      });
    }
  }
  return notes;
}

/** The middle of the screen when the camera is parked at the origin. */
const SCREEN_CENTRE: PlaceNote = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };

test.describe('undo and redo while other people work', () => {
  test('TC-22: eight notes deleted by accident come back, and my colleague\'s note is untouched', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const board = newLiveBoardId();
    const miaContext = await browser.newContext();
    const rajContext = await browser.newContext();
    try {
      const mia = await joinBoard(miaContext, board);
      const raj = await joinBoard(rajContext, board);
      const errors = trackErrors(mia);
      await setFlatCamera(mia);
      await setFlatCamera(raj);

      // Raj puts eight notes on the board, each with its own colour and text.
      const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
      const seeds = grid(4, 2, 230, SCREEN_CENTRE).map((point, index) => ({
        ...point,
        color: colors[index % colors.length],
        text: `note ${index + 1}`,
      }));
      const ids = await seedNotes(raj, seeds);
      const agreed = await waitForBoardsToAgree([mia, raj]);
      const before = new Map(agreed.map((note) => [note.id, noteAsData(note)]));
      expect([...before.keys()].sort()).toEqual([...ids].sort());

      // Mia box-selects all eight and presses Delete. It is one action, so it is
      // one undo step.
      await marqueeSelect(mia, { x: 120, y: 60 }, { x: 1160, y: 740 });
      await waitForSelectedIds(mia, ids);
      await clickDeleteSelection(mia);
      await expect.poll(async () => (await getNotes(raj)).length, { timeout: 15_000 }).toBe(0);

      // While her Undo has not been pressed, Raj adds a note of his own.
      await clickCreateStickyButton(raj);
      await closeEditor(raj);
      const rajNote = (await getNotes(raj))[0]!.id;
      await waitForBoardsToAgree([mia, raj]);

      // Mia presses Ctrl+Z: her delete is taken back.
      await pressUndo(mia);

      // All eight notes are back on both screens, with the text, colours, sizes and
      // positions they had.
      for (const page of [mia, raj]) {
        await expect
          .poll(async () => (await getNotes(page)).length, { timeout: 15_000 })
          .toBe(ids.length + 1);
      }
      const restored = await waitForBoardsToAgree([mia, raj]);
      for (const note of restored) {
        if (note.id === rajNote) {
          continue;
        }
        expect(noteAsData(note)).toEqual(before.get(note.id));
      }
      // Raj's note is still there, on both screens, exactly as Raj left it.
      const rajAfter = restored.find((note) => note.id === rajNote)!;
      expect(await getNotes(raj)).toHaveLength(ids.length + 1);
      expect(rajAfter.text).toBe('');
      const rajAsData = JSON.stringify([noteAsData(rajAfter)]);

      // Undo again and again: the eight notes were Raj's, so Mia's history stops
      // here - the button says so.
      await expect(undoButton(mia)).toBeDisabled();

      // Redo deletes the eight again, on both screens, and still spares Raj's note.
      await pressRedo(mia);
      for (const page of [mia, raj]) {
        await expect
          .poll(async () => boardAsData(await getNotes(page)), { timeout: 15_000 })
          .toBe(rajAsData);
      }
      expect(errors).toEqual([]);
    } finally {
      await miaContext.close();
      await rajContext.close();
    }
  });

  test('TC-23: a colleague deleting the note I moved leaves my undo harmless', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const board = newLiveBoardId();
    const miaContext = await browser.newContext();
    const rajContext = await browser.newContext();
    try {
      const mia = await joinBoard(miaContext, board);
      const raj = await joinBoard(rajContext, board);
      const errors = trackErrors(mia);
      const rajErrors = trackErrors(raj);
      await setFlatCamera(mia);
      await setFlatCamera(raj);

      // Mia creates a note and moves it.
      const mineIds = await seedNotes(mia, [{ x: 400, y: 400, text: 'mine' }]);
      const id = mineIds[0]!;
      await waitForBoardsToAgree([mia, raj]);
      await dragNote(mia, id, 150, 90);
      const moved = positionOf(await getNotes(mia), id);
      expect(moved).not.toEqual({ x: 300, y: 300 });
      await expect
        .poll(async () => JSON.stringify(positionOf(await getNotes(raj), id)), { timeout: 15_000 })
        .toBe(JSON.stringify(moved));

      // Raj deletes it. On Mia's screen the note disappears.
      await selectNote(raj, id);
      await clickDeleteButton(raj);
      await expect.poll(async () => (await getNotes(mia)).length, { timeout: 15_000 }).toBe(0);

      // Mia presses Ctrl+Z, twice: the move, then the creation. Neither can bring
      // back what Raj deleted, and neither breaks anything.
      await pressUndo(mia);
      await pressUndo(mia);
      await expect(undoButton(mia)).toBeDisabled();
      expect(await getNotes(mia)).toHaveLength(0);
      expect(await getNotes(raj)).toHaveLength(0);
      expect(errors).toEqual([]);
      expect(rajErrors).toEqual([]);

      // Her board still works: a new note appears for both of them.
      await clickCreateStickyButton(mia);
      await closeEditor(mia);
      const fresh = (await getNotes(mia))[0]!.id;
      await expect.poll(async () => (await getNotes(raj)).length, { timeout: 15_000 }).toBe(1);
      expect((await getNotes(raj))[0]!.id).toBe(fresh);
      expect(errors).toEqual([]);
    } finally {
      await miaContext.close();
      await rajContext.close();
    }
  });

  test('TC-24: everyone undoing at once reverts each person\'s own work and nothing else', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const board = newLiveBoardId();
    const contexts = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => browser.newContext()),
    );
    const errors: string[] = [];
    try {
        const pages = await Promise.all(
          contexts.map(async (context) => {
            const page = await joinBoard(context, board);
            errors.push(...trackErrors(page));
            await setFlatCamera(page);
            return page;
          }),
        );

      // Ten notes, seeded from the first board and seen by everyone: each editor
      // moves one note and types in a different one.
      const points = grid(5, 2, 220, SCREEN_CENTRE);
      const ids = await pages[0]!.evaluate((specs) => {
        const api = window.__vidi6;
        if (!api) {
          throw new Error('test hooks are not installed');
        }
        return specs.map((spec) => api.createNote({ at: spec }));
      }, points);
      const starting = await waitForBoardsToAgree(pages);
      const startPositions = new Map(
        starting.map((note) => [note.id, { x: note.x, y: note.y }]),
      );
      expect(startPositions.size).toBe(ids.length);

      // Everyone edits at the same time, each on their own two notes.
      await Promise.all(
        pages.map(async (page, index) => {
          const moved = ids[index]!;
          const typed = ids[ids.length - 1 - index]!;
          await dragNote(page, moved, 40 + 20 * index, -30 - 15 * index);
          await noteCard(page, typed).dblclick();
          await page.keyboard.type(` written by editor ${index + 1}`);
          await closeEditor(page);
        }),
      );
      const edited = await waitForBoardsToAgree(pages);
      const movedAway = edited.filter((note) => {
        const start = startPositions.get(note.id)!;
        return note.x !== start.x || note.y !== start.y;
      });
      expect(movedAway.length).toBe(pages.length);
      expect(edited.filter((note) => note.text !== '').length).toBe(pages.length);

      // Everyone presses Ctrl+Z twice - their own typing, then their own move.
      for (let round = 0; round < 2; round += 1) {
        await Promise.all(pages.map((page) => pressUndo(page)));
      }

      // Every board ends identical, and every note is back where it started with
      // nothing typed in it: only each editor's own changes were taken back.
      const final = await waitForBoardsToAgree(pages);
      expect(final).toHaveLength(ids.length);
      for (const note of final) {
        expect(note.text).toBe('');
        expect({ x: note.x, y: note.y }).toEqual(startPositions.get(note.id));
      }
      for (const page of pages) {
        expect(boardAsData(await getNotes(page))).toBe(boardAsData(final));
      }
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test('the toolbar buttons take back my last change and put it back', async ({ page }) => {
    test.setTimeout(120_000);
    await openBoard(page);
    await setFlatCamera(page);
    await page.bringToFront();

    await clickCreateStickyButton(page);
    await closeEditor(page);
    const created = (await getNotes(page))[0] as StickySnapshot;
    const id = created.id;
    const start = { x: created.x, y: created.y };

    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeDisabled();

    await dragNote(page, id, 160, 100);
    const moved = positionOf(await getNotes(page), id);
    expect(moved).not.toEqual(start);

    // One press: the move is gone, the note is not.
    await undoButton(page).click();
    await expect
      .poll(async () => positionOf(await getNotes(page), id), { timeout: 10_000 })
      .toEqual(start);
    expect(await getNotes(page)).toHaveLength(1);
    await expect(undoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toBeEnabled();

    // Another press: creating the note was my step too.
    await undoButton(page).click();
    await expect.poll(async () => (await getNotes(page)).length, { timeout: 10_000 }).toBe(0);
    await expect(undoButton(page)).toBeDisabled();

    // Two presses of Redo put the note back where it had been moved to.
    await redoButton(page).click();
    await expect.poll(async () => (await getNotes(page)).length, { timeout: 10_000 }).toBe(1);
    await redoButton(page).click();
    await expect
      .poll(async () => positionOf(await getNotes(page), id), { timeout: 10_000 })
      .toEqual(moved);
    await expect(redoButton(page)).toBeDisabled();
  });
});
