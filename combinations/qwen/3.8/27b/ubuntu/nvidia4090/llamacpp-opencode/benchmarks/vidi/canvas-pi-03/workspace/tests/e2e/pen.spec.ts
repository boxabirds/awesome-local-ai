import { test, expect } from '@playwright/test';
import { getObjects, getNotes, type ObjectSnapshot } from './helpers/board';
import {
  closeAll,
  expectWithin,
  getCamera,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  newBoardId,
  noteCenterScreen,
  openBoard,
  createNoteAt,
  type Participant,
} from './participants';
import { screenOf } from './helpers/selection';
import { HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths';

/**
 * Story 11 e2e (chromium): the Pen tool against the real server.
 *
 * The e2e camera is (-640, -360) at zoom 1 (1280x720 viewport), so
 * screen = world + (640, 360).
 */

async function strokes(page: Parameters<typeof getObjects>[0]): Promise<ObjectSnapshot[]> {
  return (await getObjects(page)).filter((o) => o.type === 'stroke');
}

/**
 * Drags a pen stroke through the given screen points: move to the first,
 * press, then move through the rest (the caller releases the button).
 *
 * The moves are batched with `steps` (the codebase drag convention): dozens
 * of back-to-back protocol moves are coalesced away by Firefox's input
 * pipeline, so each batch is one interpolated multi-step move.
 */
const PEN_BATCH = 10;

async function penDown(page: Parameters<typeof getObjects>[0], pts: Array<{ x: number; y: number }>): Promise<void> {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i += PEN_BATCH) {
    const end = Math.min(i + PEN_BATCH - 1, pts.length - 1);
    const target = pts[end];
    // steps: 0 dispatches no move event at all (Playwright), so clamp to 1.
    await page.mouse.move(target.x, target.y, { steps: Math.max(1, end - i) });
  }
}

test.describe('story 11: pen (e2e)', () => {
  test('TC-17: a real drag draws the loop; the preview path changes across animation frames; the stroke persists', async ({ browser }) => {
    const dana: Participant = await openBoard(browser, newBoardId());
    try {
      const page = dana.page;
      await page.keyboard.press('p');
      await expect(page.locator('[data-testid="pen-tool-button"]')).toHaveAttribute('aria-pressed', 'true');

      const pts = HANDWRITTEN_LOOP.map((w) => screenOf(w));

      // Run the drag in the background (batched `steps` moves, see penDown);
      // sample the preview's `d` across consecutive animation frames while
      // the stroke is in flight.
      await page.mouse.move(pts[0].x, pts[0].y);
      await page.mouse.down();
      const drag = (async () => {
        for (let i = 1; i < pts.length; i += PEN_BATCH) {
          const end = Math.min(i + PEN_BATCH - 1, pts.length - 1);
          const target = pts[end];
          await page.mouse.move(target.x, target.y, { steps: Math.max(1, end - i) });
          await page.waitForTimeout(10);
        }
      })();
      // The preview path appears after the first real move (a dot draws a circle).
      await page.waitForSelector('[data-testid="pen-preview-path"]', { timeout: 5000 });
      const frames = await page.evaluate(async () => {
        const d = () => document.querySelector('[data-testid="pen-preview-path"]')?.getAttribute('d') ?? null;
        const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
        const out: Array<string | null> = [];
        for (let i = 0; i < 4; i += 1) {
          out.push(d());
          await frame();
        }
        return out;
      });
      await drag;
      await page.mouse.up();

      // The preview was a live path the whole time and it grew across frames.
      expect(frames.every((f) => f !== null)).toBe(true);
      expect(frames.some((f, i) => i > 0 && f !== frames[i - 1])).toBe(true);

      // The stroke persists after release (and the preview is gone).
      await expect.poll(async () => (await strokes(page)).length, { timeout: 5000 }).toBe(1);
      await expect(page.locator('[data-testid="pen-preview-path"]')).toHaveCount(0);
      const s = (await strokes(page))[0];
      expect(s.color).toBe('black');
      expect(s.thickness).toBe('medium');
      // The pen stays active for the next stroke.
      await expect(page.locator('[data-testid="pen-tool-button"]')).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await closeAll(dana);
    }
  });

  test('TC-18: Sam sees nothing while Priya drags; the stroke lands within the latency budget after release', async ({ browser }) => {
    const boardId = newBoardId();
    const priya = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      await priya.page.keyboard.press('p');
      const pts = UNDERLINE.map((w) => screenOf(w));
      await priya.page.mouse.move(pts[0].x, pts[0].y);
      await priya.page.mouse.down();

      // Drag in the background (batched steps moves); while it is in flight
      // Sam must see NO stroke.
      const drag = (async () => {
        for (let i = 1; i < pts.length; i += PEN_BATCH) {
          const end = Math.min(i + PEN_BATCH - 1, pts.length - 1);
          const target = pts[end];
          await priya.page.mouse.move(target.x, target.y, { steps: Math.max(1, end - i) });
          await priya.page.waitForTimeout(15);
        }
      })();
      // Let a good number of moves land, then check the watcher.
      await priya.page.waitForTimeout(150);
      expect((await strokes(sam.page)).length).toBe(0);
      await drag;
      await priya.page.mouse.up();

      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Sam sees the stroke after Priya releases',
        async () => (await strokes(sam.page)).length === 1,
      );
    } finally {
      await closeAll(priya, sam);
    }
  });

  test('TC-19: wheel pans with the pen active; a drag starting on a sticky draws a stroke and leaves the sticky in place', async ({ browser }) => {
    const dana: Participant = await openBoard(browser, newBoardId());
    try {
      const page = dana.page;
      const noteId = await createNoteAt(page, 400, 300);
      await page.keyboard.press('p');
      await expect(page.locator('[data-testid="pen-tool-button"]')).toHaveAttribute('aria-pressed', 'true');

      // Wheel pans the camera even though the pen is the active tool.
      const before = await getCamera(page);
      await page.mouse.move(400, 300);
      await page.mouse.wheel(0, 200);
      const afterWheel = await getCamera(page);
      expect(afterWheel.y).not.toBe(before.y);

      // Drag starting ON the sticky (now at its panned screen position):
      // it must create a stroke, not move the sticky, and not pan.
      const note = (await getNotes(page)).find((n) => n.id === noteId);
      if (!note) throw new Error('seeded note vanished');
      const c = await noteCenterScreen(page, note);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 120, c.y + 40, { steps: 12 });
      await page.mouse.up();

      await expect.poll(async () => (await strokes(page)).length, { timeout: 5000 }).toBe(1);
      const moved = (await getNotes(page)).find((n) => n.id === noteId);
      if (!moved) throw new Error('note vanished after pen drag');
      expect(moved.x).toBe(note.x);
      expect(moved.y).toBe(note.y);
      const afterDrag = await getCamera(page);
      expect(afterDrag.x).toBe(afterWheel.x);
      expect(afterDrag.y).toBe(afterWheel.y);
      expect(afterDrag.zoom).toBe(afterWheel.zoom);
    } finally {
      await closeAll(dana);
    }
  });

  test('TC-20: select the stroke, resize aspect-locked, move, delete — the watcher follows each step', async ({ browser }) => {
    const boardId = newBoardId();
    const priya = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    try {
      const page = priya.page;

      // Draw a straight stroke: screen (200,150) -> (420,290).
      await page.keyboard.press('p');
      await penDown(page, [
        { x: 200, y: 150 },
        { x: 420, y: 290 },
      ]);
      await page.mouse.up();
      await expect.poll(async () => (await strokes(page)).length, { timeout: 5000 }).toBe(1);
      const id = (await strokes(page))[0].id;

      // Select it (switch to the Select tool, click ON the line).
      await page.keyboard.press('v');
      await page.mouse.click(255, 185);
      await expect
        .poll(async () => (await page.evaluate(() => (window as any).__vidi6?.getSelection?.() ?? [])), {
          timeout: 5000,
        })
        .toContain(id);

      // Resize from the SE handle by (+60, +20) screen px (zoom 1: world px).
      const handle = page.locator('[data-handle="se"]');
      await expect(handle).toBeVisible({ timeout: 5000 });
      const box = (await handle.boundingBox())!;
      const hx = box.x + box.width / 2;
      const hy = box.y + box.height / 2;
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.mouse.move(hx + 60, hy + 20, { steps: 8 });
      await page.mouse.up();

      const resizedPriya = (await strokes(page)).find((o) => o.id === id)!;
      // Original bbox: the 220 x 140 line plus t/2 (2) padding each side.
      // Aspect-locked corner resize: scale = max(284/224, 164/144) = 284/224,
      // so the aspect ratio is preserved (within 1%) and thickness unchanged.
      const expectedW = 284;
      const expectedH = 144 * (284 / 224); // 182.571...
      expect(resizedPriya.baseWidth).toBe(224);
      expect(resizedPriya.baseHeight).toBe(144);
      expect(Math.abs((resizedPriya.width ?? 0) - expectedW)).toBeLessThanOrEqual(2);
      expect(Math.abs((resizedPriya.height ?? 0) - expectedH)).toBeLessThanOrEqual(2);
      const baseRatio = 224 / 144;
      const newRatio = (resizedPriya.width ?? 1) / (resizedPriya.height ?? 1);
      expect(Math.abs(newRatio - baseRatio) / baseRatio).toBeLessThanOrEqual(0.01);
      expect(resizedPriya.thickness).toBe('medium');
      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Sam sees the resized stroke',
        async () => {
          const o = (await strokes(sam.page)).find((s) => s.id === id);
          return (
            o !== undefined &&
            Math.abs((o.width ?? 0) - expectedW) <= 2 &&
            Math.abs((o.height ?? 0) - expectedH) <= 2
          );
        },
      );

      // Move the stroke by (+80, -40): click a point ON the (rescaled) line.
      const o = (await strokes(page)).find((s) => s.id === id)!;
      const w = o.width ?? 1;
      const h = o.height ?? 1;
      const bw = o.baseWidth ?? 1;
      const bh = o.baseHeight ?? 1;
      // Midpoint of the rescaled line: from (x, y) to (x + 220*w/bw, y + 140*h/bh).
      const mid = { x: o.x + (110 * w) / bw, y: o.y + (70 * h) / bh };
      const ms = screenOf(mid);
      await page.mouse.move(ms.x, ms.y);
      await page.mouse.down();
      await page.mouse.move(ms.x + 80, ms.y - 40, { steps: 8 });
      await page.mouse.up();

      const movedPriya = (await strokes(page)).find((s) => s.id === id)!;
      expect(Math.abs(movedPriya.x - (resizedPriya.x + 80))).toBeLessThanOrEqual(1);
      expect(Math.abs(movedPriya.y - (resizedPriya.y - 40))).toBeLessThanOrEqual(1);
      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Sam sees the moved stroke',
        async () => {
          const m = (await strokes(sam.page)).find((s) => s.id === id);
          return (
            m !== undefined &&
            Math.abs(m.x - movedPriya.x) <= 1 &&
            Math.abs(m.y - movedPriya.y) <= 1
          );
        },
      );

      // Delete it: the selection clears and the watcher sees it gone.
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await strokes(page)).length, { timeout: 5000 }).toBe(0);
      await expect
        .poll(async () => (await page.evaluate(() => (window as any).__vidi6?.getSelection?.() ?? [])), {
          timeout: 5000,
        })
        .not.toContain(id);
      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Sam sees the deletion',
        async () => (await strokes(sam.page)).length === 0,
      );
    } finally {
      await closeAll(priya, sam);
    }
  });
});
