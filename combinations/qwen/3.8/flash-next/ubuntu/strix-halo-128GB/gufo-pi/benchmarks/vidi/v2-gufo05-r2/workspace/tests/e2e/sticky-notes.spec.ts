import { expect, test } from '@playwright/test';

import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  expectNoPendingCameraFrame,
  openBoard,
  setCamera,
  VIEWPORT_SIZE,
  withinTolerance,
} from './helpers/board';
import {
  createNoteByDblClick,
  dragPointer,
  endEditing,
  exposedPoint,
  getNotes,
  noteBoxes,
  pasteIntoEditor,
  typeIntoEditor,
} from './helpers/notes';
import { PROSE_1000 } from '../fixtures/texts';

const HALF = STICKY_SIZE_WORLD / 2;

/** Centre the camera on a world point at a given zoom. */
function centreCamera(worldX: number, worldY: number, zoom: number) {
  return {
    x: worldX - VIEWPORT_SIZE.width / (2 * zoom),
    y: worldY - VIEWPORT_SIZE.height / (2 * zoom),
    zoom,
  };
}

test.describe('sticky notes', () => {
  test('workflow: brainstorm golden path (create, type, recolour, move at 50%, delete)', async ({
    page,
  }) => {
    await openBoard(page);

    // TC-30: double-click creates a note centred on the point, editing active.
    const id = await createNoteByDblClick(page, { x: 400, y: 300 });
    const created = (await noteBoxes(page))[id]!;
    expect(withinTolerance(created.x + created.width / 2, 400)).toBe(true);
    expect(withinTolerance(created.y + created.height / 2, 300)).toBe(true);

    await typeIntoEditor(page, 'Hello');
    await expect(page.locator(`[data-note-id="${id}"] textarea`)).toHaveValue('Hello');
    await endEditing(page);
    await expect(page.locator(`[data-note-id="${id}"]`)).toContainText('Hello');

    // Recolour to green from the toolbar; text and position are unchanged.
    const posBefore = (await getNotes(page)).find((n) => n.id === id)!;
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expectNoPendingCameraFrame(page);
    const recoloured = (await getNotes(page)).find((n) => n.id === id)!;
    expect(recoloured.color).toBe('green');
    expect(recoloured.text).toBe('Hello');
    expect(recoloured.x).toBe(posBefore.x);
    expect(recoloured.y).toBe(posBefore.y);

    // TC-31: at 50% zoom a drag moves the note under the pointer (world +200,+100).
    const world = recoloured;
    await setCamera(page, centreCamera(world.x + HALF, world.y + HALF, 0.5));
    const boxBefore = (await noteBoxes(page))[id]!;
    const from = { x: boxBefore.x + boxBefore.width / 2, y: boxBefore.y + boxBefore.height / 2 };
    const to = { x: from.x + 100, y: from.y + 50 };
    await dragPointer(page, from, to);

    const moved = (await getNotes(page)).find((n) => n.id === id)!;
    expect(withinTolerance(moved.x - world.x, 200, 3)).toBe(true);
    expect(withinTolerance(moved.y - world.y, 100, 3)).toBe(true);
    const boxAfter = (await noteBoxes(page))[id]!;
    expect(withinTolerance(boxAfter.x - boxBefore.x, 100)).toBe(true);
    expect(withinTolerance(boxAfter.y - boxBefore.y, 50)).toBe(true);

    // Delete removes it; the board ends empty.
    await page.keyboard.press('Delete');
    await expectNoPendingCameraFrame(page);
    expect(await getNotes(page)).toHaveLength(0);
  });

  test('TC-32: at 200% zoom a drag moves the note world +50,+25 and brings it to front', async ({
    page,
  }) => {
    await openBoard(page);
    const a = await createNoteByDblClick(page, { x: 520, y: 400 });
    await typeIntoEditor(page, 'A');
    await endEditing(page);
    const b = await createNoteByDblClick(page, { x: 660, y: 470 });
    await typeIntoEditor(page, 'B');
    await endEditing(page);

    // B was created later, so it starts above A.
    let notes = await getNotes(page);
    const zA0 = notes.find((n) => n.id === a)!.z;
    const zB0 = notes.find((n) => n.id === b)!.z;
    expect(zA0).toBeLessThan(zB0);

    // Zoom to 200%, centred between the two notes.
    const before = (await getNotes(page)).find((n) => n.id === a)!;
    const other = (await getNotes(page)).find((n) => n.id === b)!;
    const midX = (before.x + other.x) / 2 + HALF;
    const midY = (before.y + other.y) / 2 + HALF;
    await setCamera(page, centreCamera(midX, midY, 2));

    const boxes = await noteBoxes(page);
    // Grab A at a point it owns alone, so the press targets A (not the B on top).
    const grab = exposedPoint(boxes[a]!, boxes[b]!);
    const aBoxBefore = boxes[a]!;
    await dragPointer(page, grab, { x: grab.x + 100, y: grab.y + 50 });

    notes = await getNotes(page);
    const aMoved = notes.find((n) => n.id === a)!;
    // 200% zoom: a 100x50px drag is 50x25 world units.
    expect(withinTolerance(aMoved.x - before.x, 50, 3)).toBe(true);
    expect(withinTolerance(aMoved.y - before.y, 25, 3)).toBe(true);
    // The dragged note is now drawn above the note it overlaps.
    expect(aMoved.z).toBeGreaterThan(zB0);
    // The note followed the pointer on screen exactly.
    const aBoxAfter = (await noteBoxes(page))[a]!;
    expect(withinTolerance(aBoxAfter.x - aBoxBefore.x, 100)).toBe(true);
    expect(withinTolerance(aBoxAfter.y - aBoxBefore.y, 50)).toBe(true);
  });

  test('TC-33: text auto-fits from 24px then clips with a bottom fade at the limit', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNoteByDblClick(page, { x: 640, y: 400 });
    const editor = page.locator(`[data-note-id="${id}"] textarea`);

    await typeIntoEditor(page, 'Idea');
    await expectNoPendingCameraFrame(page);
    const oneWord = await editor.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(oneWord)).toBeCloseTo(STICKY_FONT_MAX_PX, 0);

    await pasteIntoEditor(page, id, PROSE_1000);
    const long = await editor.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(long)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(parseFloat(long)).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);

    // The bottom fade shows and the note clips: nothing renders outside it.
    await expect(page.locator(`[data-note-id="${id}"] .sticky-note__edit.is-overflow`)).toHaveCount(
      1,
    );
    const noteOverflow = await page
      .locator(`[data-note-id="${id}"]`)
      .evaluate((el) => getComputedStyle(el).overflow);
    expect(noteOverflow).toBe('hidden');

    // The counter reports the exact character count at the limit.
    await expect(page.getByTestId('sticky-counter')).toHaveText('1000/1000');
  });

  test('TC-34: the toolbar creates a note at the centre of the view, even far from the start', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 500_000, y: 500_000, zoom: 1 });

    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expectNoPendingCameraFrame(page);

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    const box = (await noteBoxes(page))[notes[0]!.id]!;
    expect(withinTolerance(box.x + box.width / 2, VIEWPORT_SIZE.width / 2)).toBe(true);
    expect(withinTolerance(box.y + box.height / 2, VIEWPORT_SIZE.height / 2)).toBe(true);
  });
});
