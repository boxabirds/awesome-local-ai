// Story 11 in real browsers against wrangler dev: drawing with the Pen (live local preview, strokes shared only
// when finished), navigating while the Pen is active, and tidying strokes up with the shared selection behaviour.
import { expect, test, type Page } from '@playwright/test';
import { getCamera, openBoard, setCamera, settle } from './helpers/board';
import { createBoardAt } from './helpers/boards-api';
import { dragBy } from './helpers/notes';
import { closeAll, expectWithin, openParticipants } from './helpers/participants';
import { handleCentre, seedBoard, selectedIds } from './helpers/selection';
import { recordBoard } from '../fixtures/boards';
import { HANDWRITTEN_LOOP, UNDERLINE, translatePath } from '../fixtures/pen-paths';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';

const CAM = { x: 0, y: 0, zoom: 1 };

async function strokes(page: Page): Promise<StrokeSnap[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'stroke') as unknown as StrokeSnap[],
  );
}

async function stickies(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'sticky') as unknown as StickySnapshot[],
  );
}

async function view(page: Page) {
  await page.waitForFunction(() => window.__vidi6?.setCamera !== undefined);
  await setCamera(page, CAM);
  await settle(page);
}

async function choosePen(page: Page) {
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible();
}

/** The path with whole-pixel points and no repeated neighbours (what a real mouse reports). */
function pixelPath(path: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of path) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  return out;
}

/** Replays a path with the real mouse: press at its first point, move through the rest; release unless told not to. */
async function drawPath(page: Page, path: readonly Point[], release = true) {
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(p.x, p.y);
  if (release) await page.mouse.up();
}

test.describe('Workflow "Annotate a cluster"', () => {
  test('TC-17 a real drag shows a preview that updates every frame with new input; the stroke stays after release', async ({
    page,
  }) => {
    await openBoard(page);
    await view(page);
    await choosePen(page);
    const path = pixelPath(translatePath(HANDWRITTEN_LOOP, { x: 600, y: 400 })).filter((_, i) => i % 2 === 0);

    // Sample the preview's `d` once per animation frame, with how many pointer moves had arrived by then.
    await page.evaluate(() => {
      const w = window as unknown as { __pen: { d: (string | null)[]; moves: number[]; stop: boolean } };
      let moves = 0;
      window.addEventListener('pointermove', () => moves++, true);
      w.__pen = { d: [], moves: [], stop: false };
      const tick = () => {
        w.__pen.d.push(document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null);
        w.__pen.moves.push(moves);
        if (!w.__pen.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await drawPath(page, path, false);
    await expect(page.getByTestId('pen-preview')).toHaveCount(1);
    expect(await strokes(page)).toHaveLength(0);
    await settle(page);
    const samples = await page.evaluate(() => {
      const w = window as unknown as { __pen: { d: (string | null)[]; moves: number[]; stop: boolean } };
      w.__pen.stop = true;
      return { d: w.__pen.d, moves: w.__pen.moves };
    });
    await page.mouse.up();

    // Every frame interval in which the pointer moved is followed by a changed preview (by the next frame).
    let checked = 0;
    for (let i = 1; i + 1 < samples.d.length; i++) {
      if (samples.moves[i] <= samples.moves[i - 1] || samples.d[i - 1] === null) continue;
      expect(samples.d[i + 1], `frame ${i}`).not.toBe(samples.d[i - 1]);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(samples.d.filter((d) => d !== null && d.length > 0).length).toBeGreaterThan(10);

    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);
    const [s] = await strokes(page);
    expect(s).toMatchObject({ color: 'black', thickness: 'medium' });
    // Smoothed yet faithful: every drawn point lies within 1 px of the finished line; far fewer points.
    const line = scaledPoints(s);
    expect(Math.max(...path.map((p) => distanceToPolyline(line, p)))).toBeLessThanOrEqual(1.01);
    expect(line.length).toBeLessThan(path.length);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');

    // Persisted: still there after a reload.
    await page.reload();
    await expect(page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);
  });

  test('TC-19 scrolling pans while the Pen is active; a drag starting on a sticky draws and leaves the sticky in place', async ({
    page,
  }) => {
    let note = '';
    const { doc } = recordBoard((d) => {
      note = createSticky(d, { x: 800, y: 500 });
    });
    const boardId = await createBoardAt();
    await seedBoard(boardId, doc);
    await page.goto(`/b/${boardId}`);
    await expect(page.locator(`[data-note-id="${note}"]`)).toHaveCount(1);
    await view(page);
    await choosePen(page);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await getCamera(page)).y).toBeCloseTo(200, 0);
    const cam = await getCamera(page);
    expect(cam.x).toBeCloseTo(0, 5);
    expect(await page.getByRole('button', { name: 'Pen (P)' }).getAttribute('aria-pressed')).toBe('true');

    const before = (await stickies(page))[0];
    // The note's centre (800, 500) is now at screen (800, 300).
    const start = { x: 800, y: 300 };
    await drawPath(page, pixelPath(translatePath(UNDERLINE, start)));
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const after = (await stickies(page))[0];
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    const camAfter = await getCamera(page);
    expect({ x: camAfter.x, y: camAfter.y }).toEqual({ x: cam.x, y: cam.y });
    expect(await selectedIds(page)).toEqual([]);
    const [s] = await strokes(page);
    expect(scaledPoints(s)[0]).toEqual({ x: 800, y: 500 });
  });
});

test.describe('Workflow "Shared sketch"', () => {
  test('TC-18 Sam sees nothing while Priya draws, and her stroke within the latency budget of the release', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people;
    try {
      for (const p of people) await view(p.page);
      await choosePen(priya.page);
      await priya.page.getByRole('button', { name: 'red pen' }).click();
      const path = pixelPath(translatePath(HANDWRITTEN_LOOP, { x: 500, y: 400 }));
      await drawPath(priya.page, path.slice(0, 200), false);
      await expect(priya.page.getByTestId('pen-preview')).toHaveCount(1);
      // Longer than the live-update budget: an in-progress stroke would have arrived by now.
      await sam.page.waitForTimeout(1200);
      expect(await strokes(sam.page)).toHaveLength(0);
      await expect(sam.page.getByRole('group', { name: 'Drawing' })).toHaveCount(0);
      for (const p of path.slice(200)) await priya.page.mouse.move(p.x, p.y);
      expect(await strokes(sam.page)).toHaveLength(0);

      await priya.page.mouse.up();
      await expectWithin(async () => (await strokes(sam.page)).length, 'Sam sees the finished stroke').toBe(1);
      const [mine] = await strokes(priya.page);
      const [theirs] = await strokes(sam.page);
      expect(theirs).toEqual(mine);
      expect(theirs.color).toBe('red');
      await expect(sam.page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);
      expect([...priya.errors, ...sam.errors]).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Workflow "Tidy up"', () => {
  test('TC-20 select a stroke by its line, resize it in proportion, move it, delete it on both screens', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people;
    const page = priya.page;
    try {
      for (const p of people) await view(p.page);
      await choosePen(page);
      const drawn = pixelPath(translatePath(HANDWRITTEN_LOOP, { x: 500, y: 350 }));
      await drawPath(page, drawn);
      await expect.poll(async () => (await strokes(page)).length).toBe(1);
      await expectWithin(async () => (await strokes(sam.page)).length).toBe(1);

      await page.keyboard.press('v');
      await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
      const s0 = (await strokes(page))[0];
      // Inside the loop, far from the line: nothing is selected.
      const centre = { x: s0.x + s0.width / 2, y: s0.y + s0.height / 2 };
      await page.mouse.click(centre.x, centre.y);
      expect(await selectedIds(page)).toEqual([]);
      // On the line: the stroke is selected.
      // A drawn point a quarter of the way round the loop: on the line, away from every resize handle.
      const onLine = drawn[Math.round(drawn.length / 9)];
      await page.mouse.click(onLine.x, onLine.y + 3);
      expect(await selectedIds(page)).toEqual([s0.id]);

      // Resize from the bottom-right corner: proportions kept (±1%), thickness unchanged.
      await dragBy(page, await handleCentre(page, 'bottom-right'), 120, 30);
      const s1 = (await strokes(page))[0];
      expect(s1.width).toBeGreaterThan(s0.width + 50);
      expect(Math.abs(s1.width / s1.height / (s0.width / s0.height) - 1)).toBeLessThanOrEqual(0.01);
      expect(s1.thickness).toBe(s0.thickness);
      const lineEl = page.locator(`[data-stroke-id="${s0.id}"] [data-testid="stroke-line"]`);
      await expect(lineEl).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD[s0.thickness]));
      await expectWithin(async () => (await strokes(sam.page))[0]?.width).toBeCloseTo(s1.width, 6);

      // Move it by dragging its line.
      const grab = { x: s1.x + (onLine.x - s0.x) * (s1.width / s0.width), y: s1.y + (onLine.y - s0.y) * (s1.height / s0.height) };
      await dragBy(page, grab, 60, 80);
      const s2 = (await strokes(page))[0];
      expect(s2.x - s1.x).toBeCloseTo(60, 0);
      expect(s2.y - s1.y).toBeCloseTo(80, 0);
      expect({ width: s2.width, height: s2.height }).toEqual({ width: s1.width, height: s1.height });

      await page.keyboard.press('Delete');
      await expect.poll(async () => (await strokes(page)).length).toBe(0);
      await expectWithin(async () => (await strokes(sam.page)).length).toBe(0);
      await expect(sam.page.getByRole('group', { name: 'Drawing' })).toHaveCount(0);
      expect([...priya.errors, ...sam.errors]).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});
