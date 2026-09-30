// Story 11 e2e: workflows "Annotate a cluster" (TC-17, TC-19), "Shared sketch" (TC-18) and
// "Tidy up" (TC-20) with real pointer input and layout against the real sync service
// (wrangler dev). Delivery times are logged against LIVE_UPDATE_LATENCY_BUDGET_MS, not asserted.
import { type Page, type TestInfo, expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths';
import { getCamera, openBoard, setCamera, waitForFrame } from './helpers/board';
import { LatencyLog, type Participant, openParticipants } from './helpers/participants';

interface Point {
  x: number;
  y: number;
}
interface Obj {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: keyof typeof PEN_THICKNESS_WORLD;
}

const CAMERA = { x: 0, y: 0, zoom: 1 };
/**
 * Each synthetic mouse move is a round trip to the browser (~0.1 s on a loaded machine), so
 * the recorded paths are replayed at every 3rd point; the gesture shape is unchanged.
 */
const every = (path: readonly Point[], n: number) => path.filter((_, i) => i % n === 0 || i === path.length - 1);
const LOOP = every(HANDWRITTEN_LOOP, 3);

test.beforeEach(() => {
  test.setTimeout(90_000);
});

async function showCamera(page: Page) {
  await setCamera(page, CAMERA);
  await expect.poll(() => getCamera(page)).toEqual(CAMERA);
  await waitForFrame(page);
}

async function objects(page: Page): Promise<Obj[]> {
  return page.evaluate(() => window.__vidi6!.getObjects!() as unknown as Obj[]);
}
async function strokes(page: Page) {
  return (await objects(page)).filter((o) => o.type === 'stroke');
}

/** World points of a stroke at its current position and size. */
function worldPoints(s: Obj): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < s.points.length; i += 2) {
    out.push({ x: s.x + (s.points[i] * s.width) / s.baseWidth, y: s.y + (s.points[i + 1] * s.height) / s.baseHeight });
  }
  return out;
}

/** Replays a recorded path (relative to `at`) with the mouse; the button stays down unless `release`. */
async function replay(page: Page, path: readonly Point[], at: Point, release = true) {
  await page.mouse.move(at.x + path[0].x, at.y + path[0].y);
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(at.x + p.x, at.y + p.y);
  if (release) {
    await page.mouse.up();
    await waitForFrame(page);
  }
}

async function dragBy(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await waitForFrame(page);
}

const drawings = (page: Page) => page.getByRole('img', { name: 'Drawing' });
const penButton = (page: Page) => page.getByRole('button', { name: 'Pen (P)' });

function expectNoProblems(...people: Participant[]) {
  for (const p of people) expect(p.problems, `${p.name} console/page errors`).toEqual([]);
}

test.describe('Workflow: Annotate a cluster', () => {
  test('TC-17 a real drag replaying a handwritten loop: the preview follows every frame; the stroke stays', async ({
    page,
  }) => {
    await openBoard(page);
    await showCamera(page);
    await page.keyboard.press('p');
    await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');

    // On every animation frame, record the preview path's `d` and how many pointer moves the
    // page has received so far.
    await page.evaluate(() => {
      const w = window as unknown as { __penFrames: { d: string | null; moves: number }[]; __penStop: boolean };
      w.__penFrames = [];
      w.__penStop = false;
      let moves = 0;
      window.addEventListener('pointermove', () => moves++, { capture: true });
      const tick = () => {
        if (w.__penStop) return;
        w.__penFrames.push({ d: document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null, moves });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const centre = { x: 640, y: 400 };
    await replay(page, LOOP, centre, false);
    await expect(page.getByTestId('pen-preview')).toBeAttached();
    expect(await strokes(page)).toHaveLength(0);
    await page.mouse.up();
    await waitForFrame(page);
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __penFrames: { d: string | null; moves: number }[]; __penStop: boolean };
      w.__penStop = true;
      return w.__penFrames;
    });
    // The pen redraws in the frame after moves arrive, and this sampler runs before it in each
    // frame: whenever moves arrived before frame k-1, frame k shows a different path than k-1.
    let checked = 0;
    let updated = 0;
    for (let k = 2; k < frames.length; k++) {
      const [a, b] = [frames[k - 1], frames[k]];
      if (!a.d || !b.d || frames[k - 1].moves <= frames[k - 2].moves) continue;
      checked++;
      if (a.d !== b.d) updated++;
    }
    console.log(`TC-17 preview: ${frames.length} frames sampled, ${updated}/${checked} frames after moves redrawn`);
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(updated).toBe(checked);

    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const [s] = await strokes(page);
    expect(s).toMatchObject({ color: 'black', thickness: 'medium' });
    // Smoothed: fewer points, still within 1 px of the drawn path.
    expect(s.points.length / 2).toBeLessThan(LOOP.length);
    await expect(drawings(page)).toHaveCount(1);
    await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');

    // Saved: still there after a reload.
    await page.reload();
    await expect(drawings(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

});

test.describe('Workflow: Annotate a cluster (navigation)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (design)');

  test('TC-19 scrolling pans while the Pen is active; a drag starting on a sticky draws and leaves it in place', async ({
    page,
  }) => {
    await openBoard(page);
    await showCamera(page);
    // A note at (600, 400), then back to no selection.
    await page.mouse.dblclick(600, 400);
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    const [note] = await objects(page);

    await page.keyboard.press('p');
    await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await getCamera(page)).y).toBe(100);
    await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');
    const cam = await getCamera(page);

    // The note is now drawn 100 px higher: start the pen drag on it.
    await replay(page, every(UNDERLINE, 2), { x: 560, y: 300 });
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const after = (await objects(page)).find((o) => o.id === note.id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: note.x, y: note.y });
    expect(await getCamera(page)).toEqual(cam);
    // The stroke is where it was drawn, in world units.
    const [s] = await strokes(page);
    const first = worldPoints(s)[0];
    expect(first.x).toBeCloseTo(560 + UNDERLINE[0].x + cam.x, 0);
    expect(first.y).toBeCloseTo(300 + UNDERLINE[0].y + cam.y, 0);
  });
});

test.describe('Workflow: Shared sketch', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (design)');

  test('TC-18 Sam sees nothing while Priya draws, then the finished stroke', async ({ browser }, testInfo: TestInfo) => {
    const session = await openParticipants(browser, testInfo, ['Priya', 'Sam']);
    const [priya, sam] = session.participants;
    const log = new LatencyLog();
    try {
      await showCamera(priya.page);
      await showCamera(sam.page);
      await priya.page.keyboard.press('p');
      await priya.page.getByRole('button', { name: 'red pen' }).click();
      await priya.page.getByRole('button', { name: 'Thick' }).click();
      await replay(priya.page, every(HANDWRITTEN_LOOP.slice(0, 250), 3), { x: 640, y: 400 }, false);
      // Mid-drag, and well past the delivery budget: nothing for Sam (or on Priya's board).
      await priya.page.waitForTimeout(1500);
      expect(await strokes(sam.page)).toHaveLength(0);
      await expect(drawings(sam.page)).toHaveCount(0);
      expect(await strokes(priya.page)).toHaveLength(0);

      await priya.page.mouse.up();
      await expect(drawings(priya.page)).toHaveCount(1);
      const released = Date.now();
      await log.expectEventually('finished stroke appears for Sam', async () => (await drawings(sam.page).count()) === 1, released);
      const [s] = await strokes(sam.page);
      expect(s).toMatchObject({ color: 'red', thickness: 'thick' });
      expectNoProblems(priya, sam);
    } finally {
      testInfo.annotations.push({ type: 'latency', description: log.report('TC-18 pen share') });
      await session.close();
    }
  });
});

test.describe('Workflow: Tidy up', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (design)');

  test('TC-20 select by the line, resize in proportion, move, delete on both screens', async ({ browser }, testInfo: TestInfo) => {
    const session = await openParticipants(browser, testInfo, ['Priya', 'Sam']);
    const [priya, sam] = session.participants;
    const log = new LatencyLog();
    const page = priya.page;
    try {
      await showCamera(page);
      await showCamera(sam.page);
      await page.keyboard.press('p');
      // A rough diagonal "arrow sketch" from (400, 300) to (600, 450).
      const path = Array.from({ length: 60 }, (_, i) => ({ x: (i * 200) / 59, y: (i * 150) / 59 + Math.sin(i / 4) * 2 }));
      await replay(page, path, { x: 400, y: 300 });
      await expect.poll(async () => (await strokes(page)).length).toBe(1);
      const [s0] = await strokes(page);
      await expect.poll(async () => (await strokes(sam.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      await page.keyboard.press('v');
      // Inside the stroke's box but away from its line: nothing selected.
      await page.mouse.click(420, 430);
      await expect(page.getByTestId('selection-box')).toHaveCount(0);
      // On the line: selected.
      const onLine = worldPoints(s0)[Math.floor(s0.points.length / 4)];
      await page.mouse.click(onLine.x, onLine.y);
      await expect(page.getByTestId('selection-box')).toBeVisible();
      await expect(page.locator(`[data-object-id="${s0.id}"]`)).toHaveAttribute('data-selected', 'true');

      // Corner handle: larger, in proportion; the line width does not change.
      const handle = page.getByRole('button', { name: 'Resize bottom-right' });
      const hb = (await handle.boundingBox())!;
      const hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
      await dragBy(page, hc, { x: hc.x + 150, y: hc.y + 60 });
      await expect.poll(async () => (await strokes(page))[0].width).toBeGreaterThan(s0.width * 1.3);
      const [s1] = await strokes(page);
      expect(Math.abs(s1.width / s1.height / (s0.width / s0.height) - 1)).toBeLessThan(0.01);
      expect(s1.thickness).toBe(s0.thickness);
      const path1 = page.locator(`[data-object-id="${s0.id}"] path`);
      await expect(path1).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD[s0.thickness]));
      await log.expectEventually('resize reaches Sam', async () => {
        const [t] = await strokes(sam.page);
        return !!t && t.width === s1.width && t.height === s1.height;
      });

      // Drag the line itself: moved.
      const grab = worldPoints(s1)[Math.floor(s1.points.length / 4)];
      await dragBy(page, grab, { x: grab.x, y: grab.y + 80 });
      await expect.poll(async () => (await strokes(page))[0].y).toBeCloseTo(s1.y + 80, 2);
      expect((await strokes(page))[0].x).toBeCloseTo(s1.x, 2);

      await page.keyboard.press('Delete');
      await expect(drawings(page)).toHaveCount(0);
      const deleted = Date.now();
      await log.expectEventually('delete reaches Sam', async () => (await drawings(sam.page).count()) === 0, deleted);
      expectNoProblems(priya, sam);
    } finally {
      testInfo.annotations.push({ type: 'latency', description: log.report('TC-20 tidy up') });
      await session.close();
    }
  });
});
