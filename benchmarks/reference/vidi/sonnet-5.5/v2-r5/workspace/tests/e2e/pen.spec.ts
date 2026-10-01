import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { getCamera, settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { drag, expectEventually, openParticipants } from './helpers/participants';
import { handwrittenLoop } from '../fixtures/pen-paths';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const strokes = (page: Page) => page.locator('[data-stroke]');
const stickies = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

async function frame(page: Page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}

test.describe('annotate a cluster', () => {
  test.beforeEach(async ({ page, request }) => {
    const id = await createBoardVia(request);
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible(EVENTUALLY);
    await settled(page);
  });

  test('TC-17 the preview follows a real drag frame by frame and the stroke persists after release', async ({ page }) => {
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    const loop = handwrittenLoop(500, 400, 150).filter((_, i) => i % 8 === 0);
    await page.mouse.move(loop[0].x, loop[0].y);
    await page.mouse.down();
    const seen = new Set<string>();
    for (const p of loop.slice(1, 12)) {
      await page.mouse.move(p.x, p.y);
      await frame(page);
      await frame(page);
      seen.add((await page.getByTestId('pen-preview').getAttribute('d')) ?? '');
    }
    expect(seen.size).toBeGreaterThanOrEqual(8); // the path changed on (nearly) every sampled frame
    for (const p of loop.slice(12)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    await expect(strokes(page)).toHaveCount(1);
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(page.getByTestId('pen-tool-layer')).toHaveCount(1); // the pen stays active
    await page.reload();
    await expect(strokes(page)).toHaveCount(1, EVENTUALLY);
  });

  test('TC-19 wheel pans while the pen is active; a drag starting on a sticky draws and does not move it', async ({ page }) => {
    await page.mouse.dblclick(640, 400);
    await page.keyboard.press('Escape');
    await expect(stickies(page)).toHaveCount(1);
    const before = (await stickies(page).first().boundingBox())!;
    await page.keyboard.press('p');
    const cam = await getCamera(page);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await getCamera(page)).y).not.toBe(cam.y);
    await settled(page);
    const panned = (await stickies(page).first().boundingBox())!;
    expect(panned.y).not.toBe(before.y);
    await drag(page, { x: panned.x + 40, y: panned.y + 40 }, 80, 30);
    await expect(strokes(page)).toHaveCount(1);
    const after = (await stickies(page).first().boundingBox())!;
    expect(after.x).toBe(panned.x);
    expect(after.y).toBe(panned.y);
    const camAfter = await getCamera(page);
    await settled(page);
    expect(await getCamera(page)).toEqual(camAfter);
  });
});

test('TC-18 Sam sees nothing while Priya draws and the finished stroke after release', async ({ browser }) => {
  const [priya, sam] = await openParticipants(browser, ['Priya', 'Sam']);
  await priya.page.keyboard.press('p');
  await priya.page.mouse.move(300, 300);
  await priya.page.mouse.down();
  await priya.page.mouse.move(450, 380, { steps: 10 });
  await priya.page.mouse.move(600, 300, { steps: 10 });
  await expect(priya.page.getByTestId('pen-preview')).toBeVisible();
  await sam.page.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS + 500);
  await expect(strokes(sam.page)).toHaveCount(0);
  await expect(strokes(priya.page)).toHaveCount(0);
  const released = Date.now();
  await priya.page.mouse.up();
  await expect(strokes(priya.page)).toHaveCount(1);
  await expectEventually('stroke visible on Sam', () => strokes(sam.page).count(), 1);
  console.log(`[latency] release-to-visible: ${Date.now() - released}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, not asserted)`);
  expect(priya.errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('TC-20 select by the line, resize in proportion, move and delete on both screens', async ({ browser }) => {
  const [priya, sam] = await openParticipants(browser, ['Priya', 'Sam']);
  const page = priya.page;
  await page.keyboard.press('p');
  await page.getByRole('button', { name: 'red pen' }).click();
  await page.getByRole('button', { name: 'Thick' }).click();
  await drag(page, { x: 400, y: 300 }, 200, 100);
  await expect(strokes(page)).toHaveCount(1);
  await expect(strokes(sam.page)).toHaveCount(1, EVENTUALLY);
  await expect(strokes(page).first()).toHaveAttribute('data-color', 'red');
  await expect(strokes(page).first()).toHaveAttribute('data-thickness', 'thick');

  await page.keyboard.press('v');
  // Inside the box but far from the diagonal: nothing is selected.
  await page.mouse.click(590, 305);
  await expect(strokes(page).first()).toHaveAttribute('data-selected', 'false');
  // On the line: selected.
  await page.mouse.click(500, 350);
  await expect(strokes(page).first()).toHaveAttribute('data-selected', 'true');

  const ratio = async () => {
    const b = (await strokes(page).first().boundingBox())!;
    return b.width / b.height;
  };
  const startRatio = await ratio();
  const handle = (await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox())!;
  await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 100, 20);
  const grown = (await strokes(page).first().boundingBox())!;
  expect(grown.width).toBeGreaterThan(250);
  expect(Math.abs((await ratio()) / startRatio - 1)).toBeLessThan(0.01);
  await expect(strokes(page).first()).toHaveAttribute('data-thickness', 'thick');
  await expect.poll(async () => Number(await strokes(sam.page).first().getAttribute('data-width')), EVENTUALLY)
    .toBeGreaterThan(250);

  // Move by dragging the line itself (its middle).
  const mid = { x: grown.x + grown.width / 2, y: grown.y + grown.height / 2 };
  await drag(page, mid, 0, 150);
  const moved = (await strokes(page).first().boundingBox())!;
  expect(Math.abs(moved.y - grown.y - 150)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Delete');
  await expect(strokes(page)).toHaveCount(0);
  await expect(strokes(sam.page)).toHaveCount(0, EVENTUALLY);
});
