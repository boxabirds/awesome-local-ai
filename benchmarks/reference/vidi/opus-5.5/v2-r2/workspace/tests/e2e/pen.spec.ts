import { type Page, expect, test } from '@playwright/test';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { getCamera, nextFrames, openBoard, setCamera } from './helpers/board';
import { LatencyLog, closeParticipants, expectEventually, openParticipants } from './helpers/participants';

// Camera at world (0, 0), 100%: screen pixels = world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };

async function objects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getObjects?.() ?? [])]);
}

async function strokes(page: Page): Promise<ObjectSnapshot[]> {
  return (await objects(page)).filter((o) => o.type === 'stroke');
}

async function selectionOf(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6?.getSelection?.() ?? []);
}

function strokeLocator(page: Page, id: string) {
  return page.locator(`[data-stroke-object][data-id="${id}"]`);
}

/** Replays `points` (screen px) as one real mouse drag; `beforeUp` runs while the button is still down. */
async function drawPath(page: Page, points: readonly Point[], beforeUp?: () => Promise<void>) {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
  await beforeUp?.();
  await page.mouse.up();
}

async function pen(page: Page) {
  await page.keyboard.press('p');
  await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('toolbar', { name: 'Pen' })).toBeVisible();
}

test.describe('Annotate a cluster', () => {
  test('TC-17 a real drag shows a preview updated per animation frame; the stroke persists after release', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    await pen(page);
    const loop = handwrittenLoop();
    // Sample the preview's path once per animation frame while drawing.
    await page.evaluate(() => {
      const w = window as unknown as { __penSamples: (string | null)[]; __penSampling: boolean };
      w.__penSamples = [];
      w.__penSampling = true;
      const tick = () => {
        if (!w.__penSampling) return;
        w.__penSamples.push(document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await drawPath(page, loop, async () => {
      await expect(page.getByTestId('pen-preview')).toBeVisible();
      await nextFrames(page);
      // Nothing is committed while drawing.
      expect(await strokes(page)).toHaveLength(0);
    });
    const samples = await page.evaluate(() => {
      const w = window as unknown as { __penSamples: (string | null)[]; __penSampling: boolean };
      w.__penSampling = false;
      return w.__penSamples;
    });
    const drawn = samples.filter((d): d is string => d !== null);
    expect(drawn.length).toBeGreaterThan(10);
    // The path changes from one frame to the next while the pointer moves.
    let changes = 0;
    for (let i = 1; i < drawn.length; i++) if (drawn[i] !== drawn[i - 1]) changes++;
    expect(changes).toBeGreaterThan(10);
    // The final preview reached the last point before release.
    const lastD = drawn.at(-1)!;
    const tail = lastD.trim().split(/\s+/).slice(-2).map(Number);
    expect(Math.abs(tail[0]! - loop.at(-1)!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tail[1]! - loop.at(-1)!.y)).toBeLessThanOrEqual(1);

    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    const [s] = await strokes(page);
    await expect(strokeLocator(page, s!.id)).toHaveAttribute('aria-label', 'Drawing');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    // The stroke is part of the board: it is still there after a reload.
    await page.reload();
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
    await expect.poll(async () => (await strokes(page)).map((o) => o.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual([s!.id]);
    await expect(strokeLocator(page, s!.id)).toBeAttached();
  });

  test('TC-19 scrolling pans while the Pen is active; a drag starting on a sticky draws and leaves it in place', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAMERA);
    const [note] = await page.evaluate(() => window.__vidi6!.seedNotes!([{ x: 500, y: 300 }]));
    await pen(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await getCamera(page)).y).toBeCloseTo(200, 0);
    const camera = await getCamera(page);
    expect(camera.zoom).toBe(1);
    await nextFrames(page);
    // The note's centre (world 600, 400) is now at screen (600, 200).
    const noteBox = await page.locator(`[data-sticky-note][data-id="${note}"]`).boundingBox();
    expect(Math.abs(noteBox!.x - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(noteBox!.y - 100)).toBeLessThanOrEqual(1);
    await drawPath(page, underline(560, 200, 300));
    await expect.poll(async () => (await strokes(page)).length).toBe(1);
    // The pen drag neither panned nor moved the note, and selected nothing.
    expect(await getCamera(page)).toEqual(camera);
    const n = (await objects(page)).find((o) => o.id === note)!;
    expect({ x: n.x, y: n.y }).toEqual({ x: 500, y: 300 });
    expect(await selectionOf(page)).toEqual([]);
    const [s] = await strokes(page);
    // The stroke is where it was drawn, in world units (screen + camera).
    expect(Math.abs(s!.x + PEN_THICKNESS_WORLD.medium / 2 - 560)).toBeLessThanOrEqual(1);
    expect(s!.y).toBeGreaterThan(390);
    // Ctrl + scroll still zooms.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await getCamera(page)).zoom).toBeGreaterThan(1);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('Shared sketch', () => {
  test('TC-18 Sam sees nothing while Priya draws, then the finished stroke', async ({ browser }, testInfo) => {
    const [priya, sam] = await openParticipants(browser, 2);
    const log = new LatencyLog();
    try {
      for (const p of [priya!, sam!]) await setCamera(p.page, CAMERA);
      await pen(priya!.page);
      let releasedAt = 0;
      await drawPath(priya!.page, handwrittenLoop(640, 400, 200, 150, 150), async () => {
        // Give any (wrongly) sent update ample time to arrive.
        await priya!.page.waitForTimeout(700);
        expect(await strokes(sam!.page)).toHaveLength(0);
        await expect(sam!.page.locator('[data-stroke-object]')).toHaveCount(0);
        releasedAt = Date.now();
      });
      await expectEventually(log, 'finished stroke', [sam!], async (page) => (await strokes(page)).length, 1, releasedAt);
      const [mine] = await strokes(priya!.page);
      const [theirs] = await strokes(sam!.page);
      expect(theirs).toEqual(mine);
      await expect(strokeLocator(sam!.page, mine!.id)).toBeAttached();
      const d = (page: Page) => strokeLocator(page, mine!.id).locator('.stroke-line').getAttribute('d');
      expect(await d(sam!.page)).toBe(await d(priya!.page));
      expect([...priya!.problems, ...sam!.problems]).toEqual([]);
    } finally {
      await log.report(testInfo);
      await closeParticipants([priya!, sam!]);
    }
  });
});

test.describe('Tidy up', () => {
  test('TC-20 select by the line, resize in proportion, move and delete on both screens', async ({ browser }, testInfo) => {
    const [priya, sam] = await openParticipants(browser, 2);
    const log = new LatencyLog();
    try {
      for (const p of [priya!, sam!]) await setCamera(p.page, CAMERA);
      const page = priya!.page;
      await pen(page);
      // A diagonal line from (300, 300) to (500, 400).
      const line = Array.from({ length: 41 }, (_, i) => ({ x: 300 + i * 5, y: 300 + i * 2.5 }));
      await drawPath(page, line);
      await expect.poll(async () => (await strokes(page)).length).toBe(1);
      const [s0] = await strokes(page);
      await page.keyboard.press('v');
      await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');

      // Inside the box but far from the line: nothing is selected.
      await page.mouse.click(320, 390);
      await nextFrames(page);
      expect(await selectionOf(page)).toEqual([]);
      // On the line: selected.
      await page.mouse.click(400, 352);
      await expect.poll(() => selectionOf(page)).toEqual([s0!.id]);
      await expect(page.getByRole('toolbar', { name: 'Drawing' })).toBeVisible();

      // Corner handle 100 px right: the stroke grows in proportion.
      const handle = await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox();
      await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle!.x + handle!.width / 2 + 100, handle!.y + handle!.height / 2 + 10, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await strokes(page))[0]!.width).toBeGreaterThan(s0!.width + 50);
      const [s1] = await strokes(page);
      const ratio0 = s0!.width / s0!.height;
      const ratio1 = s1!.width / s1!.height;
      expect(Math.abs(ratio1 - ratio0) / ratio0).toBeLessThanOrEqual(0.01);
      expect(s1!.thickness).toBe(s0!.thickness);
      const lineEl = strokeLocator(page, s0!.id).locator('.stroke-line');
      await expect(lineEl).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD.medium));
      // The drawn line itself scaled: its rendered box grew by the same factor.
      const scale = s1!.width / s0!.width;
      const box = await lineEl.boundingBox();
      expect(Math.abs(box!.width - 200 * scale - PEN_THICKNESS_WORLD.medium)).toBeLessThanOrEqual(3);

      // Drag the body (by its line) 60 px down.
      const mid = { x: s1!.x + s1!.width / 2, y: s1!.y + s1!.height / 2 };
      await page.mouse.move(mid.x, mid.y);
      await page.mouse.down();
      await page.mouse.move(mid.x, mid.y + 60, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await strokes(page))[0]!.y).toBeCloseTo(s1!.y + 60, 0);
      const [s2] = await strokes(page);
      expect(s2!.x).toBeCloseTo(s1!.x, 0);
      await expectEventually(log, 'moved stroke', [sam!], async (p) => (await strokes(p))[0]?.y, s2!.y);

      // Delete: removed on both screens.
      await page.keyboard.press('Delete');
      const deletedAt = Date.now();
      await expect.poll(async () => (await strokes(page)).length).toBe(0);
      await expectEventually(log, 'deleted stroke', [sam!], async (p) => (await strokes(p)).length, 0, deletedAt);
      await expect(sam!.page.locator('[data-stroke-object]')).toHaveCount(0);
    } finally {
      await log.report(testInfo);
      await closeParticipants([priya!, sam!]);
    }
  });
});
