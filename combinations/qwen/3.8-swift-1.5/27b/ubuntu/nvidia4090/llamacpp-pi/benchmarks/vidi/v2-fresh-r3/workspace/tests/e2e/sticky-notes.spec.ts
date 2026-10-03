import { test, expect } from '@playwright/test';
import {
  setCamera,
  waitForZoom,
  getNotesState,
  noteBox,
  noteDomOrder,
  createNoteViaToolbar,
  createNoteAtScreen,
  selectNoteAtScreen,
  dragScreen,
  openBoardPath,
} from './helpers/board';

test.describe('sticky.e2e (@playwright/test, chromium)', () => {
  test('TC-30: toolbar button creates a note at the viewport centre (zoom 1); text is kept', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    const { width: VP_W, height: VP_H } = page.viewportSize()!;
    await createNoteViaToolbar(page, 'Idea 1');

    const [note] = await getNotesState(page);
    expect(note.text).toBe('Idea 1');

    // Centre of the visible board area (world == screen at zoom 1, camera 0,0)
    const cx = note.x + 100; // note centre = top-left + 100
    const cy = note.y + 100;
    expect(Math.abs(cx - VP_W / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(cy - VP_H / 2)).toBeLessThanOrEqual(2);
  });

  test('TC-31: drag at zoom 0.5 — 100px screen drag moves the note 200 world units; text kept', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    await setCamera(page, 0, 0, 0.5);
    await waitForZoom(page, 0.5);
    await createNoteViaToolbar(page, 'Dragged');

    const [before] = await getNotesState(page);
    const box = await noteBox(page, before.id);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 100px screen drag at zoom 0.5 → 200 world units
    await dragScreen(page, cx, cy, 100, 0);

    const [after] = await getNotesState(page);
    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(0, 1);
    expect(after.text).toBe('Dragged');
  });

  test('TC-32: double-click empty space at zoom 0.5 → note centred at the clicked world point', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    await setCamera(page, 0, 0, 0.5);
    await waitForZoom(page, 0.5);

    // 100 world units from the origin == 50px screen at zoom 0.5
    // (y=100 screen keeps the click clear of the left toolbar)
    await createNoteAtScreen(page, 50, 100, 'Hi');

    const [note] = await getNotesState(page);
    expect(note.text).toBe('Hi');
    // Note centre ≈ (100, 200) world: 100 world units from the origin (±2)
    const cx = note.x + 100;
    const cy = note.y + 100;
    expect(Math.abs(cx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(cy - 200)).toBeLessThanOrEqual(2);
  });

  test('TC-33: dragging the second note over the first → second on top; first unmoved; texts kept', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    await createNoteViaToolbar(page, 'First'); // centre (640,400)
    await createNoteAtScreen(page, 900, 400, 'Second'); // centre (900,400)

    const [a, b] = await getNotesState(page);
    expect(a.text).toBe('First');
    expect(b.text).toBe('Second');
    const aPosBefore = { x: a.x, y: a.y };

    // Drag the second note 200px left over the first
    const box = await noteBox(page, b.id);
    await dragScreen(page, box.x + box.width / 2, box.y + box.height / 2, -200, 0);

    const order = await noteDomOrder(page);
    // DOM order = z-order: the dragged (second) note is now on top
    expect(order.indexOf(b.id)).toBeGreaterThan(order.indexOf(a.id));

    const [aAfter] = (await getNotesState(page)).filter((n) => n.id === a.id);
    expect(aAfter.x).toBeCloseTo(aPosBefore.x, 1);
    expect(aAfter.y).toBeCloseTo(aPosBefore.y, 1);

    const states = await getNotesState(page);
    expect(states.find((n) => n.id === a.id)!.text).toBe('First');
    expect(states.find((n) => n.id === b.id)!.text).toBe('Second');
  });

  test('TC-34: blue swatch → second note blue; first note unchanged', async ({ page }) => {
    await openBoardPath(page.context().request, page);
    await createNoteViaToolbar(page, 'First');
    await createNoteAtScreen(page, 900, 400, 'Second');

    const [, b] = await getNotesState(page);
    await selectNoteAtScreen(page, 900, 400);

    await page.getByLabel('Blue colour').click();

    const bBg = await page.locator(`[data-note-id="${b.id}"]`).evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    expect(bBg).toBe('rgb(144, 202, 249)'); // #90CAF9 (blue)

    const [a] = (await getNotesState(page)).filter((n) => n.id !== b.id);
    const aBg = await page.locator(`[data-note-id="${a.id}"]`).evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    expect(aBg).toBe('rgb(255, 245, 157)'); // #FFF59D (yellow, unchanged)
    expect(a.text).toBe('First');
  });

  test('TC-39: select first note, press Delete → first removed; second untouched', async ({
    page,
  }) => {
    await openBoardPath(page.context().request, page);
    await createNoteViaToolbar(page, 'First');
    await createNoteAtScreen(page, 900, 400, 'Second');

    await selectNoteAtScreen(page, 640, 400);
    await page.keyboard.press('Delete');

    const states = await getNotesState(page);
    expect(states).toHaveLength(1);
    expect(states[0].text).toBe('Second');
  });

  test('TC-40: 50 notes; typing affects only the selected note', async ({ page }) => {
    await openBoardPath(page.context().request, page);
    // Zoom out so a 10×5 grid of 200px notes (300 world spacing) fits on screen
    await setCamera(page, 0, 0, 0.4);
    await waitForZoom(page, 0.4);

    for (let i = 0; i < 50; i++) {
      const worldX = 200 + 300 * (i % 10);
      const worldY = 200 + 300 * Math.floor(i / 10);
      await createNoteAtScreen(page, worldX * 0.4, worldY * 0.4);
    }
    let states = await getNotesState(page);
    expect(states).toHaveLength(50);

    // Select the note centred at world (1400,800), start editing, type
    await selectNoteAtScreen(page, 1400 * 0.4, 800 * 0.4);
    await page.keyboard.press('Enter');
    await page.getByTestId('sticky-textarea').waitFor();
    await page.keyboard.type('Target');
    await page.keyboard.press('Escape');

    states = await getNotesState(page);
    const withText = states.filter((n) => n.text === 'Target');
    expect(withText).toHaveLength(1);
    const empty = states.filter((n) => n.text === '');
    expect(empty).toHaveLength(49);
  });
});
