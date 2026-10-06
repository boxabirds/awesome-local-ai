/**
 * sticky.interaction dragging e2e tests: the geometry of dragging a note at other zoom
 * levels, and that the board itself never pans when a drag starts on a note.
 *
 * TC-31 (50%), TC-32 (200%), plus the golden-path workflow.
 */
import { expect, test, type Page } from '@playwright/test';
import { getCamera, setCamera } from './helpers/board';
import { navigateToNewBoard } from './helpers/navigate';
import {
  dragToPoint,
  getNotes,
  noteCentre,
  noteCount,
  noteLocator,
  noteWorld,
  screenOf,
  stopEditing,
  typeIntoEditor,
  worldOfScreen,
} from './helpers/notes';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

const CENTRE = { x: 640, y: 400 };

/** Puts the camera at `zoom` with world (0,0) in the middle of the screen. */
async function centredAt(page: Page, zoom: number): Promise<void> {
  await setCamera(page, { x: -CENTRE.x / zoom, y: -CENTRE.y / zoom, zoom });
}

/** Creates a note at the centre of the view (the toolbar button always does that). */
async function createAtCentre(page: Page): Promise<void> {
  await page.getByTestId('create-sticky-button').click();
  await stopEditing(page);
}

/** Which note (its id) is drawn at a screen point. */
async function noteIdUnder(page: Page, point: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const holder = element?.closest('[data-note-id]');
    return holder ? holder.getAttribute('data-note-id') : null;
  }, point);
}

test.describe('dragging notes', () => {
  test('TC-31 at 50% a drag moves the note by the screen delta divided by the zoom', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await centredAt(page, 0.5);
    await createAtCentre(page);
    const before = await noteWorld(page, 0);
    const cameraBefore = await getCamera(page);
    const grab = await noteCentre(page, 0);

    await dragToPoint(page, grab, { x: grab.x + 100, y: grab.y + 50 });

    const after = await noteWorld(page, 0);
    expect(after.x - before.x).toBeCloseTo(100 / 0.5, 6); // +200 world units
    expect(after.y - before.y).toBeCloseTo(50 / 0.5, 6); // +100 world units

    // the point that was grabbed is still under the pointer
    const centre = await noteCentre(page, 0);
    expect(Math.abs(centre.x - (grab.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - (grab.y + 50))).toBeLessThanOrEqual(1);

    // and the board did not pan or zoom by any amount
    expect(await getCamera(page)).toEqual(cameraBefore);

    // the drag ended in the Selected state, not still dragging
    await expect(noteLocator(page, 0)).toHaveAttribute('data-selected', 'true');
    await expect(noteLocator(page, 0)).not.toHaveAttribute('data-dragging');
  });

  test('TC-32 at 200% a drag moves the note by half the screen delta and stays on top', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await centredAt(page, 2);
    await createAtCentre(page); // the note underneath
    await createAtCentre(page); // a second note, exactly overlapping and on top
    const notesBefore = await getNotes(page);
    expect(notesBefore).toHaveLength(2);
    const top = notesBefore[1];
    if (!top) throw new Error('expected two notes');

    const before = await noteWorld(page, 1);
    const cameraBefore = await getCamera(page);
    const grab = await noteCentre(page, 1);

    await dragToPoint(page, grab, { x: grab.x + 100, y: grab.y + 50 });

    const after = await noteWorld(page, 1);
    expect(after.x - before.x).toBeCloseTo(100 / 2, 6); // +50 world units
    expect(after.y - before.y).toBeCloseTo(50 / 2, 6); // +25 world units
    expect(await getCamera(page)).toEqual(cameraBefore);

    // where the two notes still overlap, the dragged note is drawn above the other one
    const overlapped = await screenOf(page, {
      x: after.x + STICKY_SIZE_WORLD * 0.2,
      y: after.y + STICKY_SIZE_WORLD * 0.2,
    });
    expect(await noteIdUnder(page, overlapped)).toBe(top.id);
  });

  test('a drag that ends outside the note still leaves it exactly where the pointer was', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await centredAt(page, 0.5);
    await createAtCentre(page);
    const before = await noteWorld(page, 0);
    const grab = await noteCentre(page, 0);

    // press on the note, leave it, and release near the edge of the window
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 200, grab.y + 60, { steps: 6 });
    await page.mouse.move(4, 4, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const after = await noteWorld(page, 0);
    expect(after.x - before.x).toBeCloseTo((4 - grab.x) / 0.5, 6);
    expect(after.y - before.y).toBeCloseTo((4 - grab.y) / 0.5, 6);

    // the drag is over: no lingering "dragging" state and no further movement
    await expect(noteLocator(page, 0)).not.toHaveAttribute('data-dragging');
    const settled = await noteWorld(page, 0);
    expect(settled).toEqual(after);
    expect(await noteCount(page)).toBe(1);
  });

  test('a two pixel press on a note selects it without moving it, three pixels drags it', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);
    const before = await noteWorld(page, 0);
    const cameraBefore = await getCamera(page);
    const grab = await noteCentre(page, 0);

    await dragToPoint(page, grab, { x: grab.x + 2, y: grab.y }, 2);
    expect(await noteWorld(page, 0)).toEqual(before); // still a click
    expect(await getCamera(page)).toEqual(cameraBefore);

    await dragToPoint(page, grab, { x: grab.x + 3, y: grab.y }, 3);
    const moved = await noteWorld(page, 0);
    expect(moved.x - before.x).toBeCloseTo(3, 6); // 100% zoom: 3 world units
    expect(await getCamera(page)).toEqual(cameraBefore); // the board never panned
  });
});

test.describe('note toolbar at different zoom levels', () => {
  test('the toolbar of the selected note keeps the same size on screen', async ({ page }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);

    const sizes: { zoom: number; height: number; swatch: number }[] = [];
    for (const zoom of [0.5, 1, 2]) {
      await centredAt(page, zoom);
      const toolbar = await page.getByTestId('note-toolbar').boundingBox();
      const swatch = await page.getByLabel('Yellow colour').boundingBox();
      if (!toolbar || !swatch) throw new Error('the note toolbar is not visible');
      sizes.push({ zoom, height: toolbar.height, swatch: swatch.width });
    }

    // the toolbar is counter-scaled: the same pixels at 50%, 100% and 200%
    const [first] = sizes;
    if (!first) throw new Error('no measurements');
    for (const measured of sizes) {
      expect(Math.abs(measured.height - first.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(measured.swatch - first.swatch)).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('golden path', () => {
  test('TC-30 -> TC-31 -> colour -> delete leaves exactly the expected board', async ({
    page,
  }) => {
    await navigateToNewBoard(page);

    // TC-30: create by double-click and type
    await page.mouse.dblclick(400, 300);
    await typeIntoEditor(page, 'Faster onboarding');
    await stopEditing(page);

    // TC-31: drag it by (100,50) screen px at 50% - the world delta is twice as big
    await centredAt(page, 0.5);
    const before = await noteWorld(page, 0);
    const grab = await noteCentre(page, 0);
    await dragToPoint(page, grab, { x: grab.x + 100, y: grab.y + 50 });
    const moved = await noteWorld(page, 0);
    expect(moved.x - before.x).toBeCloseTo(200, 6);
    expect(moved.y - before.y).toBeCloseTo(100, 6);

    // a second note somewhere else on screen, coloured green
    await centredAt(page, 1);
    const secondSpot = { x: 1050, y: 180 };
    await page.mouse.dblclick(secondSpot.x, secondSpot.y);
    await typeIntoEditor(page, 'Keep a checklist');
    await stopEditing(page);
    await page.getByLabel('Green colour').click();

    // delete the first note: select it, then press Delete
    const first = (await getNotes(page)).find((note) => note.text === 'Faster onboarding');
    if (!first) throw new Error('the first note is missing');
    const firstCentre = await screenOf(page, {
      x: first.x + STICKY_SIZE_WORLD / 2,
      y: first.y + STICKY_SIZE_WORLD / 2,
    });
    await page.mouse.click(firstCentre.x, firstCentre.y);
    await page.keyboard.press('Delete');

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe('Keep a checklist');
    expect(notes[0]?.color).toBe('green');
    const expectedCentre = await worldOfScreen(page, secondSpot);
    expect(notes[0]?.x).toBeCloseTo(expectedCentre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.y).toBeCloseTo(expectedCentre.y - STICKY_SIZE_WORLD / 2, 6);
  });
});
