/**
 * Story 11 e2e (TC-17 to TC-20): the Pen tool in real browsers with real pointer capture,
 * frame-rate preview and layout, against `wrangler dev`.
 * Workflows: "Annotate a cluster" (TC-17, TC-19), "Shared sketch" (TC-18), "Tidy up" (TC-20).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { HANDWRITTEN_LOOP } from '../fixtures/pen-paths';
import { getCamera, openBoard, setCamera } from './helpers/board';
import { centreOf, closeAll, createNoteAt, expectWithin, openParticipants, type Participant } from './helpers/participants';

const CAM: Camera = { x: 0, y: 0, zoom: 1 };
const RATIO_TOLERANCE = 0.01;
const WHEEL_PAN_PX = 200;

function strokes(page: Page): Locator {
  return page.locator('.stroke-object');
}

interface RenderedStroke {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeWidth: number;
}

async function renderedStrokes(page: Page): Promise<RenderedStroke[]> {
  return strokes(page).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
        strokeWidth: Number(h.querySelector('.stroke-line')!.getAttribute('stroke-width')),
      };
    }),
  );
}

/** Screen point on the rendered line of a stroke, `fraction` along its length. */
async function pointOnLine(page: Page, id: string, fraction = 0.5): Promise<Point> {
  return page.locator(`[data-id="${id}"] .stroke-line`).evaluate((el, f) => {
    const path = el as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() * f);
    const m = path.getScreenCTM()!;
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }, fraction);
}

/** The loop fixture, shrunk and moved so it fits the viewport at `at` (screen px). */
function loopAt(at: Point, scale: number): Point[] {
  return HANDWRITTEN_LOOP.map((p) => ({ x: at.x + (p.x - 100) * scale, y: at.y + (p.y - 100) * scale }));
}

/** Presses at the first point, moves through the rest, and (unless `release` is false) releases. */
async function drawPath(page: Page, path: readonly Point[], release = true): Promise<void> {
  await page.mouse.move(path[0]!.x, path[0]!.y);
  await page.mouse.down();
  for (const p of path.slice(1)) await page.mouse.move(p.x, p.y);
  if (release) await page.mouse.up();
}

/** Records the preview path's `d` once per animation frame into window.__penFrames. */
async function samplePreviewFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __penFrames: (string | null)[]; __penStop: boolean };
    w.__penFrames = [];
    w.__penStop = false;
    const tick = () => {
      if (w.__penStop) return;
      w.__penFrames.push(document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __penFrames: (string | null)[]; __penStop: boolean };
    w.__penStop = true;
    return w.__penFrames;
  });
}

test.describe('pen.tool — Annotate a cluster', () => {
  test('TC-17 P, real drag replaying the handwritten loop: live preview every frame, stroke kept after release', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');

    const path = loopAt({ x: 300, y: 150 }, 1);
    await samplePreviewFrames(page);
    await drawPath(page, path.slice(0, 200), false);
    await expect(page.getByTestId('pen-preview')).toBeAttached();
    expect(await strokes(page).count()).toBe(0);
    for (const p of path.slice(200)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    const frames = await stopSampling(page);

    // While drawing, the preview changed from one animation frame to the next.
    const drawingFrames = frames.filter((d): d is string => d !== null && d !== '');
    expect(drawingFrames.length).toBeGreaterThan(5);
    let changes = 0;
    for (let i = 1; i < drawingFrames.length; i += 1) if (drawingFrames[i] !== drawingFrames[i - 1]) changes += 1;
    expect(changes).toBeGreaterThanOrEqual(Math.floor(drawingFrames.length / 2));
    // The preview grows as the pointer moves (screen-space points of the drag so far).
    expect(drawingFrames[drawingFrames.length - 1]!.length).toBeGreaterThan(drawingFrames[0]!.length);

    await expect(strokes(page)).toHaveCount(1);
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    const [s] = await renderedStrokes(page);
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    const pad = PEN_THICKNESS_WORLD.medium / 2;
    expect(Math.abs(s!.x - (Math.min(...xs) - pad))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(s!.y - (Math.min(...ys) - pad))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(s!.width - (Math.max(...xs) - Math.min(...xs) + 2 * pad))).toBeLessThanOrEqual(3);
    await expect(page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);

    // A click without moving adds a dot.
    await page.mouse.click(900, 600);
    await expect(strokes(page)).toHaveCount(2);

    // It stays after a reload (saved like any object).
    await page.reload();
    await expect(strokes(page)).toHaveCount(2);
  });

  test('TC-19 while the Pen is active the wheel pans and Ctrl+wheel zooms; a drag over a sticky draws without moving it', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    const noteId = await createNoteAt(page, { x: 500, y: 400 });
    const note = page.locator(`[data-id="${noteId}"]`);
    await page.keyboard.press('p');

    await page.mouse.move(700, 300);
    await page.mouse.wheel(0, WHEEL_PAN_PX);
    await expect.poll(async () => (await getCamera(page)).y).toBeCloseTo(WHEEL_PAN_PX, 0);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await getCamera(page)).zoom).toBeGreaterThan(1);

    await setCamera(page, CAM);
    const before = await note.boundingBox();
    const selectedBefore = await note.getAttribute('data-selected');
    const cameraBefore = await getCamera(page);
    const start = await centreOf(note);
    await drawPath(page, [start, { x: start.x + 40, y: start.y + 20 }, { x: start.x + 120, y: start.y + 60 }, { x: start.x + 200, y: start.y + 90 }]);
    await expect(strokes(page)).toHaveCount(1);
    expect(await note.boundingBox()).toEqual(before);
    expect(await getCamera(page)).toEqual(cameraBefore);
    // Nothing about the note changed: the press went to the Pen, not to the note.
    await expect(note).toHaveAttribute('data-selected', selectedBefore!);
  });
});

test.describe('pen.share and stroke.object — Shared sketch, Tidy up', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(people);
    people = [];
  });

  test('TC-18 Sam sees nothing while Priya draws, and the stroke within the latency budget of release', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people as [Participant, Participant];
    await setCamera(priya.page, CAM);
    await priya.page.keyboard.press('p');
    const path = loopAt({ x: 300, y: 150 }, 0.8);
    await drawPath(priya.page, path, false);
    // Hold the unfinished stroke for longer than the delivery budget: nothing reaches Sam.
    await priya.page.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS * 1.5);
    await expect(priya.page.getByTestId('pen-preview')).toBeAttached();
    expect(await strokes(sam.page).count()).toBe(0);
    await priya.page.mouse.up();
    await expectWithin(() => strokes(sam.page).count(), 'stroke reaches Sam').toBe(1);
    const [a] = await renderedStrokes(priya.page);
    const [b] = await renderedStrokes(sam.page);
    expect(b).toEqual(a);
    expect(priya.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });

  test('TC-20 V, click the line, resize by a corner in proportion, move, Delete: removed on both screens', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people as [Participant, Participant];
    const page = priya.page;
    await setCamera(page, CAM);
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Red pen' }).click();
    await page.getByRole('button', { name: 'Thick' }).click();
    await drawPath(page, loopAt({ x: 300, y: 150 }, 0.6));
    await expect(strokes(page)).toHaveCount(1);
    const [s0] = await renderedStrokes(page);
    const id = s0!.id;
    const el = page.locator(`[data-id="${id}"]`);
    await expectWithin(() => strokes(sam.page).count()).toBe(1);

    await page.keyboard.press('v');
    // Clicking empty space inside the loop selects nothing.
    await page.mouse.click(s0!.x + s0!.width / 2, s0!.y + s0!.height / 2);
    await expect(el).toHaveAttribute('data-selected', 'false');
    const onLine = await pointOnLine(page, id, 0.3);
    await page.mouse.click(onLine.x, onLine.y);
    await expect(el).toHaveAttribute('data-selected', 'true');

    // Resize by the bottom-right handle: grows in proportion, thickness unchanged.
    const se = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move(se.x + 150, se.y + 40, { steps: 10 });
    await page.mouse.up();
    const [s1] = await renderedStrokes(page);
    expect(s1!.width).toBeGreaterThan(s0!.width * 1.2);
    expect(Math.abs(s1!.width / s1!.height - s0!.width / s0!.height) / (s0!.width / s0!.height)).toBeLessThanOrEqual(RATIO_TOLERANCE);
    expect(s1!.strokeWidth).toBe(PEN_THICKNESS_WORLD.thick);
    const d1 = await el.locator('.stroke-line').getAttribute('d');
    await expectWithin(async () => (await renderedStrokes(sam.page))[0]?.width).toBeCloseTo(s1!.width, 3);

    // Move by dragging the line itself.
    const grab = await pointOnLine(page, id, 0.6);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 40, grab.y + 60, { steps: 8 });
    await page.mouse.up();
    const [s2] = await renderedStrokes(page);
    expect(s2!.x).toBeCloseTo(s1!.x + 40, 3);
    expect(s2!.y).toBeCloseTo(s1!.y + 60, 3);
    expect(s2!.width).toBeCloseTo(s1!.width, 6);
    expect(await el.locator('.stroke-line').getAttribute('d')).toBe(d1);
    await expectWithin(async () => (await renderedStrokes(sam.page))[0]?.x).toBeCloseTo(s2!.x, 3);

    await expect(el).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(strokes(page)).toHaveCount(0);
    await expectWithin(() => strokes(sam.page).count(), 'delete reaches Sam').toBe(0);
    expect(priya.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });
});
