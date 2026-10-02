import type { Page, Locator } from '@playwright/test';

/**
 * Shared story 7 E2E helpers: camera pinning, marquee/transform drags, and
 * selection-state assertions. Camera is expected to be {x:0,y:0,zoom:1} so
 * screen coordinates equal world coordinates.
 */

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
}

/**
 * Shift+drag a marquee rectangle from (x0,y0) to (x1,y1). A short settle before
 * mouse.up() ensures the final pointermove is processed before the gesture
 * commits.
 */
export async function shiftDrag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  // A single move event (no steps) avoids pointermove coalescing: the browser
  // fires exactly one pointermove at the target, so the gesture commits the
  // exact final position on pointer-up.
  await page.mouse.move(x1, y1);
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Plain drag from (x0,y0) to (x1,y1). */
export async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // A single move event (no steps) avoids pointermove coalescing: the browser
  // fires exactly one pointermove at the target, so the gesture commits the
  // exact final position on pointer-up.
  await page.mouse.move(x1, y1);
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/**
 * Drag a bounding-box resize handle by (dx, dy) screen pixels. Waits for the
 * handle to settle at a stable position first (it moves when the selection box
 * is resized, and a stale position would start the drag off the handle).
 */
export async function dragHandle(page: Page, handle: string, dx: number, dy: number) {
  const el = page.locator(`[data-testid="resize-handle-${handle}"]`);
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i < 30; i++) {
    const box = await el.boundingBox();
    if (!box) break;
    const cur = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (prev && Math.abs(cur.x - prev.x) < 1 && Math.abs(cur.y - prev.y) < 1) break;
    prev = cur;
    await page.waitForTimeout(30);
  }
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await drag(page, cx, cy, cx + dx, cy + dy);
}

/** True when the note with `id` currently carries the selection outline. */
export function isSelected(page: Page, id: string): Promise<boolean> {
  return page
    .locator(`[data-testid="sticky-note-${id}"]`)
    .getAttribute('data-selected')
    .then((v) => v !== null);
}

export function noteLocator(page: Page, id: string): Locator {
  return page.locator(`[data-testid="sticky-note-${id}"]`);
}

/**
 * Wait until the selection bounding box reaches the given screen size. This
 * ensures the handles have moved to their new positions after a resize, so a
 * follow-up handle drag starts from the correct place.
 */
export async function waitForSelectionBox(page: Page, width: number, height: number) {
  await page.waitForFunction(
    ({ w, h }) => {
      const box = document.querySelector('[data-testid="selection-box"]');
      if (!box) return false;
      const r = (box as HTMLElement).getBoundingClientRect();
      // Tolerance of 4px absorbs the 1px border (border-box adds 2px per axis).
      return Math.abs(r.width - w) < 4 && Math.abs(r.height - h) < 4;
    },
    { w: width, h: height },
    { timeout: 5000 },
  );
}
