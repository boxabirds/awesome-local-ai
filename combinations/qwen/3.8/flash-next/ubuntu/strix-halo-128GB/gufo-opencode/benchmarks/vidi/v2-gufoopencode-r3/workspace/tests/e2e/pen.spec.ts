import { expect, test } from '@playwright/test';
import {
  dragBy,
  getNotes,
  getStrokes,
  markerCenter,
  openBoard,
  setCamera,
  worldToViewport
} from './helpers/board';
import { openParticipants, LatencyRecorder } from './helpers/participants';

const CAM = { x: -640, y: -400, zoom: 1 };

function toWorld(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x / CAM.zoom + CAM.x, y: p.y / CAM.zoom + CAM.y };
}

function circle(cx: number, cy: number, r: number, n: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) });
  }
  return pts;
}

async function clickPenTool(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
}

test.describe('pen (story 11)', () => {
  test('TC-17 dragging a loop shows a live preview and the stroke persists after release', async ({
    page
  }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await clickPenTool(page);

    const pts = circle(300, 300, 90, 12);
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const p of pts.slice(1, 8)) await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId('pen-preview')).toHaveCount(1);
    for (const p of pts.slice(8)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();

    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const s = strokes[0];
    expect(s.pointCount).toBeGreaterThanOrEqual(2);
    const drawn = pts.map(toWorld);
    const minX = Math.min(...drawn.map((p) => p.x));
    const maxX = Math.max(...drawn.map((p) => p.x));
    const minY = Math.min(...drawn.map((p) => p.y));
    const maxY = Math.max(...drawn.map((p) => p.y));
    expect(Math.min(...s.worldPoints.map((p) => p.x))).toBeGreaterThanOrEqual(minX - 4);
    expect(Math.max(...s.worldPoints.map((p) => p.x))).toBeLessThanOrEqual(maxX + 4);
    expect(Math.min(...s.worldPoints.map((p) => p.y))).toBeGreaterThanOrEqual(minY - 4);
    expect(Math.max(...s.worldPoints.map((p) => p.y))).toBeLessThanOrEqual(maxY + 4);
  });

  test('TC-18 the watcher sees nothing mid-drag and the finished stroke right after release', async ({
    browser
  }) => {
    const [priya, sam] = await openParticipants(browser, ['Priya', 'Sam']);
    await setCamera(priya.page, CAM);
    await clickPenTool(priya.page);

    const pts = [
      { x: 150, y: 200 },
      { x: 250, y: 320 },
      { x: 350, y: 260 },
      { x: 450, y: 380 }
    ];
    await priya.page.mouse.move(pts[0].x, pts[0].y);
    await priya.page.mouse.down();
    for (const p of pts.slice(1)) await priya.page.mouse.move(p.x, p.y);
    expect(await getStrokes(sam.page)).toHaveLength(0);

    const recorder = new LatencyRecorder();
    const drawEnd = async (): Promise<void> => {
      await priya.page.mouse.up();
    };
    await recorder.measure(
      'Priya release -> Sam sees stroke',
      drawEnd,
      async () => (await getStrokes(sam.page)).length === 1
    );
    recorder.report('pen live update');

    const onPriya = await getStrokes(priya.page);
    const onSam = await getStrokes(sam.page);
    expect(onSam).toHaveLength(1);
    expect(onSam[0].id).toBe(onPriya[0].id);
    expect(onSam[0].worldPoints).toHaveLength(onPriya[0].worldPoints.length);
    await priya.context.close();
    await sam.context.close();
  });

  test('TC-19 wheel pans while Pen is active; a drag over a sticky draws without moving it', async ({
    page
  }) => {
    await openBoard(page);
    await setCamera(page, CAM);

    await page.getByRole('button', { name: 'Sticky note (N)' }).click();
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');
    // Deselect: the note toolbar would otherwise sit between the cursor and
    // the pen overlay.
    await page.keyboard.press('v');
    await page.mouse.click(1100, 700);
    const noteBefore = (await getNotes(page))[0];

    await clickPenTool(page);
    const markerBefore = await markerCenter(page);
    await page.mouse.move(640, 250);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(async () => {
        const m = await markerCenter(page);
        const dy = Math.abs(m.y - markerBefore.y);
        return dy >= 80 && dy <= 120 && Math.abs(m.x - markerBefore.x) <= 2;
      })
      .toBe(true);

    // The wheel pan moved the board up ~100 px, so the note's screen centre
    // is now ~ (640, 300). Drawing starts on the note: the overlay must draw
    // a stroke without moving the note.
    await dragBy(page, { x: 640, y: 300 }, 60, 40);

    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].pointCount).toBeGreaterThanOrEqual(2);
    const noteAfter = (await getNotes(page))[0];
    expect(Math.abs(noteAfter.x - noteBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(noteAfter.y - noteBefore.y)).toBeLessThanOrEqual(1);
  });

  test('TC-20 select by line, resize keeps aspect, body drag moves, Delete removes on both screens', async ({
    browser
  }) => {
    const [priya, sam] = await openParticipants(browser, ['Dana', 'Lee']);
    await setCamera(priya.page, CAM);
    await clickPenTool(priya.page);

    await priya.page.mouse.move(200, 200);
    await priya.page.mouse.down();
    for (const p of [
      { x: 280, y: 290 },
      { x: 360, y: 310 },
      { x: 440, y: 400 },
      { x: 500, y: 450 }
    ]) {
      await priya.page.mouse.move(p.x, p.y);
    }
    await priya.page.mouse.up();

    const before = (await getStrokes(priya.page))[0];
    expect(before).toBeDefined();

    // Select by clicking on the line: the smoothed path passes exactly
    // through the junction between consecutive stored points.
    const onLine = (wps: Array<{ x: number; y: number }>) => {
      const k = Math.max(1, Math.floor(wps.length / 2));
      const a = wps[k - 1];
      const b = wps[k];
      return worldToViewport(CAM, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    };
    const lineScreen = onLine(before.worldPoints);
    await priya.page.keyboard.press('v');
    await priya.page.mouse.click(lineScreen.x, lineScreen.y);
    await expect(priya.page.getByTestId('stroke-object')).toHaveAttribute(
      'data-selected',
      'true'
    );

    // Resize via the bottom-right handle: aspect ratio is preserved.
    const ratioBefore = before.width / before.height;
    const handle = priya.page.getByLabel('Resize bottom-right');
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error('resize handle has no box');
    await dragBy(priya.page, { x: handleBox.x + 4, y: handleBox.y + 4 }, 80, 60);
    const resized = (await getStrokes(priya.page))[0];
    expect(resized.width).toBeGreaterThan(before.width + 50);
    const ratioAfter = resized.width / resized.height;
    expect(Math.abs(ratioAfter / ratioBefore - 1)).toBeLessThanOrEqual(0.01);

    // Move: drag from a point on the line.
    const midScreen = onLine(resized.worldPoints);
    await dragBy(priya.page, midScreen, 80, 40);
    const moved = (await getStrokes(priya.page))[0];
    expect(Math.abs(moved.x - (resized.x + 80))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(moved.y - (resized.y + 40))).toBeLessThanOrEqual(1.5);

    // Delete removes it on both screens.
    await priya.page.keyboard.press('Delete');
    await expect.poll(async () => (await getStrokes(priya.page)).length).toBe(0);
    await expect.poll(async () => (await getStrokes(sam.page)).length).toBe(0);
    await priya.context.close();
    await sam.context.close();
  });
});
