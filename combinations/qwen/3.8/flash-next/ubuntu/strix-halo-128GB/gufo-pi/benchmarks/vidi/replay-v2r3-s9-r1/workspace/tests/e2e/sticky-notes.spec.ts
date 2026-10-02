import { test, expect, type Page } from '@playwright/test';
import {
  clickDeleteNote,
  clickSwatch,
  createNoteAt,
  dragNote,
  endEditing,
  getBoard,
  getNote,
  noteBox,
  noteIdAtPoint,
  noteTextMetrics,
  pasteIntoNote,
  selectNote,
  setCamera,
  typeIntoNote,
} from './helpers/board';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { LONG_NOTE_1000 } from '../fixtures/texts';

const CENTRE = { x: 640, y: 400 };

/** Poll until the note sits at the expected world position (`tol` is in world units). */
async function expectWorldPosition(
  page: Page,
  id: string,
  expected: { x: number; y: number },
  tol: number,
) {
  await expect
    .poll(async () => {
      const n = await getNote(page, id);
      if (!n) return Number.POSITIVE_INFINITY;
      return Math.max(Math.abs(n.x - expected.x), Math.abs(n.y - expected.y));
    })
    .toBeLessThanOrEqual(tol);
}

test.describe('Story 2: sticky notes', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/boards');
    const { id } = await res.json();
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-30: double-click creates a note centred on the pointer and typing lands in it', async ({
    page,
  }) => {
    const note = await createNoteAt(page, 400, 300);
    await expect.poll(() => getBoard(page)).toHaveLength(1);

    const box = await noteBox(page, note.id);
    expect(Math.abs(box.cx - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - 300)).toBeLessThanOrEqual(1);

    await typeIntoNote(page, 'Hello');
    await expect
      .poll(async () => (await getNote(page, note.id))?.text)
      .toBe('Hello');

    // The note is still being edited, so the text is in the textarea.
    await expect(page.getByTestId('sticky-note-editor')).toHaveValue('Hello');
  });

  test('TC-31: at 50% zoom a drag keeps the grabbed point under the pointer', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    const note = await createNoteAt(page, CENTRE.x, CENTRE.y);
    await endEditing(page);

    const before = await getNote(page, note.id);
    const boxBefore = await noteBox(page, note.id);
    const { to } = await dragNote(page, note.id, 100, 50);

    // 100 screen px at 50% zoom is 200 world units (one pixel of slack allowed).
    await expectWorldPosition(page, note.id, { x: before!.x + 200, y: before!.y + 100 }, 2);

    const boxAfter = await noteBox(page, note.id);
    // The whole note moved by exactly the pointer movement on screen.
    expect(Math.abs(boxAfter.x - (boxBefore.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - (boxBefore.y + 50))).toBeLessThanOrEqual(1);
    // The grabbed point is where the pointer stopped.
    const grabbedOffset = { x: boxBefore.width * 0.3, y: boxBefore.height * 0.3 };
    expect(Math.abs(boxAfter.x + grabbedOffset.x - to.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y + grabbedOffset.y - to.y)).toBeLessThanOrEqual(1);
  });

  test('TC-32: at 200% zoom a drag moves the note in world units and raises it above', async ({
    page,
  }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    const first = await createNoteAt(page, 300, 300);
    await page.mouse.click(1100, 700); // empty board: close the editor
    const second = await createNoteAt(page, 900, 600);
    await page.mouse.click(1100, 100);

    // Drag the first note across the second one so they overlap.
    await dragNote(page, first.id, 400, 200);
    const overlapBox = await noteBox(page, first.id);
    const otherBox = await noteBox(page, second.id);
    const overlap = {
      x: Math.max(overlapBox.x, otherBox.x) + 20,
      y: Math.max(overlapBox.y, otherBox.y) + 20,
    };
    expect(await noteIdAtPoint(page, overlap.x, overlap.y)).toBe(first.id);

    // One more 100x50 screen drag is 50x25 world units at 200% zoom.
    const before = await getNote(page, first.id);
    await dragNote(page, first.id, 100, 50, { fx: 0.3, fy: 0.3 });
    await expectWorldPosition(page, first.id, { x: before!.x + 50, y: before!.y + 25 }, 0.6);
    // Still on top after the second drag.
    const boxA = await noteBox(page, first.id);
    const boxB = await noteBox(page, second.id);
    expect(
      await noteIdAtPoint(
        page,
        Math.max(boxA.x, boxB.x) + 20,
        Math.max(boxA.y, boxB.y) + 20,
      ),
    ).toBe(first.id);
  });

  test('TC-33: one word sets the maximum font size; a long note clips with a fade', async ({
    page,
  }) => {
    const note = await createNoteAt(page, CENTRE.x, CENTRE.y);
    await typeIntoNote(page, 'Teamwork');
    await expect
      .poll(async () => (await getNote(page, note.id))?.text)
      .toBe('Teamwork');
    await endEditing(page);

    const short = await noteTextMetrics(page, note.id);
    expect(short.fontSize).toBe(24);
    expect(short.faded).toBe(false);

    await selectNote(page, note.id);
    await page.mouse.dblclick(
      (await noteBox(page, note.id)).cx,
      (await noteBox(page, note.id)).cy,
    );
    await pasteIntoNote(page, LONG_NOTE_1000);
    await expect
      .poll(async () => (await getNote(page, note.id))?.text.length)
      .toBe(1000);
    await endEditing(page);

    const long = await noteTextMetrics(page, note.id);
    expect(long.fontSize).toBeGreaterThanOrEqual(10);
    expect(long.scrollHeight).toBeGreaterThan(long.clientHeight);
    expect(long.faded).toBe(true);
    expect(await page.locator('[data-testid="sticky-note-fade"]').count()).toBe(1);

    // Nothing is painted outside the note box.
    const noteBounds = await noteBox(page, note.id);
    const textBounds = await page
      .locator(`[data-note-id="${note.id}"] [data-testid="sticky-note-text"]`)
      .boundingBox();
    expect(textBounds!.x).toBeGreaterThanOrEqual(noteBounds.x - 0.5);
    expect(textBounds!.y).toBeGreaterThanOrEqual(noteBounds.y - 0.5);
    expect(textBounds!.x + textBounds!.width).toBeLessThanOrEqual(noteBounds.x + noteBounds.width + 0.5);
    expect(textBounds!.y + textBounds!.height).toBeLessThanOrEqual(noteBounds.y + noteBounds.height + 0.5);
  });

  test('TC-34: creating from the toolbar while panned far away puts the note on screen', async ({
    page,
  }) => {
    await setCamera(page, { x: 48000, y: -32000, zoom: 1 });
    await page.getByRole('button', { name: /Sticky note/i }).click();
    await expect.poll(() => getBoard(page)).toHaveLength(1);

    const note = (await getBoard(page))[0];
    const box = await noteBox(page, note.id);
    expect(Math.abs(box.cx - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - CENTRE.y)).toBeLessThanOrEqual(1);
    // In world space it sits where the centre of the screen currently looks.
    expect(note.x).toBeCloseTo(CENTRE.x + 48000 - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(CENTRE.y - 32000 - STICKY_SIZE_WORLD / 2, 6);
  });

  test('workflow: brainstorm, move at 50%, recolour, delete', async ({ page }) => {
    // Two ideas captured by double-clicking the board.
    const first = await createNoteAt(page, 300, 250);
    await typeIntoNote(page, 'Ship the beta');
    const second = await createNoteAt(page, 420, 420);
    await typeIntoNote(page, 'Fix the importer');
    await endEditing(page);

    let board = await getBoard(page);
    expect(board).toHaveLength(2);
    expect(board.map((n) => n.text).sort()).toEqual(['Fix the importer', 'Ship the beta']);

    // Rearrange the first note at 50% zoom (downwards, so its toolbar stays on screen).
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    const beforeMove = await getNote(page, first.id);
    await dragNote(page, first.id, 120, 60);
    await expectWorldPosition(page, first.id, { x: beforeMove!.x + 240, y: beforeMove!.y + 120 }, 2);

    // Recolour it green; it stays selected and keeps its text.
    await clickSwatch(page, 'Green');
    await expect
      .poll(async () => (await getNote(page, first.id))?.color)
      .toBe('green');
    expect((await getNote(page, first.id))?.text).toBe('Ship the beta');
    expect((await getNote(page, second.id))?.color).toBe('yellow');

    // Delete it with the keyboard; the other note survives.
    await page.keyboard.press('Delete');
    await expect.poll(() => getBoard(page)).toHaveLength(1);
    board = await getBoard(page);
    expect(board[0].id).toBe(second.id);
    expect(await page.locator('[data-testid="note-toolbar"]').count()).toBe(0);

    // Backspace on nothing selected does not remove the last note.
    await page.keyboard.press('Backspace');
    expect(await getBoard(page)).toHaveLength(1);

    // And the bin button removes the survivor.
    await selectNote(page, second.id);
    await clickDeleteNote(page);
    await expect.poll(() => getBoard(page)).toHaveLength(0);
  });
});
