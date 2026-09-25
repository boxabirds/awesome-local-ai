import { expect, test, type Page } from '@playwright/test';
import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { HANDWRITTEN_LOOP, UNDERLINE, type PenPoint } from '../fixtures/pen-paths';
import { getCamera, getNotes, nextFrames, noteLocator, openBoard } from './helpers/board';
import {
  closeParticipants,
  expectWithin,
  openParticipants,
  waitConnected,
  type Participant,
} from './helpers/participants';
import { centreOf, dragBetween, worldToPage, type Pt } from './helpers/shapes';

/**
 * Story 11 e2e (pen.tool, stroke.object) in a real browser against the real sync server:
 * "Annotate a cluster" (TC-17, TC-19), "Shared sketch" (TC-18) and "Tidy up" (TC-20).
 */

const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Share of consecutive sampled animation frames (during the drag) whose preview changed. */
const MIN_CHANGED_FRAME_SHARE = 0.8;
/** Frames sampled while drawing must be at least this many for the share to mean anything. */
const MIN_SAMPLED_FRAMES = 10;
/** Aspect ratio after a corner resize must stay within 1%. */
const ASPECT_TOLERANCE = 0.01;
/** How far (screen px) the corner handle and the body are dragged in TC-20. */
const RESIZE_BY_PX = 120;
const MOVE_BY = { x: 0, y: 80 } as const;
const WHEEL_DELTA_PX = 200;
const HALF = 2;
const TRIES_WHILE_DRAWING = 5;
/** The fixtures are drawn this far right/down, clear of the left toolbar and the pen toolbar. */
const DRAW_OFFSET = { x: 300, y: 60 } as const;

function placed(points: readonly PenPoint[]): PenPoint[] {
  return points.map((p) => ({ x: p.x + DRAW_OFFSET.x, y: p.y + DRAW_OFFSET.y }));
}

const LOOP = placed(HANDWRITTEN_LOOP);
const UNDER = placed(UNDERLINE);

interface StrokeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  points: number[];
  color: string;
  thickness: string;
}

async function strokes(page: Page): Promise<StrokeState[]> {
  return page.evaluate(() =>
    window
      .__vidi6!.getObjects()
      .filter((o) => o.type === 'stroke')
      .map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        width: o.width ?? 0,
        height: o.height ?? 0,
        baseWidth: o.baseWidth ?? 0,
        baseHeight: o.baseHeight ?? 0,
        points: [...(o.points ?? [])],
        color: String(o.color),
        thickness: String(o.thickness),
      })),
  );
}

/** Fraction along the stored points used to grab the loop: a diagonal, away from every resize handle. */
const GRAB_AT = 1 / 8;

/** A world point on the stroke's drawn line (a stored point at `fraction` along it, scaled to its box). */
function pointOn(s: StrokeState, fraction: number): Pt {
  const i = Math.floor((s.points.length / HALF - 1) * fraction);
  return {
    x: s.x + s.points[i * HALF]! * (s.width / s.baseWidth),
    y: s.y + s.points[i * HALF + 1]! * (s.height / s.baseHeight),
  };
}

async function choosePen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible();
}

/** Presses at the first point and moves through the rest (the button stays down). */
async function strokeThrough(page: Page, points: readonly PenPoint[]): Promise<void> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
}

async function draw(page: Page, points: readonly PenPoint[]): Promise<void> {
  await strokeThrough(page, points);
  await page.mouse.up();
  await nextFrames(page);
}

test.describe('pen: annotate a cluster', () => {
  test('TC-17 a real drag shows a preview redrawn every frame; the stroke persists after release', async ({ page }) => {
    await openBoard(page);
    await choosePen(page);
    // Sample the preview's `d` once per animation frame in the page.
    await page.evaluate(() => {
      const w = window as unknown as { __penSamples: string[]; __penSampling: boolean };
      w.__penSamples = [];
      w.__penSampling = true;
      const tick = () => {
        if (!w.__penSampling) return;
        const d = document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? '';
        if (d) w.__penSamples.push(d);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await strokeThrough(page, LOOP);
    await nextFrames(page);
    const samples = await page.evaluate(() => {
      const w = window as unknown as { __penSamples: string[]; __penSampling: boolean };
      w.__penSampling = false;
      return w.__penSamples;
    });
    // Nothing is in the document while drawing; the preview path exists.
    expect(await strokes(page)).toHaveLength(0);
    await expect(page.getByTestId('pen-preview')).toHaveAttribute('d', /^M/);
    expect(samples.length).toBeGreaterThanOrEqual(MIN_SAMPLED_FRAMES);
    // Drop the trailing frames sampled after the last move (the preview no longer changes).
    let end = samples.length;
    while (end > 1 && samples[end - 1] === samples[end - 2]) end -= 1;
    const moving = samples.slice(0, end);
    let changed = 0;
    for (let i = 1; i < moving.length; i += 1) if (moving[i] !== moving[i - 1]) changed += 1;
    expect(changed / (moving.length - 1)).toBeGreaterThanOrEqual(MIN_CHANGED_FRAME_SHARE);

    await page.mouse.up();
    await nextFrames(page);
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const [s] = await strokes(page);
    expect(s).toMatchObject({ color: 'black', thickness: 'medium' });
    // Smoothed: far fewer stored points than the ~400 recorded.
    expect(s!.points.length / HALF).toBeLessThan(HANDWRITTEN_LOOP.length);
    await expect(page.getByRole('group', { name: 'Drawing' })).toHaveCount(1);
    await expect(page.getByTestId('pen-preview')).toHaveAttribute('d', '');
    // Still the Pen; a second stroke in red / Thick.
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Red pen' }).click();
    await page.getByRole('button', { name: 'Thick' }).click();
    await draw(page, UNDER);
    await expect.poll(async () => (await strokes(page)).length).toBe(2);
    expect((await strokes(page)).find((x) => x.id !== s!.id)).toMatchObject({ color: 'red', thickness: 'thick' });
    // A click draws a dot the size of the thickness.
    await page.mouse.click(900, 600);
    await expect.poll(async () => (await strokes(page)).length).toBe(3);
    const dot = (await strokes(page)).find((x) => x.points.length === HALF)!;
    expect(dot.width).toBe(PEN_THICKNESS_WORLD.thick);
    // Reload: the choices are back to the defaults, the strokes are kept.
    await page.reload();
    await waitConnected(page);
    await expect.poll(async () => (await strokes(page)).length).toBe(3);
    await choosePen(page);
    await expect(page.getByRole('button', { name: 'Black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-19 with the Pen, the wheel pans the board; a drag starting on a sticky draws and leaves the sticky in place', async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await getNotes(page)).length).toBe(1);
    const note = (await getNotes(page))[0]!;
    await choosePen(page);

    const camBefore = await getCamera(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, WHEEL_DELTA_PX);
    await expect.poll(async () => (await getCamera(page)).y).toBeGreaterThan(camBefore.y);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    const camAfterWheel = await getCamera(page);

    const start = await centreOf(noteLocator(page, note.id));
    await dragBetween(page, start, { x: start.x + 150, y: start.y + 60 });
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const after = (await getNotes(page))[0]!;
    expect({ x: after.x, y: after.y }).toEqual({ x: note.x, y: note.y });
    expect(await getCamera(page)).toEqual(camAfterWheel);
    // Escape leaves the Pen.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('toolbar', { name: 'Pen' })).toHaveCount(0);
  });
});

test.describe('pen: shared sketch and tidy up', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test('TC-18 Sam sees nothing while Priya draws, and the stroke within the live budget of her release', async ({
    browser,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people as [Participant, Participant];
    await choosePen(priya.page);
    await strokeThrough(priya.page, LOOP);
    // Still drawing: nothing reaches Sam (checked over a stretch of time, not once).
    for (let i = 0; i < TRIES_WHILE_DRAWING; i += 1) {
      await nextFrames(sam.page);
      expect(await strokes(sam.page)).toHaveLength(0);
      await expect(sam.page.getByTestId('stroke-object')).toHaveCount(0);
    }
    await priya.page.mouse.up();
    await expectWithin(() => sam.page.getByTestId('stroke-object').count()).toBe(1);
    const [mine] = await strokes(priya.page);
    const [theirs] = await strokes(sam.page);
    expect(theirs).toEqual(mine);
    expect(priya.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });

  test('TC-20 select by the line, resize in proportion, move, delete: on both screens', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Priya', 'Sam']);
    const [priya, sam] = people as [Participant, Participant];
    const page = priya.page;
    await choosePen(page);
    await draw(page, LOOP);
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    const s = (await strokes(page))[0]!;
    const ratio = s.width / s.height;

    await page.keyboard.press('v');
    // A click in the middle of the loop (inside its box, far from the line) selects nothing.
    const inside = await worldToPage(page, { x: s.x + s.width / HALF, y: s.y + s.height / HALF });
    await page.mouse.click(inside.x, inside.y);
    expect(await page.evaluate(() => window.__vidi6!.getSelection())).toEqual([]);
    // A click on the line selects it.
    const on = await worldToPage(page, pointOn(s, GRAB_AT));
    await page.mouse.click(on.x, on.y);
    await expect.poll(() => page.evaluate(() => window.__vidi6!.getSelection())).toEqual([s.id]);

    // Corner handle: bigger, same proportions, same thickness.
    const corner = await centreOf(page.getByRole('button', { name: 'Resize bottom-right' }));
    await dragBetween(page, corner, { x: corner.x + RESIZE_BY_PX, y: corner.y + RESIZE_BY_PX });
    const resized = (await strokes(page))[0]!;
    expect(resized.width).toBeGreaterThan(s.width);
    expect(Math.abs(resized.width / resized.height - ratio) / ratio).toBeLessThanOrEqual(ASPECT_TOLERANCE);
    expect(resized.thickness).toBe(s.thickness);
    expect(resized.points).toEqual(s.points);
    await expectWithin(async () => (await strokes(sam.page))[0]?.width).toBe(resized.width);

    // Drag the line itself: the stroke moves.
    const grab = await worldToPage(page, pointOn(resized, GRAB_AT));
    await dragBetween(page, grab, { x: grab.x + MOVE_BY.x, y: grab.y + MOVE_BY.y });
    const moved = (await strokes(page))[0]!;
    const cam = await getCamera(page);
    expect(moved.y - resized.y).toBeCloseTo(MOVE_BY.y / cam.zoom, 0);
    expect(moved.width).toBe(resized.width);
    await expectWithin(async () => (await strokes(sam.page))[0]?.y).toBe(moved.y);

    // Delete: gone on both screens.
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await strokes(page)).length).toBe(0);
    await expectWithin(() => sam.page.getByTestId('stroke-object').count()).toBe(0);
    expect(priya.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });
});
