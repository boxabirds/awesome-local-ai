/**
 * Sticky notes in the browser (story 2): the brainstorm workflow end to end,
 * creation while panned far away, dragging at 50 % and 200 % zoom, and text that
 * shrinks to fit and then clips.
 *
 * These run against the built client with real pointer events and real font
 * layout, which is what the component tests cannot measure: pixel positions,
 * computed font sizes and clipping.
 *
 * TC-30 double-click creates a note centred on the point and typing goes in
 * TC-31 drag at 50 %  : a (100, 50) px drag moves the note (200, 100) world units
 * TC-32 drag at 200 % : the note moves (50, 25) and is drawn above the other one
 * TC-33 one word at 24 px; 1,000 characters at the 10 px floor, clipped with a fade
 * TC-34 create from the toolbar while panned far away: the note is on screen
 */
import { expect, test, type Page } from '@playwright/test';

import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { readCamera, withinTolerance } from './helpers/board';
import { PROSE_LIMIT, PROSE_PASTE, RETRO_NOTE } from '../fixtures/texts';
import {
  centreView,
  dragFrom,
  doubleClickBoard,
  editorValue,
  noteCentre,
  noteCount,
  noteFontSize,
  noteIndexAtPoint,
  noteTextClip,
  pasteText,
  readNotes,
  typeText,
  viewCentreWorld,
} from './helpers/stickies';

/** A point on empty board space, away from the hint and the controls. */
const BOARD_POINT = { x: 640, y: 360 };

function viewportOf(page: Page): { width: number; height: number } {
  return page.viewportSize() ?? { width: 1280, height: 800 };
}

/**
 * A point inside a note of the given size whose centre is at the given screen
 * point, expressed as a fraction of the note's half-width/height (-1 = left/top
 * edge, 0 = centre).
 */
function pointInNote(
  centre: { x: number; y: number },
  zoom: number,
  offset: { x: number; y: number },
): { x: number; y: number } {
  const half = (STICKY_SIZE_WORLD / 2) * zoom;
  return { x: centre.x + offset.x * half, y: centre.y + offset.y * half };
}

test.describe('workflow 1: brainstorm a note, move it, recolour it, delete it', () => {
  test('TC-30 creates a note on a double-click and takes the typing', async ({ page }) => {
    await page.goto('/');

    await doubleClickBoard(page, BOARD_POINT);
    await typeText(page, 'Hello');

    const notes = await readNotes(page);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(withinTolerance(note.box.x + note.box.width / 2, BOARD_POINT.x, 1)).toBe(true);
    expect(withinTolerance(note.box.y + note.box.height / 2, BOARD_POINT.y, 1)).toBe(true);
    expect(note.textLength).toBe('Hello'.length);
    expect(note.color).toBe('yellow');
    expect(note.selected).toBe(true);
    // The whole 200 x 200 board-unit note is painted at 100 % zoom.
    expect(withinTolerance(note.box.width, STICKY_SIZE_WORLD, 1)).toBe(true);
  });

  test('Enter inside a note breaks a line and the note shows both lines', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);
    await typeText(page, 'one');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
    await typeText(page, 'two');
    expect(
      await page.evaluate(() => {
        const element = document.querySelector('[data-testid="sticky-note-textarea"]');
        return element instanceof HTMLTextAreaElement ? element.value : null;
      }),
    ).toBe('one\ntwo');

    await page.keyboard.press('Escape');
    const notes = await readNotes(page);
    expect(notes[0]!.textLength).toBe('one\ntwo'.length);
    // Both lines are shown, so the text is at least two lines tall.
    const lines = await page.evaluate(() => {
      const element = document.querySelector('.sticky-note__text');
      if (!element) return null;
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return (element as HTMLElement).scrollHeight / lineHeight;
    });
    expect(lines).toBeGreaterThanOrEqual(2);
  });

  test('TC-31 drags a note at 50 % zoom without moving the board', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);
    await page.keyboard.press('Escape');

    const before = (await readNotes(page))[0]!;
    // Look at the note at 50 %: the same note is now half as big on screen.
    await centreView(page, noteCentre(before), 0.5);

    const cameraBefore = await readCamera(page);
    const current = (await readNotes(page))[0]!;
    expect(withinTolerance(current.box.width, STICKY_SIZE_WORLD * 0.5, 1)).toBe(true);

    const size = viewportOf(page);
    const grab = pointInNote({ x: size.width / 2, y: size.height / 2 }, 0.5, { x: -0.4, y: -0.3 });
    expect(await noteIndexAtPoint(page, grab)).toBe(0);

    await dragFrom(page, grab, { x: 100, y: 50 });

    const moved = (await readNotes(page))[0]!;
    // Half scale: screen pixels count double in the document.
    expect(moved.x - current.x).toBeCloseTo(200, 1);
    expect(moved.y - current.y).toBeCloseTo(100, 1);
    // The point that was grabbed is where the pointer stopped.
    expect(withinTolerance(moved.box.x, current.box.x + 100, 1)).toBe(true);
    expect(withinTolerance(moved.box.y, current.box.y + 50, 1)).toBe(true);
    // Dragging a note is not panning the board.
    expect(await readCamera(page)).toEqual(cameraBefore);
  });

  test('TC-32 drags one note over another at 200 % zoom and draws it on top', async ({ page }) => {
    await page.goto('/');
    await centreView(page, { x: 0, y: 0 }, 2);

    // Two overlapping notes; the second is created above the first.
    await doubleClickBoard(page, { x: 420, y: 300 });
    await page.keyboard.press('Escape');
    await doubleClickBoard(page, { x: 640, y: 460 });
    await page.keyboard.press('Escape');

    const before = await readNotes(page);
    expect(before).toHaveLength(2);
    const bottom = before[0]!;
    const top = before[1]!;
    expect(bottom.z).toBeLessThan(top.z);

    // Grab the lower note somewhere the upper one does not cover. At 200 % a
    // (100, 50) px drag is (50, 25) world units.
    const grab = { x: 300, y: 220 };
    expect(await noteIndexAtPoint(page, grab)).toBe(0);

    await dragFrom(page, grab, { x: 100, y: 50 });

    const after = await readNotes(page);
    const moved = after.find((note) => note.id === bottom.id)!;
    const other = after.find((note) => note.id === top.id)!;
    expect(moved.x - bottom.x).toBeCloseTo(50, 1);
    expect(moved.y - bottom.y).toBeCloseTo(25, 1);
    // The dragged note is now last in the stacking order and painted above the
    // note it overlaps.
    expect(after[1]!.id).toBe(bottom.id);
    expect(moved.z).toBeGreaterThan(other.z);
    const overlap = {
      x: Math.max(moved.box.x, other.box.x) + 20,
      y: Math.max(moved.box.y, other.box.y) + 20,
    };
    expect(overlap.x).toBeLessThan(Math.min(moved.box.x + moved.box.width, other.box.x + other.box.width));
    expect(await noteIndexAtPoint(page, overlap)).toBe(after.findIndex((n) => n.id === moved.id));
  });

  test('recolours the selected note and deletes it with the bin', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);
    await typeText(page, 'Keep or drop');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Violet colour' }).click();
    await expect
      .poll(async () => (await readNotes(page))[0]?.color)
      .toBe('violet');
    const recoloured = (await readNotes(page))[0]!;
    // Text, position and selection survive a recolour.
    expect(recoloured.textLength).toBe('Keep or drop'.length);
    expect(recoloured.selected).toBe(true);

    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect.poll(() => noteCount(page)).toBe(0);
    expect(await readNotes(page)).toEqual([]);
  });
});

test.describe('workflow 2: creating while far from the origin', () => {
  test('TC-34 the toolbar puts a note in the middle of what the user is looking at', async ({
    page,
  }) => {
    await page.goto('/');
    await centreView(page, { x: 40_000, y: -25_000 }, 1);
    const camera = await readCamera(page);

    await page.getByRole('button', { name: 'Sticky note' }).click();

    const notes = await readNotes(page);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    const size = viewportOf(page);
    expect(withinTolerance(note.box.x + note.box.width / 2, size.width / 2, 1)).toBe(true);
    expect(withinTolerance(note.box.y + note.box.height / 2, size.height / 2, 1)).toBe(true);
    // The far-away place the camera was moved to, and creating did not scroll.
    const centre = viewCentreWorld(page, camera);
    expect(note.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.x, 4);
    expect(note.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(centre.y, 4);
    expect(await readCamera(page)).toEqual(camera);

    // It accepts typing without another click.
    await typeText(page, 'outlier');
    expect((await readNotes(page))[0]!.textLength).toBe('outlier'.length);
  });
});

test.describe('keyboard only', () => {
  /**
   * Walk forward with Tab from the board's own toolbar until the note itself is
   * focused. The starting point is set explicitly because the browser resumes
   * sequential navigation from wherever the last focused element was, and the
   * editor that just closed is no longer in the tree to resume from.
   */
  async function tabUntilNoteFocused(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Sticky note' }).focus();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (focused === 'sticky-note') return;
    }
    throw new Error('a sticky note was never reached with Tab');
  }

  test('a note can be created, edited, moved and deleted without the mouse', async ({ page }) => {
    await page.goto('/');

    // The toolbar button creates a note and the caret is already in it.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await typeText(page, 'Draft');
    await page.keyboard.press('Escape');
    expect((await readNotes(page))[0]!.textLength).toBe('Draft'.length);

    // Tab reaches the note, Enter edits it again, Enter inside the editor breaks
    // a line, Escape leaves with the note still selected.
    await tabUntilNoteFocused(page);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
    await typeText(page, ' more');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
    await typeText(page, 'lines');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-note-editor')).toHaveCount(0);
    expect((await readNotes(page))[0]!.textLength).toBe('Draft more\nlines'.length);

    // Tab reaches the note's own toolbar: the six colours, then the bin.
    let reachedBin = false;
    await tabUntilNoteFocused(page);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (label === 'Delete note') {
        reachedBin = true;
        break;
      }
    }
    // Enter presses the bin instead of also starting an edit behind it.
    expect(reachedBin).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => noteCount(page)).toBe(0);
  });

  test('Delete removes the focused note', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);
    await page.keyboard.press('Escape');

    await tabUntilNoteFocused(page);
    await page.keyboard.press('Delete');
    await expect.poll(() => noteCount(page)).toBe(0);
  });
});

test.describe('workflow 3: long text', () => {
  test('TC-33 text shrinks to fit, then clips with the fade at the limit', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);

    // A short note is written at the largest size.
    await typeText(page, 'Idea');
    expect(await noteFontSize(page)).toBeCloseTo(24, 1);
    expect((await noteTextClip(page)).hasFade).toBe(false);

    // A full note of text drops to the smallest size and stops there, clipped
    // inside the note with a fade on its bottom edge.
    await pasteText(page, PROSE_LIMIT);
    await expect
      .poll(async () => (await readNotes(page))[0]?.textLength)
      .toBe(STICKY_TEXT_MAX_CHARS);

    const size = await noteFontSize(page);
    expect(size).toBeGreaterThanOrEqual(10);
    expect(size).toBeLessThanOrEqual(24);
    const clip = await noteTextClip(page);
    expect(clip.clipped).toBe(true);
    expect(clip.hasFade).toBe(true);
    // Nothing is painted outside the note.
    const note = (await readNotes(page))[0]!;
    expect(withinTolerance(note.box.height, STICKY_SIZE_WORLD, 1)).toBe(true);

    // The counter shows the limit, and more typing changes nothing.
    await expect(page.getByTestId('sticky-note-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
    await typeText(page, 'nope');
    expect((await readNotes(page))[0]!.textLength).toBe(STICKY_TEXT_MAX_CHARS);

    // Leaving the editor keeps the text and the fade.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-note-editor')).toHaveCount(0);
    const shown = await noteTextClip(page);
    expect(shown.clipped).toBe(true);
    expect(shown.hasFade).toBe(true);
    expect((await readNotes(page))[0]!.textLength).toBe(STICKY_TEXT_MAX_CHARS);
  });

  test('a 1,200 character paste into an empty note keeps exactly the first 1,000', async ({
    page,
  }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);

    await pasteText(page, PROSE_PASTE);
    await expect
      .poll(async () => (await readNotes(page))[0]?.textLength)
      .toBe(STICKY_TEXT_MAX_CHARS);
    // The first 1,000 characters, in order, and nothing of the last 200.
    expect(await editorValue(page)).toBe(PROSE_LIMIT);
    await expect(page.getByTestId('sticky-note-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  test('a medium note is written between the two ends of the size range', async ({ page }) => {
    await page.goto('/');
    await doubleClickBoard(page, BOARD_POINT);

    await pasteText(page, RETRO_NOTE);
    const size = await noteFontSize(page);
    expect(size).toBeGreaterThan(10);
    expect(size).toBeLessThan(24);
    const clip = await noteTextClip(page);
    expect(clip.clipped).toBe(false);
    expect(clip.hasFade).toBe(false);
  });
});
