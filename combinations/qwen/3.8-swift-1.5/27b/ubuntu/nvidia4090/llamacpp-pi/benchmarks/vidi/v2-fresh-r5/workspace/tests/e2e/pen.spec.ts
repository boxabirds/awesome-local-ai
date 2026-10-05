/**
 * E2E: pen (story 11) — TC-17 to TC-20.
 *
 * Real browser(s) against `wrangler dev`: drawing, preview, sharing,
 * navigation coexistence, and post-creation operations on strokes.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import {
  createParticipants,
  expectEventually,
  type Participant,
} from './helpers/participants';
import { setCamera, originCenter } from './helpers/board';
import { penPaths } from '../fixtures/pen-paths';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Activate the Pen tool and wait for its overlay. */
async function activatePen(page: Page): Promise<void> {
  await page.getByTestId('tool-pen-btn').click();
  await expect(page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();
}

/** All visible stroke paths on the page. */
function strokePaths(page: Page) {
  return page.locator('path[data-testid^="stroke-path-"]');
}

interface StrokeInfo {
  d: string;
  stroke: string;
  strokeWidth: number;
}

async function strokeInfos(page: Page): Promise<StrokeInfo[]> {
  return page
    .locator('path[data-testid^="stroke-path-"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        d: el.getAttribute('d') ?? '',
        stroke: el.getAttribute('stroke') ?? '',
        strokeWidth: Number(el.getAttribute('stroke-width') ?? 0),
      })),
    );
}

/** Parse the coordinates out of an SVG path `d` (M/L/Q commands). */
function parseD(d: string): Point[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: Point, pts: Point[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  }
  return best;
}

/**
 * A `page.mouse` drag through at least two points: down at the first,
 * moves through the rest, up at the last. With the default camera
 * ({0,0,1}) screen coordinates equal world coordinates.
 */
async function drawStroke(page: Page, points: Point[]): Promise<void> {
  expect(points.length).toBeGreaterThanOrEqual(2);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y, { steps: 1 });
  }
  await page.mouse.up();
}

/**
 * Assert on the strokes currently visible on `page`:
 *  - `count`: number of visible stroke paths
 *  - `color`: every path uses the given pen colour
 *  - `thicknessWorld`: every path's stroke-width (world units)
 *  - `pointsWithin`: every path coordinate is within `max` world units of
 *    the drawn `points` polyline
 */
async function expectStroke(
  page: Page,
  opts: {
    count: number;
    color?: string;
    thicknessWorld?: number;
    pointsWithin?: { drawn: Point[]; max: number };
  },
): Promise<void> {
  await expect
    .poll(async () => strokePaths(page).count(), { timeout: 10_000 })
    .toBe(opts.count);
  const infos = await strokeInfos(page);
  if (opts.color !== undefined) {
    const rgb = (PEN_COLORS as Record<string, string>)[opts.color];
    for (const info of infos) expect(info.stroke).toBe(rgb);
  }
  if (opts.thicknessWorld !== undefined) {
    for (const info of infos) {
      expect(info.strokeWidth).toBeCloseTo(opts.thicknessWorld, 5);
    }
  }
  if (opts.pointsWithin !== undefined) {
    for (const info of infos) {
      for (const p of parseD(info.d)) {
        expect(distToPolyline(p, opts.pointsWithin.drawn)).toBeLessThanOrEqual(
          opts.pointsWithin.max,
        );
      }
    }
  }
}

// ─── tests ──────────────────────────────────────────────────────────────────

test('TC-17: drawing a loop shows a live preview and persists the stroke', async ({ browser }) => {
  const [alice] = await createParticipants(browser, 1);
  await setCamera(alice.page, { x: 0, y: 0, zoom: 1 });
  await activatePen(alice.page);

  const pts = penPaths.handwrittenLoop;
  await alice.page.mouse.move(pts[0].x, pts[0].y);
  await alice.page.mouse.down();
  for (let i = 1; i < 200; i++) {
    await alice.page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
  }

  // The preview path is present during the drag
  const preview = alice.page.locator('[data-testid="pen-preview-path"]');
  await expect(preview).toBeVisible();

  // Measure preview updates: the path keeps growing as points arrive
  const d1 = await preview.getAttribute('d');
  const t0 = Date.now();
  for (let i = 200; i < 260; i++) {
    await alice.page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
  }
  await expect
    .poll(async () => (await preview.getAttribute('d')) !== d1, { timeout: 5_000 })
    .toBe(true);
  console.log(`[preview] updated within ${Date.now() - t0}ms of new input`);

  for (let i = 260; i < pts.length; i++) {
    await alice.page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
  }
  await alice.page.mouse.up();

  // Preview is gone; the stroke persists. The smoothed path stays within the
  // simplify tolerance (~1 world unit at zoom 1) plus midpoint chord slack of
  // the drawn path, so allow 3.
  await expect(preview).toHaveCount(0);
  await expectStroke(alice.page, {
    count: 1,
    color: 'black',
    thicknessWorld: PEN_THICKNESS_WORLD.medium,
    pointsWithin: { drawn: pts, max: 3 },
  });

  // The pen stays active after the commit
  await expect(alice.page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();
  await alice.close();
});

test('TC-18: other participants see the finished stroke, not the in-progress one', async ({ browser }) => {
  const [alice, bob] = await createParticipants(browser, 2);
  for (const p of [alice, bob] as Participant[]) {
    await setCamera(p.page, { x: 0, y: 0, zoom: 1 });
  }
  await activatePen(alice.page);

  const pts = penPaths.underline;
  await alice.page.mouse.move(pts[0].x, pts[0].y);
  await alice.page.mouse.down();
  for (let i = 1; i < 60; i++) {
    await alice.page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
  }

  // Nothing is shared while the stroke is in progress
  expect(await strokePaths(bob.page).count()).toBe(0);

  await alice.page.mouse.up();

  // The finished stroke appears for the other participant (latency logged,
  // not asserted — model, browsers and server share one machine)
  await expectEventually('finished stroke appears for the other participant', async () => {
    return (await strokePaths(bob.page).count()) === 1;
  });
  await expectStroke(bob.page, {
    count: 1,
    color: 'black',
    thicknessWorld: PEN_THICKNESS_WORLD.medium,
    pointsWithin: { drawn: pts, max: 3 },
  });

  await alice.close();
  await bob.close();
});

test('TC-19: wheel pans while the pen is active; drawing over a sticky does not move it', async ({ browser }) => {
  const [alice] = await createParticipants(browser, 1);
  await setCamera(alice.page, { x: 0, y: 0, zoom: 1 });

  // A sticky note on the board (select tool, double-click on empty space)
  await alice.createNote('hi', 500, 300);
  const originBefore = await originCenter(alice.page);

  await activatePen(alice.page);
  // Wheel over the board (the cursor is on the board, not on a toolbar)
  await alice.page.mouse.move(640, 400);
  await alice.page.mouse.wheel(0, 240);
  // The board panned with the wheel while the pen was active
  await expect
    .poll(async () => {
      const o = await originCenter(alice.page);
      return Math.hypot(o.x - originBefore.x, o.y - originBefore.y);
    }, { timeout: 5_000 })
    .toBeGreaterThan(50);

  // Draw a stroke that starts ON the sticky (it moved with the pan)
  const stickyBox = (await alice.note('hi').boundingBox())!;
  const sx = stickyBox.x + stickyBox.width / 2;
  const sy = stickyBox.y + stickyBox.height / 2;
  const noteBefore = stickyBox;
  await drawStroke(alice.page, [
    { x: sx, y: sy },
    { x: sx + 120, y: sy + 60 },
  ]);

  await expectStroke(alice.page, { count: 1, color: 'black' });

  // The sticky did not move
  const noteAfter = (await alice.note('hi').boundingBox())!;
  expect(noteAfter.x).toBe(noteBefore.x);
  expect(noteAfter.y).toBe(noteBefore.y);

  await alice.close();
});

test('TC-20: select a stroke by its line, resize proportionally, move, delete', async ({ browser }) => {
  const [alice, bob] = await createParticipants(browser, 2);
  for (const p of [alice, bob] as Participant[]) {
    await setCamera(p.page, { x: 0, y: 0, zoom: 1 });
  }

  // A diagonal stroke from (300,300) to (500,400)
  const pts: Point[] = [
    { x: 300, y: 300 },
    { x: 350, y: 325 },
    { x: 400, y: 350 },
    { x: 450, y: 375 },
    { x: 500, y: 400 },
  ];
  await activatePen(alice.page);
  await drawStroke(alice.page, pts);
  await expectStroke(alice.page, { count: 1, color: 'black' });
  await expectEventually('stroke appears for the other participant', async () => {
    return (await strokePaths(bob.page).count()) === 1;
  });

  // V back to the select tool
  await alice.page.keyboard.press('v');
  await expect(alice.page.locator('[data-testid="pen-tool-overlay"]')).toHaveCount(0);

  // Click the line: the stroke is selected (line hit test, not bbox)
  await alice.page.mouse.click(400, 350);
  const overlay = alice.page.locator('[data-testid="selection-overlay"]');
  await expect(overlay).toBeVisible();

  // Proportional resize from the SE handle
  const bounds = alice.page.locator('[data-testid="selection-bounds"]');
  const b1 = (await bounds.boundingBox())!;
  const ratio1 = b1.width / b1.height;
  const se = alice.page.getByTestId('handle-se');
  const seBox = (await se.boundingBox())!;
  await alice.page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(seBox.x + seBox.width / 2 + 60, seBox.y + seBox.height / 2 + 30, { steps: 3 });
  await alice.page.mouse.up();
  const b2 = (await bounds.boundingBox())!;
  const ratio2 = b2.width / b2.height;
  expect(Math.abs(ratio2 - ratio1) / ratio1).toBeLessThan(0.01);
  // It actually grew
  expect(b2.width).toBeGreaterThan(b1.width);

  // Move the stroke by dragging its body
  const m0 = (await bounds.boundingBox())!;
  await alice.page.mouse.move(m0.x + m0.width / 2, m0.y + m0.height / 2);
  await alice.page.mouse.down();
  await alice.page.mouse.move(m0.x + m0.width / 2 + 80, m0.y + m0.height / 2 + 40, { steps: 3 });
  await alice.page.mouse.up();
  const m1 = (await bounds.boundingBox())!;
  expect(m1.x).toBeCloseTo(m0.x + 80, 0);
  expect(m1.y).toBeCloseTo(m0.y + 40, 0);

  // Delete: the stroke is removed on both screens
  await alice.page.keyboard.press('Delete');
  await expect(strokePaths(alice.page)).toHaveCount(0);
  await expectEventually('deleted stroke disappears for the other participant', async () => {
    return (await strokePaths(bob.page).count()) === 0;
  });

  await alice.close();
  await bob.close();
});
