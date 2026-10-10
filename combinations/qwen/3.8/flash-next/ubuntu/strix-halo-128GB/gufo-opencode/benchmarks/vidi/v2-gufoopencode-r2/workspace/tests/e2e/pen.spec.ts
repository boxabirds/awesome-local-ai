// Story 11 e2e (TC-17 to TC-20): a pen sketch persists across a reload,
// reaches a second participant live, does not pan the viewport (while wheel
// still works), and one undo removes exactly one stroke.

import { test, expect, type Page } from '@playwright/test';
import { getCamera, getStrokes, gotoBoard, setCamera } from './helpers/board';
import {
  closeParticipants,
  openParticipants,
} from './helpers/participants';

async function drawWithPen(page: Page, pts: [number, number][]): Promise<void> {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(pts[i][0], pts[i][1], { steps: 3 });
  }
  await page.mouse.up();
}

const WAVE: [number, number][] = [
  [100, 120],
  [140, 80],
  [180, 120],
  [220, 160],
  [260, 120],
  [300, 80],
  [340, 120],
];

test('TC-17: a red thick stroke drawn with the pen is restored after a reload', async ({
  page,
}) => {
  const boardId = await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await page.keyboard.press('p');
  await expect(page.getByTestId('pen-tool-catcher')).toBeVisible();
  await page.getByRole('button', { name: 'Red pen' }).click();
  await page.getByRole('button', { name: 'Thick' }).click();
  await drawWithPen(page, WAVE);

  const before = await getStrokes(page);
  expect(before).toHaveLength(1);
  expect(before[0].color).toBe('red');
  expect(before[0].thickness).toBe('thick');

  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(async () => (await getStrokes(page)).length, { timeout: 15_000 })
    .toBe(1);
  const stroke = (await getStrokes(page))[0];
  expect(stroke.id).toBe(before[0].id);
  expect(stroke.color).toBe('red');
  expect(stroke.thickness).toBe('thick');
  // Endpoints of the drawn wave survive simplification within a pixel; the
  // bbox is padded outward by half the thick stroke width (4).
  expect(Math.abs(stroke.x - 96)).toBeLessThanOrEqual(2);
  expect(Math.abs(stroke.y - 76)).toBeLessThanOrEqual(2);
  expect(Math.abs(stroke.x + stroke.width - 344)).toBeLessThanOrEqual(2);
  expect(Math.abs(stroke.y + stroke.height - 164)).toBeLessThanOrEqual(2);
});

test('TC-18: a live stroke appears on the second participant within the budget', async ({
  browser,
}) => {
  const [ada, bram] = await openParticipants(browser, ['Ada', 'Bram']);
  try {
    await setCamera(ada.page, { x: 0, y: 0, zoom: 1 });
    await ada.page.keyboard.press('p');
    await expect(ada.page.getByTestId('pen-tool-catcher')).toBeVisible();
    await drawWithPen(ada.page, WAVE);

    await expect
      .poll(async () => (await getStrokes(bram.page)).length)
      .toBe(1);
    const stroke = (await getStrokes(bram.page))[0];
    const local = (await getStrokes(ada.page))[0];
    expect(stroke.id).toBe(local.id);
    expect(stroke.points.length).toBe(local.points.length);
    expect(stroke.color).toBe(local.color);

    // And a second stroke from Bram reaches Ada (bidirectional).
    await bram.page.keyboard.press('p');
    await drawWithPen(bram.page, [
      [400, 100],
      [420, 140],
      [440, 100],
      [460, 140],
    ]);
    await expect
      .poll(async () => (await getStrokes(ada.page)).length)
      .toBe(2);
  } finally {
    await closeParticipants([ada, bram]);
  }
});

test('TC-19: a pen drag never pans the viewport, and ctrl+wheel still zooms while the pen is active', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await page.keyboard.press('p');

  await drawWithPen(page, [
    [200, 200],
    [280, 260],
    [360, 340],
    [440, 420],
  ]);
  const cam = await getCamera(page);
  expect(cam).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(await getStrokes(page)).toHaveLength(1);

  await page.mouse.move(400, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  const zoomed = await getCamera(page);
  expect(zoomed.zoom).toBeGreaterThan(1);
});

test('TC-20: one undo removes exactly one whole stroke and the pen stays active', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await page.keyboard.press('p');

  await drawWithPen(page, WAVE);
  await drawWithPen(page, [
    [420, 100],
    [460, 160],
    [500, 100],
  ]);
  expect(await getStrokes(page)).toHaveLength(2);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await getStrokes(page)).length)
    .toBe(1);
  let strokes = await getStrokes(page);
  // The surviving stroke is untouched (whole-stroke granularity).
  expect(strokes[0].points.length).toBeGreaterThan(2);
  const wave = strokes[0].x;
  expect(Math.abs(wave - 100)).toBeLessThanOrEqual(2);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await getStrokes(page)).length)
    .toBe(0);
  await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
});
