import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  createStickyButton,
  dblClickBoardAt,
  dragNote,
  clickSwatchIn,
  noteBox,
  noteFontSize,
  noteIds,
  noteOverflow,
  openBoard,
  pasteIntoEditor,
  readCamera,
  readNote,
  screenToWorld,
  setCamera,
} from './helpers/board';
import { PARAGRAPH_1000 } from '../fixtures/texts';

const CENTRE = { x: 640, y: 400 };

/** A view at `zoom` whose centre is the world point currently at the screen centre. */
async function zoomAroundCentre(page: import('@playwright/test').Page, zoom: number): Promise<void> {
  const cam = await readCamera(page);
  const worldCentre = screenToWorld(cam, CENTRE);
  await setCamera(page, { x: worldCentre.x - CENTRE.x / zoom, y: worldCentre.y - CENTRE.y / zoom, zoom });
}

test.describe('sticky notes', () => {
  test('TC-30 double-click creates a note centred on the click and types into it', async ({ page }) => {
    await openBoard(page);
    const cam = await readCamera(page);

    await dblClickBoardAt(page, { x: 400, y: 300 });
    const ids = await noteIds(page);
    expect(ids).toHaveLength(1);
    const id = ids[0];

    await page.keyboard.type('Hello');

    // The note is painted centred on the double-click point.
    const box = await noteBox(page, id);
    expect(Math.abs(box.cx - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - 300)).toBeLessThanOrEqual(1);
    // Its model centre is the world point under the cursor.
    const worldPoint = screenToWorld(cam, { x: 400, y: 300 });
    const state = await readNote(page, id);
    expect(state!.x + 100).toBeCloseTo(worldPoint.x, 4);
    expect(state!.y + 100).toBeCloseTo(worldPoint.y, 4);
    expect(state!.text).toBe('Hello');
  });

  test('TC-31 at 50% zoom a (100,50) drag moves the world by (200,100) and keeps the grab under the pointer', async ({ page }) => {
    await openBoard(page);
    await dblClickBoardAt(page, CENTRE);
    const id = (await noteIds(page))[0];
    await page.keyboard.type('move me');
    await page.keyboard.press('Escape');

    await zoomAroundCentre(page, 0.5);

    const before = await readNote(page, id);
    const boxBefore = await noteBox(page, id);

    await dragNote(page, { x: boxBefore.cx, y: boxBefore.cy }, { x: 100, y: 50 });

    const after = await readNote(page, id);
    // World delta equals the screen delta divided by zoom.
    expect(after!.x - before!.x).toBeCloseTo(200, 0);
    expect(after!.y - before!.y).toBeCloseTo(100, 0);
    // The grabbed point stays under the pointer: the painted box moved by the screen delta.
    const boxAfter = await noteBox(page, id);
    expect(Math.abs(boxAfter.cx - (boxBefore.cx + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.cy - (boxBefore.cy + 50))).toBeLessThanOrEqual(1);
  });

  test('TC-32 at 200% zoom a (100,50) drag moves the world by (50,25) and raises the note above an overlap', async ({ page }) => {
    await openBoard(page);
    await zoomAroundCentre(page, 2);

    // Two overlapping notes: A created first (lower), B second (on top of A).
    await dblClickBoardAt(page, { x: 500, y: 400 });
    const idA = (await noteIds(page))[0];
    await page.keyboard.press('Escape');
    await dblClickBoardAt(page, { x: 720, y: 560 });
    const idB = (await noteIds(page)).find((i) => i !== idA)!;
    await page.keyboard.press('Escape');

    const beforeA = await readNote(page, idA);
    const boxA = await noteBox(page, idA);
    // Grab a corner of A that B does not cover and drag it.
    const grab = { x: boxA.x + 30, y: boxA.y + 30 };

    await dragNote(page, grab, { x: 100, y: 50 });

    const afterA = await readNote(page, idA);
    expect(afterA!.x - beforeA!.x).toBeCloseTo(50, 0);
    expect(afterA!.y - beforeA!.y).toBeCloseTo(25, 0);
    // The dragged note is now drawn above the one it overlapped.
    expect(afterA!.z).toBeGreaterThan((await readNote(page, idB))!.z);
  });

  test('TC-33 short text uses the max font size and 1,000 pasted chars clip at the minimum with the fade', async ({ page }) => {
    await openBoard(page);
    await dblClickBoardAt(page, CENTRE);
    const id = (await noteIds(page))[0];

    await page.keyboard.type('Idea');
    expect(await noteFontSize(page, id)).toBe(STICKY_FONT_MAX_PX);

    await pasteIntoEditor(page, PARAGRAPH_1000);

    const state = await readNote(page, id);
    expect(state!.text.length).toBeLessThanOrEqual(1000);
    const font = await noteFontSize(page, id);
    expect(font).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(font).toBe(STICKY_FONT_MIN_PX);
    expect(await noteOverflow(page, id)).toBe(true);

    // Nothing renders outside the note box: the text element is clipped and inside it.
    const geom = await page
      .locator(`[data-note-id="${id}"] .vidi-note-text`)
      .evaluate((el) => ({
        overflowY: getComputedStyle(el).overflowY,
        clipped: el.scrollHeight > el.clientHeight,
      }));
    expect(geom.overflowY).toBe('hidden');
    expect(geom.clipped).toBe(true);

    const noteBoxEl = await noteBox(page, id);
    const textBox = await page.locator(`[data-note-id="${id}"] .vidi-note-text`).boundingBox();
    expect(textBox!.y).toBeGreaterThanOrEqual(noteBoxEl.y - 1);
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(noteBoxEl.y + noteBoxEl.height + 1);
  });

  test('TC-34 creating from the toolbar while panned far away shows a note at the screen centre', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });

    await createStickyButton(page).click();
    const ids = await noteIds(page);
    expect(ids).toHaveLength(1);
    const id = ids[0];

    const box = await noteBox(page, id);
    expect(Math.abs(box.cx - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - CENTRE.y)).toBeLessThanOrEqual(1);
    // And it opened straight into editing.
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();
  });

  test('golden path: create, type, move at 50%, recolour, delete', async ({ page }) => {
    await openBoard(page);

    // Create and type.
    await dblClickBoardAt(page, { x: 400, y: 300 });
    const id = (await noteIds(page))[0];
    await page.keyboard.type('Faster onboarding');
    await page.keyboard.press('Escape');
    expect((await readNote(page, id))!.text).toBe('Faster onboarding');

    // Move at 50%.
    await zoomAroundCentre(page, 0.5);
    const before = await readNote(page, id);
    const box = await noteBox(page, id);
    await dragNote(page, { x: box.cx, y: box.cy }, { x: 80, y: 40 });
    const moved = await readNote(page, id);
    expect(moved!.x - before!.x).toBeCloseTo(160, 0);
    expect(moved!.y - before!.y).toBeCloseTo(80, 0);

    // Recolour.
    await clickSwatchIn(page, id, 'pink');
    expect((await readNote(page, id))!.color).toBe('pink');

    // Delete with the keyboard.
    await page.keyboard.press('Delete');
    await expect(async () => {
      expect(await noteIds(page)).not.toContain(id);
    }).toPass();
  });
});
