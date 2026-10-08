import { expect, test, type Page } from '@playwright/test';
import type { Point } from '../../src/client/canvas/camera';
import { longParagraph, SHORT_PHRASE } from '../fixtures/texts';
import { expectWithinPx, settle, setCamera } from './helpers/board';

/**
 * E2E sticky notes for story 2 (design "E2E workflows"):
 *   1. Create, type, move, recolor, delete: TC-30 -> TC-31 (50% zoom)
 *   2. Overlap and z-order at 200% zoom:     TC-32
 *   3. Long text auto-fit:                   TC-33
 *   4. Create far from the origin:           TC-34
 *
 * World positions are read through the test-only window.__vidi6.getObject
 * hook (present in the e2e test build, absent in production).
 */

const VIEWPORT = { width: 1280, height: 800 };
const CENTER: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

interface ObjState {
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** The model state of one note, read via the test hook. */
async function getObject(page: Page, id: string): Promise<ObjState> {
  const state = await page.evaluate((nid) => window.__vidi6?.getObject(nid), id);
  if (state === undefined || state === null) {
    throw new Error(`note ${id} not found via test hook`);
  }
  return state;
}

/** The id carried by the n-th rendered note element (creation order by z). */
async function noteId(page: Page, index = 0): Promise<string> {
  const id = await page.locator('[data-sticky-note]').nth(index).getAttribute('data-sticky-note');
  if (id === null) {
    throw new Error(`no note at index ${index}`);
  }
  return id;
}

function noteLocator(page: Page, id: string) {
  return page.locator(`[data-sticky-note="${id}"]`);
}

async function noteCenter(page: Page, id: string): Promise<Point> {
  const box = (await noteLocator(page, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a pointer that starts at `from` (which must be over the note). */
async function dragFrom(page: Page, from: Point, delta: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await page.goto('/');
  await page.waitForSelector('[data-testid="board-viewport"]');
});

test.describe('sticky-notes.e2e', () => {
  test('workflow 1: create, type, move at 50% zoom, recolor, delete (TC-30, TC-31)', async ({
    page,
  }) => {
    // --- TC-30: double-click creates a note centred under the cursor -----
    await page.mouse.dblclick(400, 300);
    const first = page.locator('[data-sticky-note]').first();
    await expect(first).toBeVisible();
    let centre = await noteCenter(page, await noteId(page, 0));
    expectWithinPx(centre.x, 400, 'note centre x (TC-30)');
    expectWithinPx(centre.y, 300, 'note centre y (TC-30)');

    // The new note is in edit mode: typing goes straight into it.
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();
    await page.keyboard.type(SHORT_PHRASE);
    await page.keyboard.press('Escape'); // -> Selected, text kept

    // A second note via the toolbar button (viewport centre).
    await page.getByTestId('sticky-note-button').click();
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-sticky-note]').count()).toBe(2);

    const id1 = await noteId(page, 0);
    expect((await getObject(page, id1)).text).toBe(SHORT_PHRASE);

    // --- TC-31: a 100x50 screen-px drag at 50% zoom moves the note 200x100 world ---
    await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });
    const before = await getObject(page, id1);
    const start = await noteCenter(page, id1);
    await dragFrom(page, start, { x: 100, y: 50 });
    const after = await getObject(page, id1);
    expect(after.x - before.x).toBeCloseTo(200, 6);
    expect(after.y - before.y).toBeCloseTo(100, 6);
    // The grabbed point stays under the pointer (within 1 px).
    centre = await noteCenter(page, id1);
    expectWithinPx(centre.x, start.x + 100, 'grabbed point x (TC-31)');
    expectWithinPx(centre.y, start.y + 50, 'grabbed point y (TC-31)');

    // --- Recolour ---------------------------------------------------------
    await page.mouse.click(centre.x, centre.y); // select note 1
    await page.getByTestId('note-swatch-green').click();
    expect((await getObject(page, id1)).color).toBe('green');

    // --- Delete ------------------------------------------------------------
    await page.keyboard.press('Delete');
    expect(await page.locator('[data-sticky-note]').count()).toBe(1);
    const remaining = await getObject(page, await noteId(page, 0));
    expect(remaining.color).toBe('yellow');
    expect(remaining.text).toBe('');
  });

  test('TC-32: at 200% zoom, dragging a note over another brings it in front', async ({
    page,
  }) => {
    // Zoom 200% with the world origin at the viewport centre.
    await setCamera(page, { x: -320, y: -200, zoom: 2 });

    // Two overlapping notes: A centred at world (0,0), B centred at world
    // (120,40). B's creation point is outside A's box (so the dblclick
    // creates instead of editing) but B overlaps A.
    await page.mouse.dblclick(CENTER.x, CENTER.y);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(880, 480);
    await page.keyboard.press('Escape');
    expect(await page.locator('[data-sticky-note]').count()).toBe(2);

    const idA = await noteId(page, 0); // created first: below
    const idB = await noteId(page, 1); // created second: above
    const zA0 = (await getObject(page, idA)).z;
    const zB0 = (await getObject(page, idB)).z;
    expect(zA0).toBeLessThan(zB0);

    // Grab A at a point not covered by B, drag it over B.
    const grab: Point = { x: 480, y: 300 };
    const boxA0 = (await noteLocator(page, idA).boundingBox())!;
    await dragFrom(page, grab, { x: 100, y: 50 });

    const a = await getObject(page, idA);
    const b = await getObject(page, idB);
    expect(a.z).toBeGreaterThan(b.z); // A is now in front
    // The grabbed point stayed under the pointer (box moved by exactly the drag).
    const boxA1 = (await noteLocator(page, idA).boundingBox())!;
    expectWithinPx(boxA1.x, boxA0.x + 100, 'grabbed point x (TC-32)');
    expectWithinPx(boxA1.y, boxA0.y + 50, 'grabbed point y (TC-32)');
    // And in world units: 100x50 screen px at zoom 2 is 50x25 world.
    expect(boxA0.width).toBeCloseTo(400, 6); // 200 world units at zoom 2 (sanity)
  });

  test('TC-33: long text auto-fits, shows the counter, and fades at the overflow edge', async ({
    page,
  }) => {
    await page.mouse.dblclick(CENTER.x, CENTER.y);
    const ta = page.getByTestId('sticky-textarea');
    await expect(ta).toBeVisible();

    // One word: maximum font size.
    await page.keyboard.type(SHORT_PHRASE);
    await expect(ta).toHaveCSS('font-size', '24px');
    expect(await page.getByTestId('sticky-counter').count()).toBe(0);

    // Paste exactly 1,000 characters of prose (crosses the limit: clamped).
    await page.keyboard.insertText(longParagraph());
    const id = await noteId(page, 0);
    expect((await getObject(page, id)).text.length).toBe(1000);
    await expect(page.getByTestId('sticky-counter')).toHaveText('1000/1000');
    // Shrunken to the minimum size and still overflowing: the fade appears.
    await expect(ta).toHaveCSS('font-size', '10px');
    await expect(page.getByTestId('sticky-fade')).toBeVisible();

    // Nothing is drawn outside the note box: the text box is inset by the
    // note padding and the overflow is clipped.
    const noteBox = (await noteLocator(page, id).boundingBox())!;
    const textBox = (await ta.boundingBox())!;
    expectWithinPx(textBox.x, noteBox.x + 12, 'text box left');
    expectWithinPx(textBox.x + textBox.width, noteBox.x + noteBox.width - 12, 'text box right');
    expectWithinPx(textBox.y, noteBox.y + 12, 'text box top');
    expectWithinPx(textBox.y + textBox.height, noteBox.y + noteBox.height - 12, 'text box bottom');

    // Leaving edit mode keeps the fitted size and the fade.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-note-text')).toHaveCSS('font-size', '10px');
    await expect(page.getByTestId('sticky-fade')).toBeVisible();
  });

  test('TC-34: the Sticky note button creates at the viewport centre when panned far away', async ({
    page,
  }) => {
    await setCamera(page, { x: 5000, y: 3000, zoom: 1 });
    await page.getByTestId('sticky-note-button').click();

    const id = await noteId(page, 0);
    await expect(noteLocator(page, id)).toBeVisible();
    const centre = await noteCenter(page, id);
    expectWithinPx(centre.x, 640, 'centre x (TC-34)');
    expectWithinPx(centre.y, 400, 'centre y (TC-34)');
    // The model position matches the (far) world point under the viewport centre.
    const obj = await getObject(page, id);
    expect(obj.x).toBeCloseTo(5000 + 640 - 100, 6);
    expect(obj.y).toBeCloseTo(3000 + 400 - 100, 6);
  });
});
