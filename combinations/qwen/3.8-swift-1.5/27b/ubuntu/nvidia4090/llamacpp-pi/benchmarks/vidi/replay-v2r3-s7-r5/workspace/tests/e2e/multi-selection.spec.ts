import { test, expect, type Page } from '@playwright/test';
import {
  createBoard,
  openBoardInPage,
  seedNotes,
  noteRect,
  noteZ,
} from './helpers/board';
import { setCamera, shiftDrag, drag, dragHandle, isSelected, waitForSelectionBox } from './helpers/selection';
import {
  STICKY_MIN_SIZE_WORLD,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  MAX_CONCURRENT_EDITORS,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';

/**
 * Story 7 E2E: marquee selection, group move + bounding-box resize, and
 * selection keyboard commands against the real wrangler dev server.
 *
 * The camera is fixed at {x:0, y:0, zoom:1} so screen coordinates equal world
 * coordinates, keeping the geometry assertions exact.
 */

/** Create a board, open it, pin the camera to the origin, seed notes. */
async function setup(
  page: Page,
  specs: { x: number; y: number; text?: string; color?: string }[],
): Promise<string[]> {
  const boardId = await createBoard();
  await openBoardInPage(page, boardId);
  await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__?.doc);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  const ids = await seedNotes(page, specs);
  if (ids.length > 0) {
    await expect(page.locator(`[data-testid="sticky-note-${ids[0]}"]`)).toBeVisible();
  }
  return ids;
}

test.describe('Story 7: multi-selection E2E', () => {
  // TC-32
  test('TC-32: marquee selects only fully-inside notes', async ({ page }) => {
    const ids = await setup(page, [
      { x: 100, y: 100 }, // A: (100,100)-(300,300) fully inside
      { x: 280, y: 100 }, // B: (280,100)-(480,300) half inside
      { x: 600, y: 100 }, // C: (600,100)-(800,300) outside
    ]);

    // Shift+drag rect (50,50)-(400,350).
    await shiftDrag(page, 50, 50, 400, 350);

    expect(await isSelected(page, ids[0])).toBe(true); // A
    expect(await isSelected(page, ids[1])).toBe(false); // B (partly inside)
    expect(await isSelected(page, ids[2])).toBe(false); // C (outside)
  });

  // TC-33
  test('TC-33: 6 notes move together above a 4th; corner resize scales sizes and gaps; shrink clamps', async ({ page }) => {
    // 3×2 grid of 150×150 notes, 50-unit gaps. Sized so the box after a ×1.5
    // resize (825×525) stays inside the 1280×800 viewport (handles reachable).
    const grid = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 500, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 500, y: 300 },
    ];
    const S = 150;
    // 6 grid notes + 1 unselected note to the right (not in the marquee).
    const ids = await setup(
      page,
      [...grid.map((g) => ({ ...g, width: S, height: S })), { x: 750, y: 100, width: S, height: S }],
    );
    const unselected = ids[6];

    // Select the 6 grid notes: marquee (50,50)-(700,450) covers (100,100)-(650,450).
    await shiftDrag(page, 50, 50, 700, 450);
    for (let i = 0; i < 6; i++) {
      expect(await isSelected(page, ids[i])).toBe(true);
    }
    expect(await isSelected(page, unselected)).toBe(false);

    // Drag n1 (centre (175,175)) right by 200 world units.
    await drag(page, 175, 175, 375, 175);
    // The selection box (550×350) must settle at the new position.
    await waitForSelectionBox(page, 550, 350);
    for (let i = 0; i < 6; i++) {
      const r = (await noteRect(page, ids[i]))!;
      expect(r.x).toBeCloseTo(grid[i].x + 200, 3);
      expect(r.y).toBeCloseTo(grid[i].y, 3);
    }

    // The moved cluster renders above the unselected note (n3 now overlaps it).
    const movedZ = await noteZ(page, ids[2]);
    const unselZ = await noteZ(page, unselected);
    expect(movedZ!).toBeGreaterThan(unselZ!);

    // Corner-resize: drag the se handle (850,450) right by 275 → uniform ×1.5.
    await dragHandle(page, 'se', 275, 0);
    // Wait for the box to grow (825×525) so the handles are at the new position.
    await waitForSelectionBox(page, 825, 525);
    await page.waitForTimeout(150);
    for (let i = 0; i < 6; i++) {
      const r = (await noteRect(page, ids[i]))!;
      expect(r.width).toBeCloseTo(225, 3); // 150 × 1.5, stays square
      expect(r.height).toBeCloseTo(225, 3);
    }
    // Gap between n1 and n2 scaled 50 → 75.
    const r1 = (await noteRect(page, ids[0]))!;
    const r2 = (await noteRect(page, ids[1]))!;
    expect(r2.x - (r1.x + r1.width)).toBeCloseTo(75, 3);

    // Shrink far below the minimum: the clamp stops at STICKY_MIN_SIZE_WORLD.
    await dragHandle(page, 'se', -1000, 0);
    for (let i = 0; i < 6; i++) {
      const r = (await noteRect(page, ids[i]))!;
      expect(r.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
      expect(r.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
    }
  });

  // TC-34
  test('TC-34: arrows nudge without page scroll or board pan; Delete removes all', async ({ page }) => {
    const grid = [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 700, y: 100 },
      { x: 100, y: 400 },
      { x: 400, y: 400 },
      { x: 700, y: 400 },
    ];
    const ids = await setup(page, grid);

    // Select all.
    await page.keyboard.press('Control+a');
    for (const id of ids) {
      expect(await isSelected(page, id)).toBe(true);
    }

    const before = [];
    for (const id of ids) before.push((await noteRect(page, id))!);

    // ArrowRight ×3 (+NUDGE_STEP_WORLD each) and Shift+ArrowRight (+NUDGE_LARGE).
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const totalDx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;

    for (let i = 0; i < 6; i++) {
      const r = (await noteRect(page, ids[i]))!;
      expect(r.x).toBeCloseTo(before[i].x + totalDx, 3);
      expect(r.y).toBeCloseTo(before[i].y, 3);
    }

    // No page scroll and no camera change.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const cam = await page.evaluate(() => (window as any).__vidi6.getCamera());
    expect(cam).toEqual({ x: 0, y: 0, zoom: 1 });

    // Delete removes all 6.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid^="sticky-note-"]')).toHaveCount(0);
  });

  // TC-36
  test('TC-36: MAX_CONCURRENT_EDITORS contexts move different selections simultaneously → identical final positions', async ({ browser }) => {
    const boardId = await createBoard();

    // One note column per context: 2 notes stacked in each of MAX_CONCURRENT_EDITORS
    // columns. Columns are 240 apart (200-wide note + 40 gap) starting at x=50 so the
    // rightmost column (x=1010..1210) stays inside the 1280px viewport.
    const cols: { x: number; y: number }[] = [];
    for (let c = 0; c < MAX_CONCURRENT_EDITORS; c++) {
      for (let r = 0; r < 2; r++) {
        cols.push({ x: 50 + c * 240, y: 100 + r * 300 });
      }
    }

    const contexts = [];
    const pages = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await openBoardInPage(page, boardId);
      await page.waitForFunction(() => !!(window as any).__VIDI_DEBUG__?.doc);
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      pages.push(page);
    }

    // Seed from the first page; wait for every page to see all notes.
    await seedNotes(pages[0], cols);
    for (const page of pages) {
      await expect(page.locator('[data-testid^="sticky-note-"]'), 'all notes visible').toHaveCount(
        cols.length,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
    }

    // Each context selects its own column and moves it down by 100, concurrently.
    // The move uses keyboard nudges (10 × Shift+ArrowDown = 10 × NUDGE_LARGE_STEP_WORLD)
    // because mouse-drag gestures batch writes per animation frame, which Chromium
    // throttles in background contexts; nudge writes are discrete and reliable.
    await Promise.all(
      pages.map(async (page, c) => {
        const x0 = 50 + c * 240;
        // Marquee exactly this column's two notes, then let the selection settle.
        await shiftDrag(page, x0 - 20, 80, x0 + 220, 620);
        await page.waitForTimeout(120);
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Shift+ArrowDown');
        }
      }),
    );

    // Every context converges to the same final positions (absolute writes).
    // The concurrent nudge writes propagate over Y.js; poll until all contexts
    // observe an identical snapshot (the convergence property under test).
    const getSnapshot = (page: Page) =>
      page.evaluate(() => {
        const objects = (window as any).__VIDI_DEBUG__.doc.getMap('objects');
        const out: { id: string; x: number; y: number }[] = [];
        objects.forEach((m: any, key: string) => {
          if (m.get('type') === 'sticky') out.push({ id: key, x: m.get('x'), y: m.get('y') });
        });
        out.sort((a, b) => (a.id < b.id ? -1 : 1));
        return out;
      });

    let snapshots: { id: string; x: number; y: number }[][] = [];
    const deadline = Date.now() + 8000;
    let converged = false;
    while (Date.now() < deadline) {
      snapshots = await Promise.all(pages.map(getSnapshot));
      const first = JSON.stringify(snapshots[0]);
      if (snapshots.every((s) => JSON.stringify(s) === first)) {
        converged = true;
        break;
      }
      await pages[0].waitForTimeout(200);
    }
    expect(converged, 'contexts converged to identical positions').toBe(true);
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toEqual(snapshots[0]);
    }

    // The expected final layout: each column moved down by exactly 100.
    const expected = new Set<string>();
    for (let c = 0; c < MAX_CONCURRENT_EDITORS; c++) {
      const x0 = 50 + c * 240;
      expected.add(`${x0},200`); // top note: 100 → 200
      expected.add(`${x0},500`); // bottom note: 400 → 500
    }
    const actual = new Set(snapshots[0].map((n) => `${n.x},${n.y}`));
    expect(actual).toEqual(expected);

    for (const ctx of contexts) await ctx.close();
  });
});
