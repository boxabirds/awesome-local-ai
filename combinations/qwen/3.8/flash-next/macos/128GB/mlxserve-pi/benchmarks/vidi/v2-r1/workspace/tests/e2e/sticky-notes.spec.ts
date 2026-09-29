import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  openBoard,
  readCamera,
  setCamera,
  settle,
  STANDARD_VIEW,
  VIEWPORT,
} from './helpers/board';
import {
  createNote,
  deleteButton,
  dragNote,
  editorText,
  noteAt,
  noteCentre,
  noteCount,
  readNotes,
  stopEditing,
  swatch,
} from './helpers/sticky';

const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.describe('sticky notes', () => {
  // TC-36: double-click empty board creates a 200px note and opens its editor.
  test('double-click creates a note, edits it, and shows its toolbar', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);

    await createNote(page, CENTER.x, CENTER.y, 'Ship the demo');
    await expect(editorText(page)).toHaveValue('Ship the demo');

    await stopEditing(page);
    await expect(page.getByTestId('sticky-note-text')).toHaveText('Ship the demo');

    const note = await noteAt(page, 0);
    expect(note.width).toBe(200);
    expect(note.height).toBe(200);
    expect(note.color).toBe('yellow');
    expect(note.selected).toBe(true);
    expect(note.editing).toBe(false);
  });

  // Dragging a selected note moves it exactly; the camera (grid) does not pan.
  test('dragging a note moves it and does not pan the board', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y);
    await stopEditing(page);

    const before = await noteAt(page, 0);
    const cameraBefore = await readCamera(page);

    await dragNote(page, 0, 60, 40);
    await settle(page);

    const after = await noteAt(page, 0);
    expect(after.left).toBeCloseTo(before.left + 60, 0);
    expect(after.top).toBeCloseTo(before.top + 40, 0);
    expect(await readCamera(page)).toEqual(cameraBefore);
    expect(await noteCount(page)).toBe(1);
  });

  // Double-clicking the lower of two notes brings it to the front (FR-7).
  test('double-clicking a note brings it to the front', async ({ page }) => {
    await openBoard(page);
    await createNote(page, 520, 320, 'A');
    await stopEditing(page);
    await createNote(page, 720, 520, 'B');
    await stopEditing(page);

    let notes = await readNotes(page);
    const zBy = (text: string): number => {
      const note = notes.find((n) => n.text === text);
      if (!note) throw new Error(`no note with text "${text}"`);
      return note.z;
    };
    expect(zBy('B')).toBeGreaterThan(zBy('A')); // B created later is on top

    // Double-click the bottom note (A), then stop editing so its text is readable.
    const a = await noteCentre(page, 0);
    await page.mouse.dblclick(a.x, a.y);
    await page.keyboard.press('Escape');
    await settle(page);

    notes = await readNotes(page);
    expect(zBy('A')).toBeGreaterThan(zBy('B'));
  });

  // Changing the note colour from the toolbar swatch.
  test('a colour swatch recolours the selected note', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y);
    await stopEditing(page);

    await swatch(page, 'Blue').click();

    await expect(page.getByTestId('sticky-note')).toHaveAttribute('data-color', 'blue');
    await expect(page.getByTestId('sticky-note')).toHaveAttribute('data-selected', 'true');
  });

  // Deleting the note from its toolbar removes it from the board.
  test('the delete button removes the note', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y);
    await stopEditing(page);

    await deleteButton(page).click();

    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  });

  // Re-opening an existing note's editor and continuing to type (FR-9).
  test('double-clicking an existing note re-opens its editor', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y, 'Idea');
    await stopEditing(page);

    const centre = await noteCentre(page, 0);
    await page.mouse.dblclick(centre.x, centre.y);
    await page.waitForSelector('[data-testid="sticky-note-text"]');
    await page.keyboard.insertText(' now');
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('sticky-note-text')).toHaveText('Idea now');
  });

  // Text limit, auto-fit to the minimum and the overflow fade (FR-4).
  test('1000 characters are accepted, the font shrinks to the minimum and text clips', async ({
    page,
  }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y);

    await page.keyboard.insertText('word '.repeat(300));

    const info = await page.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="sticky-note-text"]',
      )!;
      const style = getComputedStyle(el);
      return {
        length: el.value.length,
        fontPx: Number.parseFloat(style.fontSize),
        overflow: el.dataset.overflow,
        clipped: el.scrollHeight > el.clientHeight,
      };
    });
    expect(info.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    expect(info.fontPx).toBeCloseTo(STICKY_FONT_MIN_PX, 0);
    expect(info.overflow).toBe('true');
    expect(info.clipped).toBe(true);
  });

  // A short label stays at the maximum font size.
  test('short text renders at the maximum font size', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y);
    await page.keyboard.insertText('Idea');

    const fontPx = await page.evaluate(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="sticky-note-text"]',
      )!;
      return Number.parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontPx).toBeCloseTo(STICKY_FONT_MAX_PX, 0);
  });

  // Navigation never moves a note: its position is stored in world coordinates.
  test('panning and zooming do not move notes', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y, 'anchor');
    await stopEditing(page);
    const before = await noteAt(page, 0);

    // Pan by dragging empty board space (top-left region, away from the note).
    await page.mouse.move(160, 640);
    await page.mouse.down();
    await page.mouse.move(360, 700, { steps: 5 });
    await page.mouse.up();
    await settle(page);

    const afterPan = await noteAt(page, 0);
    expect(afterPan.left).toBeCloseTo(before.left, 1);
    expect(afterPan.top).toBeCloseTo(before.top, 1);

    // Zoom in around the note; its world position is unchanged and it survives.
    await setCamera(page, { x: -200, y: -100, zoom: 2 });
    expect(await noteCount(page)).toBe(1);
    const afterZoom = await noteAt(page, 0);
    expect(afterZoom.left).toBeCloseTo(before.left, 1);
    expect(afterZoom.top).toBeCloseTo(before.top, 1);
  });

  // The standard view keeps everything; notes are unaffected by a zoom reset.
  test('notes are visible and unchanged in the standard view', async ({ page }) => {
    await openBoard(page);
    await createNote(page, CENTER.x, CENTER.y, 'stable');
    await stopEditing(page);
    const before = await noteAt(page, 0);

    await setCamera(page, STANDARD_VIEW);
    expect(await noteCount(page)).toBe(1);
    const after = await noteAt(page, 0);
    expect(after.left).toBeCloseTo(before.left, 1);
    expect(after.text).toBe('stable');
  });
});
