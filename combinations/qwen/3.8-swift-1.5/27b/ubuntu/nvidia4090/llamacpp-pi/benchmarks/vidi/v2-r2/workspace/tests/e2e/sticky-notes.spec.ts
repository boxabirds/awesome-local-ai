import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera, openBoard } from './helpers/board';
import { SHORT_PHRASE, RETRO_ITEM, THOUSAND_CHAR_PARAGRAPH } from '../fixtures/texts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import type { StickySnapshot } from '../../src/shared/board-model';

const noteSelector = '[data-note-id]';
const editorSelector = '[data-testid="sticky-editor"]';

async function boardSnapshot(page: Page): Promise<readonly StickySnapshot[]> {
  return page.evaluate(() => (window as unknown as { __vidi6: { snapshot(): StickySnapshot[] } }).__vidi6.snapshot());
}

async function noteBox(page: Page, index = 0) {
  const box = await page.locator(noteSelector).nth(index).boundingBox();
  if (!box) throw new Error('note not found');
  return box;
}

function centerOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Screen centre of a note, given the camera. */
function noteScreenCenter(cam: Camera, n: StickySnapshot) {
  return {
    x: (n.x + STICKY_SIZE_WORLD / 2 - cam.x) * cam.zoom,
    y: (n.y + STICKY_SIZE_WORLD / 2 - cam.y) * cam.zoom,
  };
}

/** Id of the snapshot note whose screen centre is closest to (x, y). */
function noteIdNearest(notes: readonly StickySnapshot[], cam: Camera, x: number, y: number): string {
  let best: StickySnapshot | undefined;
  let bestDist = Infinity;
  for (const n of notes) {
    const c = noteScreenCenter(cam, n);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  if (!best) throw new Error('no notes');
  return best.id;
}

/** DOM index of the note whose screen centre is closest to (x, y). */
async function noteIndexNearest(page: Page, x: number, y: number): Promise<number> {
  const count = await page.locator(noteSelector).count();
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const c = centerOf(await noteBox(page, i));
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

test.describe('sticky-notes (ui-e2e)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    await setCamera(page, -640, -400, 1);
  });

  test('TC-30: dblclick at (400,300) then type "Hello" → note centred at (400,300) ±1px with text', async ({
    page,
  }) => {
    await page.mouse.dblclick(400, 300);

    const box = await noteBox(page);
    const c = centerOf(box);
    expect(Math.abs(c.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - 300)).toBeLessThanOrEqual(1);

    await page.keyboard.type('Hello');
    await expect(page.locator(editorSelector)).toHaveValue('Hello');
    await page.keyboard.press('Escape');
    await expect(page.locator(noteSelector)).toContainText('Hello');
  });

  test('TC-31: at 50% zoom drag by (100,50) → grabbed point stays under pointer ±1px, world +200,+100; recolour via swatch; delete via Delete key leaves the other note', async ({
    page,
  }) => {
    await setCamera(page, -640, -400, 0.5);

    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(760, 560);
    await page.keyboard.press('Escape');

    const cam: Camera = { x: -640, y: -400, zoom: 0.5 };
    const before = await boardSnapshot(page);
    expect(before).toHaveLength(2);
    const aId = noteIdNearest(before, cam, 400, 300);
    const bId = noteIdNearest(before, cam, 760, 560);
    expect(aId).not.toBe(bId);
    const aBefore = before.find((n) => n.id === aId)!;

    const aBox = await noteBox(page, await noteIndexNearest(page, 400, 300));
    const start = centerOf(aBox);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 10 });
    await page.mouse.up();

    // Grabbed point stays under the pointer (screen space, ±1px).
    const aBoxAfter = await noteBox(page, await noteIndexNearest(page, start.x + 100, start.y + 50));
    const cAfter = centerOf(aBoxAfter);
    expect(Math.abs(cAfter.x - (start.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(cAfter.y - (start.y + 50))).toBeLessThanOrEqual(1);

    // World position moved +200,+100 at 50% zoom.
    const after = await boardSnapshot(page);
    const aAfter = after.find((n) => n.id === aId)!;
    expect(aAfter.x - aBefore.x).toBeCloseTo(200, 5);
    expect(aAfter.y - aBefore.y).toBeCloseTo(100, 5);

    // Recolour via swatch (the note is selected after the drag).
    await page.getByLabel('Blue colour').click();
    const recoloured = await boardSnapshot(page);
    expect(recoloured.find((n) => n.id === aId)!.color).toBe('blue');

    // Delete via the Delete key → only the other note remains.
    await page.keyboard.press('Delete');
    const final = await boardSnapshot(page);
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe(bId);
  });

  test('TC-32: at 200% zoom drag (100,50) → world +50,+25 and the dragged note is drawn above the overlapped note', async ({
    page,
  }) => {
    await setCamera(page, -640, -400, 2);

    // Two notes edge-to-edge at 200% zoom (400 screen px wide each); the
    // (100,50) drag below moves A +50,+25 world units so that it overlaps B.
    await page.mouse.dblclick(440, 400);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(840, 400);
    await page.keyboard.press('Escape');

    const cam: Camera = { x: -640, y: -400, zoom: 2 };
    const before = await boardSnapshot(page);
    expect(before).toHaveLength(2);
    const aId = noteIdNearest(before, cam, 440, 400);
    const bId = noteIdNearest(before, cam, 840, 400);
    const aBefore = before.find((n) => n.id === aId)!;
    const bBefore = before.find((n) => n.id === bId)!;
    expect(aBefore.z).toBeLessThan(bBefore.z); // the second note starts on top

    const aBox = await noteBox(page, await noteIndexNearest(page, 440, 400));
    const start = centerOf(aBox);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 10 });
    await page.mouse.up();

    const after = await boardSnapshot(page);
    const aAfter = after.find((n) => n.id === aId)!;
    const bAfter = after.find((n) => n.id === bId)!;
    expect(aAfter.x - aBefore.x).toBeCloseTo(50, 5);
    expect(aAfter.y - aBefore.y).toBeCloseTo(25, 5);
    // Dragged to the front: drawn above the overlapped note.
    expect(aAfter.z).toBeGreaterThan(bAfter.z);
  });

  test('TC-33: long text → 1 word at MAX font; 1,000 chars at ≥ MIN font with overflow fade; nothing rendered outside the note box', async ({
    page,
  }) => {
    // One word → the maximum font size.
    await page.mouse.dblclick(500, 350);
    await page.keyboard.type(SHORT_PHRASE);
    await expect(page.locator(editorSelector)).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-text"]')).toHaveCSS(
      'font-size',
      `${STICKY_FONT_MAX_PX}px`
    );

    // Paste the 1,000-char prose fixture → shrinks to the minimum, fades.
    await page.locator(noteSelector).dblclick();
    await page.keyboard.insertText(THOUSAND_CHAR_PARAGRAPH);
    await page.keyboard.press('Escape');

    const text = page.locator('[data-testid="sticky-text"]');
    const fontSize = await text.evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(parseFloat(fontSize)).toBeLessThan(STICKY_FONT_MAX_PX);

    await expect(page.locator('[data-testid="sticky-fade"]')).toBeVisible();

    // Nothing is rendered outside the note box.
    const nBox = await noteBox(page);
    const textBox = await text.boundingBox();
    expect(textBox).not.toBeNull();
    expect(textBox!.x).toBeGreaterThanOrEqual(nBox.x - 1);
    expect(textBox!.y).toBeGreaterThanOrEqual(nBox.y - 1);
    expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(nBox.x + nBox.width + 1);
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(nBox.y + nBox.height + 1);
  });

  test('TC-34: pan far away, click Sticky note → note visible at screen centre', async ({ page }) => {
    // Pan far away from the origin using the test hook.
    await setCamera(page, -9000, -7000, 1);

    await page.getByLabel('Sticky note').click();

    const box = await noteBox(page);
    const c = centerOf(box);
    expect(Math.abs(c.x - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - 400)).toBeLessThanOrEqual(1);
    // The note is fully inside the viewport.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
  });

  test('fixtures sanity', async () => {
    expect(SHORT_PHRASE.length).toBeGreaterThan(0);
    expect(RETRO_ITEM.split('\n')).toHaveLength(3);
    expect(THOUSAND_CHAR_PARAGRAPH.length).toBe(1000);
  });
});
