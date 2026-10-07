// Story 7 e2e (main config, chromium): marquee selection (TC-32), the
// transform gesture (TC-33) and the selection keyboard commands (TC-34).
//
// The default camera is { x: -640, y: -400, zoom: 1 } on a 1280×800 viewport,
// so screen = world + (640, 400). All interactions are done with real mouse
// and keyboard events; positions are verified through the __vidi6 test hooks.

import { test, expect, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { selectionBoardFixture } from '../../tests/fixtures/boards';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';

/** Default e2e camera: screen = world + (640, 400). */
const SX = 640;
const SY = 400;

interface ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

async function getObjects(page: Page): Promise<Map<string, ObjectInfo>> {
  const list = await page.evaluate(() =>
    (window as unknown as { __vidi6: { getObjects(): ObjectInfo[] } }).__vidi6.getObjects(),
  );
  return new Map(list.map((o) => [o.id, o]));
}

async function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(
    () => (window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } }).__vidi6.getCamera(),
  );
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-root"]', { timeout: 15000 });
}

/** Seeds the 20-note fixture (two clusters of ten); returns the ids. */
async function seedSelectionBoard(page: Page): Promise<{ a: string[]; b: string[] }> {
  const fixture = selectionBoardFixture();
  const all = [...fixture.a, ...fixture.b];
  return page.evaluate((seeds) => {
    const h = (window as unknown as {
      __vidi6: { createNoteAt(x: number, y: number, color: string, text: string): string };
    }).__vidi6;
    const ids = seeds.map((s) => h.createNoteAt(s.x, s.y, 'yellow', s.text));
    return { a: ids.slice(0, 10), b: ids.slice(10, 20) };
  }, all.map((s) => ({ x: s.center.x, y: s.center.y, text: s.text })));
}

function centers(fixture: ReturnType<typeof selectionBoardFixture>, idx: number): { x: number; y: number } {
  return fixture.a[idx].center;
}

// Playwright's mouse API has no modifier options; hold Shift on the keyboard
// channel for the duration of the gesture instead.
async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

async function shiftMarquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.describe('story 7: selection e2e (main config)', () => {
  test('TC-32: marquee selects only fully-inside notes (A in, B half, C out)', async ({ page }) => {
    const boardId = newBoardId();
    await openBoard(page, boardId);
    // A centre (0,0): spans (−100..100)². B centre (150,0): spans (50..250) × (−100..100).
    // C centre (700,0): spans (600..800) × (−100..100).
    const ids = await page.evaluate(() => {
      const h = (window as unknown as {
        __vidi6: { createNoteAt(x: number, y: number, color: string, text: string): string };
      }).__vidi6;
      return [h.createNoteAt(0, 0, 'yellow', 'A'), h.createNoteAt(150, 0, 'pink', 'B'), h.createNoteAt(700, 0, 'blue', 'C')];
    });
    await page.waitForSelector(`[data-testid="sticky-note"][data-id="${ids[0]}"]`, { timeout: 5000 });

    // Shift+drag a marquee over world (−150,−150) → (150,150) = screen (490,250) → (790,550).
    await shiftMarquee(page, 490, 250, 790, 550);

    await expect(page.locator(`[data-testid="sticky-note"][data-id="${ids[0]}"][data-selected="true"]`)).toHaveCount(1);
    await expect(page.locator(`[data-testid="sticky-note"][data-id="${ids[1]}"][data-selected="true"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="sticky-note"][data-id="${ids[2]}"][data-selected="true"]`)).toHaveCount(0);
  });

  test('TC-33: group move raises above an unselected note; se resize scales all, squares hold, min size stops the shrink', async ({ page }) => {
    const boardId = newBoardId();
    await openBoard(page, boardId);
    const fixture = selectionBoardFixture();
    const { a, b } = await seedSelectionBoard(page);
    await page.waitForSelector(`[data-testid="sticky-note"][data-id="${a[0]}"]`, { timeout: 5000 });

    // Select six notes: the whole top row (a[0..4]) plus a[5] (bottom-left).
    // The "4th note" a[6] (bottom row, second) stays unselected.
    for (let i = 0; i < 6; i += 1) {
      const c = centers(fixture, i);
      if (i === 0) await page.mouse.click(c.x + SX, c.y + SY);
      else await shiftClick(page, c.x + SX, c.y + SY);
    }
    const before = await getObjects(page);
    const zFourth = before.get(a[6])!.z;

    // Drag a[0] (centre (−520,−60) → screen (120,340)) 300 world units right.
    await page.mouse.move(120, 340);
    await page.mouse.down();
    await page.mouse.move(420, 340, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterMove = await getObjects(page);
    for (let i = 0; i < 6; i += 1) {
      const o = afterMove.get(a[i])!;
      expect(o.x, `a[${i}].x moved 300`).toBeCloseTo(before.get(a[i])!.x + 300, 3);
      expect(o.y, `a[${i}].y unchanged`).toBeCloseTo(before.get(a[i])!.y, 3);
      expect(o.z, `a[${i}] above the 4th note`).toBeGreaterThan(zFourth);
    }
    // The unselected notes did not move (the 4th note and cluster B).
    expect(afterMove.get(a[6])!.x).toBeCloseTo(before.get(a[6])!.x, 3);
    expect(afterMove.get(b[0])!.x).toBeCloseTo(before.get(b[0])!.x, 3);

    // Bring the group into view for the resize (camera (−500,−400) @ 0.8).
    await page.evaluate(() => {
      (window as unknown as { __vidi6: { setCamera(c: { x: number; y: number; zoom: number }): void } }).__vidi6.setCamera({ x: -500, y: -400, zoom: 0.8 });
    });
    await page.waitForTimeout(100);

    // Drag the se handle: the bounding box is (−320,−160) 1240×320; a
    // (150,150) world drag makes the y scale (470/320 = 1.46875) dominate,
    // so every note scales by 1.46875: 200 → 293.75, gaps 260 → 381.9.
    const se = page.locator('button[aria-label="Resize bottom-right"]');
    const box = await se.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterGrow = await getObjects(page);
    const SCALE = 470 / 320;
    for (let i = 0; i < 6; i += 1) {
      const o = afterGrow.get(a[i])!;
      expect(o.width, `a[${i}] square and scaled`).toBeCloseTo(200 * SCALE, 1);
      expect(o.height, `a[${i}] square and scaled`).toBeCloseTo(200 * SCALE, 1);
      expect(o.width).toBeCloseTo(o.height, 5);
    }
    // Gaps scale with the group: a[0] → a[1] centre distance 260 → 260×SCALE.
    const gap =
      afterGrow.get(a[1])!.x - afterGrow.get(a[1])!.width / 2 - (afterGrow.get(a[0])!.x - afterGrow.get(a[0])!.width / 2);
    expect(gap).toBeCloseTo(260 * SCALE, 1);
    // The unselected 4th note kept its size.
    expect(afterGrow.get(a[6])!.width).toBeCloseTo(200, 3);

    // Shrink far past the minimum: the whole group stops at 50×50
    // (STICKY_MIN_SIZE_WORLD), uniformly.
    const se2 = page.locator('button[aria-label="Resize bottom-right"]');
    const box2 = await se2.boundingBox();
    expect(box2).not.toBeNull();
    await page.evaluate(() => {
      (window as unknown as { __vidi6: { setCamera(c: { x: number; y: number; zoom: number }): void } }).__vidi6.setCamera({ x: -500, y: -400, zoom: 0.4 });
    });
    await page.waitForTimeout(100);
    const se3 = page.locator('button[aria-label="Resize bottom-right"]');
    const box3 = await se3.boundingBox();
    expect(box3).not.toBeNull();
    await page.mouse.move(box3!.x + box3!.width / 2, box3!.y + box3!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box3!.x + box3!.width / 2 - 1200, box3!.y + box3!.height / 2 - 800, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const afterShrink = await getObjects(page);
    for (let i = 0; i < 6; i += 1) {
      const o = afterShrink.get(a[i])!;
      expect(o.width, `a[${i}] clamped at the minimum size`).toBeCloseTo(50, 1);
      expect(o.height, `a[${i}] clamped at the minimum size`).toBeCloseTo(50, 1);
    }
  });

  test('TC-34: arrows nudge without page scroll or camera pan; Delete removes the selection', async ({ page }) => {
    const boardId = newBoardId();
    await openBoard(page, boardId);
    const fixture = selectionBoardFixture();
    const { a, b } = await seedSelectionBoard(page);
    await page.waitForSelector(`[data-testid="sticky-note"][data-id="${a[0]}"]`, { timeout: 5000 });

    // Select six notes (a[0..5]).
    for (let i = 0; i < 6; i += 1) {
      const c = centers(fixture, i);
      if (i === 0) await page.mouse.click(c.x + SX, c.y + SY);
      else await shiftClick(page, c.x + SX, c.y + SY);
    }
    const before = await getObjects(page);
    const camBefore = await getCamera(page);

    // ArrowRight ×3, then Shift+ArrowRight: +NUDGE_STEP×3 + NUDGE_LARGE on x.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    const after = await getObjects(page);
    const expectedDx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (let i = 0; i < 6; i += 1) {
      expect(after.get(a[i])!.x).toBeCloseTo(before.get(a[i])!.x + expectedDx, 3);
      expect(after.get(a[i])!.y).toBeCloseTo(before.get(a[i])!.y, 3);
    }
    // No page scroll, no camera pan (preventDefault on the handled keys).
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const camAfter = await getCamera(page);
    expect(camAfter.x).toBe(camBefore.x);
    expect(camAfter.y).toBe(camBefore.y);
    expect(camAfter.zoom).toBe(camBefore.zoom);

    // Delete removes exactly the six selected notes.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    const afterDelete = await getObjects(page);
    expect(afterDelete.size).toBe(14);
    for (let i = 0; i < 6; i += 1) {
      expect(afterDelete.has(a[i])).toBe(false);
    }
    expect(afterDelete.has(b[0])).toBe(true); // cluster B untouched
    // The selection is cleared: no overlay, no bar.
    await expect(page.locator('[data-testid="selection-overlay"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="selection-bar"]')).toHaveCount(0);
  });
});
