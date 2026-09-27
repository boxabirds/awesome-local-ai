/**
 * E2E sticky-note workflows (story 2): create by double-click, move at 50%/200%
 * zoom, recolour, delete, long-text fit, and toolbar creation far from origin.
 *
 * A note's world position is derived from its on-screen bounding box and the
 * camera (`window.__vidi6.getCamera()`, test builds only):
 *   world = screen / zoom + camera.xy
 *
 * Notes are addressed by their `data-note-id`, because z-order changes when a
 * note is dragged to the front.
 */
import { expect, test, type Page } from '@playwright/test';
import { PROSE_1000 } from '../fixtures/texts';
import { STICKY_SIZE_WORLD, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

const notes = (page: Page) => page.locator('[data-testid="sticky-note"]');
const noteById = (page: Page, id: string) =>
  page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);

const getCamera = (page: Page): Promise<CameraState> =>
  page.evaluate(() => window.__vidi6!.getCamera());

const setCamera = async (page: Page, camera: CameraState): Promise<void> => {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), camera);
  // The camera reaches the DOM through React; wait for the world layer to catch up
  // so a measurement (or a press) is never aimed at a stale position.
  await page.waitForFunction(
    (z) =>
      document
        .querySelector('[data-testid="board-world"]')
        ?.getAttribute('style')
        ?.includes(`scale(${z})`) ?? false,
    camera.zoom,
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
};

/** Wait until a note's centre stops moving between two frames. */
const settledCentre = async (page: Page, id: string): Promise<{ x: number; y: number }> => {
  let previous = await noteCentre(page, id);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    const current = await noteCentre(page, id);
    if (Math.abs(current.x - previous.x) < 0.5 && Math.abs(current.y - previous.y) < 0.5) {
      return current;
    }
    previous = current;
  }
  return previous;
};

/** The id of the nth note in render order (bottom-most first). */
const noteId = (page: Page, index = 0): Promise<string> =>
  notes(page).nth(index).getAttribute('data-note-id') as Promise<string>;

const centreOf = async (locator: ReturnType<typeof noteById>): Promise<{ x: number; y: number }> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('note has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const noteCentre = (page: Page, id: string) => centreOf(noteById(page, id));

/** Centre of a note in world coordinates (camera-aware). */
const noteWorldCentre = async (page: Page, id: string): Promise<{ x: number; y: number }> => {
  const screen = await noteCentre(page, id);
  const cam = await getCamera(page);
  return { x: screen.x / cam.zoom + cam.x, y: screen.y / cam.zoom + cam.y };
};

/** Camera that puts world (0,0) at the centre of the 1280x800 viewport. */
const centredCamera = (zoom: number): CameraState => ({
  x: -640 / zoom,
  y: -400 / zoom,
  zoom,
});

/** Drag from `from` by (dx, dy) screen pixels, in several steps. */
const dragBy = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i += 1) {
    await page.mouse.move(from.x + (dx * i) / 5, from.y + (dy * i) / 5);
  }
  await page.mouse.up();
};

/** The ids of every note currently rendered. */
const allNoteIds = (page: Page): Promise<string[]> =>
  notes(page).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.noteId ?? ''));

/** Double-click empty board space and type, leaving the note in edit mode. */
const createNoteByDouble = async (page: Page, x: number, y: number, text: string): Promise<string> => {
  const before = await allNoteIds(page);
  await page.mouse.dblclick(x, y);
  await expect(notes(page)).toHaveCount(before.length + 1);
  // Render order is sorted by id, so the new note is found by set difference.
  const [created] = (await allNoteIds(page)).filter((id) => !before.includes(id));
  if (!created) throw new Error('the new note did not appear');
  await page.keyboard.type(text);
  return created;
};

const deselect = async (page: Page): Promise<void> => {
  await page.mouse.click(1180, 760);
  await expect(notes(page).first()).toHaveAttribute('data-selected', 'false');
};

test.describe('sticky notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  test('TC-30 golden path: double-click creates a centred note, typing lands in it', async ({
    page,
  }) => {
    const id = await createNoteByDouble(page, 400, 300, 'Hello');

    // Centred on the double-click point (+/- 1 px).
    const centre = await noteCentre(page, id);
    expect(Math.abs(centre.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - 300)).toBeLessThanOrEqual(1);

    // Click empty board space: editing ends, text kept, nothing selected.
    await page.mouse.click(900, 600);
    await expect(noteById(page, id)).toContainText('Hello');
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'false');

    // Recolour green; text and position unchanged.
    await page.mouse.click(centre.x, centre.y);
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'true');
    await page.getByLabel('Green colour').click();
    await expect(noteById(page, id)).toHaveCSS('background-color', 'rgb(197, 225, 165)');
    await expect(noteById(page, id)).toContainText('Hello');
    const afterColour = await noteCentre(page, id);
    expect(Math.abs(afterColour.x - centre.x)).toBeLessThanOrEqual(1);

    // Delete with the keyboard.
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-31: dragging at 50% zoom keeps the grabbed point under the pointer', async ({
    page,
  }) => {
    const id = await createNoteByDouble(page, 640, 400, 'move me');
    await deselect(page);

    await setCamera(page, centredCamera(0.5));
    const before = await settledCentre(page, id);
    const worldBefore = await noteWorldCentre(page, id);

    await dragBy(page, before, 100, 50);

    // Pointer invariance: the note moved exactly with the pointer.
    const after = await noteCentre(page, id);
    expect(Math.abs(after.x - (before.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 50))).toBeLessThanOrEqual(1);

    // World-space delta is the screen delta divided by the 0.5 zoom.
    const worldAfter = await noteWorldCentre(page, id);
    expect(Math.abs(worldAfter.x - (worldBefore.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(worldAfter.y - (worldBefore.y + 100))).toBeLessThanOrEqual(1);

    // Dragging a note never pans or zooms the board.
    const cam = await getCamera(page);
    expect(cam.zoom).toBe(0.5);
    expect(cam.x).toBeCloseTo(-1280, 6);
    expect(cam.y).toBeCloseTo(-800, 6);

    // The text is untouched.
    await expect(noteById(page, id)).toContainText('move me');
  });

  test('TC-32: dragging at 200% zoom stacks the note above the one it overlaps', async ({
    page,
  }) => {
    const under = await createNoteByDouble(page, 500, 350, 'under');
    await deselect(page);
    const dragged = await createNoteByDouble(page, 700, 450, 'dragged');
    await deselect(page);

    await setCamera(page, centredCamera(2));
    const worldBefore = await noteWorldCentre(page, dragged);
    const start = await settledCentre(page, dragged);
    const target = await settledCentre(page, under);
    // Drag it exactly onto the other note: 400x200 screen px at 200% zoom.
    await dragBy(page, start, target.x - start.x, target.y - start.y);

    const worldAfter = await noteWorldCentre(page, dragged);
    expect(Math.abs(worldAfter.x - (worldBefore.x + (target.x - start.x) / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(worldAfter.y - (worldBefore.y + (target.y - start.y) / 2))).toBeLessThanOrEqual(1);

    // It now covers the other note's centre and is painted on top there.
    const topId = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[data-testid="sticky-note"]')?.getAttribute('data-note-id') ?? null;
    }, [target.x, target.y]);
    expect(topId).toBe(dragged);

    // The drag changed depth only: same colour, same world size, text intact.
    await expect(noteById(page, dragged)).toHaveCSS('background-color', 'rgb(255, 245, 157)');
    await expect(noteById(page, dragged)).toContainText('dragged');
    const box = await noteById(page, dragged).boundingBox();
    expect(Math.abs(box!.width - STICKY_SIZE_WORLD * 2)).toBeLessThanOrEqual(1);
    await expect(noteById(page, under)).toContainText('under');
  });

  test('TC-33: one word renders at the maximum font; 1,000 characters shrink and fade', async ({
    page,
  }) => {
    const id = await createNoteByDouble(page, 640, 400, 'Idea');
    await page.mouse.click(1180, 760);
    await expect(noteById(page, id).locator('.sticky-note-text')).toHaveCSS(
      'font-size',
      `${STICKY_FONT_MAX_PX}px`,
    );

    // Edit again and insert 1,000 characters of prose.
    const centre = await noteCentre(page, id);
    await page.mouse.dblclick(centre.x, centre.y);
    await page.keyboard.insertText(PROSE_1000);
    await page.keyboard.press('Escape');

    const size = await noteById(page, id)
      .locator('.sticky-note-text')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThan(STICKY_FONT_MAX_PX);

    // The overflow fade appears and nothing is drawn outside the note box.
    await expect(noteById(page, id).locator('[data-testid="sticky-note-fade"]')).toBeVisible();
    const noteBox = await noteById(page, id).boundingBox();
    const textBox = await noteById(page, id).locator('.sticky-note-text').boundingBox();
    if (noteBox && textBox) {
      expect(textBox.x).toBeGreaterThanOrEqual(noteBox.x - 1);
      expect(textBox.y).toBeGreaterThanOrEqual(noteBox.y - 1);
      expect(textBox.x + textBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width + 1);
      expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 1);
    } else {
      throw new Error('expected both note and text boxes');
    }
  });

  test('TC-34: the toolbar creates a note at the screen centre even when panned far away', async ({
    page,
  }) => {
    await setCamera(page, { x: 123_456, y: -98_765, zoom: ZOOM_STEP_FACTOR });
    await page.getByLabel('Sticky note').click();
    await expect(notes(page)).toHaveCount(1);
    const id = await noteId(page);
    await page.keyboard.type('far away');

    const centre = await noteCentre(page, id);
    expect(Math.abs(centre.x - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - 400)).toBeLessThanOrEqual(1);
    await expect(noteById(page, id).locator('.sticky-note-text')).toContainText('far away');

    // Note size is a world constant: screen size = world size * zoom.
    const box = await noteById(page, id).boundingBox();
    const cam = await getCamera(page);
    expect(Math.abs(box!.width - STICKY_SIZE_WORLD * cam.zoom)).toBeLessThanOrEqual(1);
  });

  test('brainstorm workflow: create, move at 50%, recolour, delete the duplicate', async ({
    page,
  }) => {
    const first = await createNoteByDouble(page, 300, 300, 'Faster onboarding');
    await deselect(page);
    const duplicate = await createNoteByDouble(page, 900, 300, 'Faster onboarding');
    await deselect(page);
    await expect(notes(page)).toHaveCount(2);

    // Move the first note at 50% zoom.
    await setCamera(page, centredCamera(0.5));
    const before = await settledCentre(page, first);
    await dragBy(page, before, 120, 60);
    const after = await noteCentre(page, first);
    expect(Math.abs(after.x - (before.x + 120))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 60))).toBeLessThanOrEqual(1);

    // Recolour it blue, then delete the duplicate.
    await page.mouse.click(after.x, after.y);
    await page.getByLabel('Blue colour').click();
    await expect(noteById(page, first)).toHaveCSS('background-color', 'rgb(144, 202, 249)');

    // Delete the duplicate: it is selected on its own, then removed with Delete.
    const dupCentre = await settledCentre(page, duplicate);
    await page.mouse.click(dupCentre.x, dupCentre.y);
    await expect(noteById(page, duplicate)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(noteById(page, first)).toContainText('Faster onboarding');
    await expect(noteById(page, first)).toHaveCSS('background-color', 'rgb(144, 202, 249)');
  });
});
