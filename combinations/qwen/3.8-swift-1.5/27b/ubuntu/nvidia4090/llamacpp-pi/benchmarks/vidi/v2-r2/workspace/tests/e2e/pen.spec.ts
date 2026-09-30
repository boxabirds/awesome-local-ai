/**
 * E2E pen workflows (story 11): annotate a cluster, shared sketch, tidy up.
 * TC-17 to TC-20. Real browser against `wrangler dev`.
 *
 * Functional waits use E2E_EVENTUAL_TIMEOUT_MS (story 3); delivery times are
 * logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted.
 */
import { test, expect, type Page } from '@playwright/test';
import { apiCreateBoard, setCamera, waitForBoardReady } from './helpers/board';
import { expectEventually } from './helpers/participants';
import { handwrittenLoop } from '../fixtures/pen-paths';

interface StrokeSnap {
  id: string;
  type: 'stroke';
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
  z: number;
}

interface ObjectSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  [k: string]: unknown;
}

async function objectsOf(page: Page): Promise<readonly ObjectSnap[]> {
  return page.evaluate(() => (window as any).__vidi6?.objects?.() ?? []);
}

async function strokesOf(page: Page): Promise<readonly StrokeSnap[]> {
  return (await objectsOf(page)).filter((o) => o.type === 'stroke') as unknown as StrokeSnap[];
}

async function getCamera(page: Page) {
  return page.evaluate(() => (window as any).__vidi6?.getCamera?.());
}

/** Sample the pen preview path's `d` on two consecutive animation frames. */
async function samplePreviewD(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(document.querySelector('[data-testid="pen-preview"] path')?.getAttribute('d') ?? null)
          )
        );
      })
  );
}

/** World → screen for the standard test camera. */
function toScreen(cam: { x: number; y: number; zoom: number }, wx: number, wy: number) {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

test.describe('pen (e2e, story 11)', () => {
  test('TC-17: real drag of the handwritten loop → live preview whose d changes per frame; stroke persists after release', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const boardId = await apiCreateBoard();
    await page.goto(`/b/${boardId}`);
    await waitForBoardReady(page);
    await setCamera(page, -640, -400, 1);

    // Activate the Pen tool.
    await page.keyboard.press('p');
    await expect(page.getByTestId('pen-tool')).toBeVisible();

    // Replay the recorded handwritten loop (world → screen at this camera).
    const cam = { x: -640, y: -400, zoom: 1 };
    const pts = handwrittenLoop.map((p) => toScreen(cam, p.x, p.y));

    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();

    // Drag through the loop in 4 chunks; after each chunk sample the preview
    // `d` on consecutive animation frames — it must exist and change.
    const ds: string[] = [];
    const chunk = Math.floor(pts.length / 4);
    for (let i = 1; i <= 4; i++) {
      const target = pts[Math.min(i * chunk, pts.length - 1)];
      await page.mouse.move(target.x, target.y, { steps: 24 });
      const d = await samplePreviewD(page);
      expect(d, `preview path should exist during drag (chunk ${i})`).not.toBeNull();
      ds.push(d!);
    }
    expect(new Set(ds).size, 'preview d must change between animation frames').toBeGreaterThan(1);

    await page.mouse.up();

    // The finished stroke persists; the local preview is gone.
    await expect
      .poll(async () => (await strokesOf(page)).length, { timeout: 5000 })
      .toBe(1);
    await expect(page.locator('[data-testid="pen-preview"] path')).toHaveCount(0);

    const [stroke] = await strokesOf(page);
    expect(stroke.color).toBe('black'); // default
    expect(stroke.thickness).toBe('medium'); // default
    expect(stroke.points.length).toBeGreaterThan(2);

    await context.close();
  });

  test('TC-18: Priya draws while Sam watches → Sam sees nothing during the drag, the finished stroke after release', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const priya = await ctxA.newPage();
    const sam = await ctxB.newPage();
    await priya.goto(`/b/${boardId}`);
    await sam.goto(`/b/${boardId}`);
    await waitForBoardReady(priya);
    await waitForBoardReady(sam);
    await setCamera(priya, -640, -400, 1);
    await setCamera(sam, -640, -400, 1);

    await priya.keyboard.press('p');

    // Start the stroke and draw part of it.
    await priya.mouse.move(500, 400);
    await priya.mouse.down();
    await priya.mouse.move(700, 450, { steps: 20 });

    // Sam sees nothing while the stroke is in progress.
    expect(await strokesOf(sam)).toHaveLength(0);
    await priya.mouse.move(800, 500, { steps: 10 });
    expect(await strokesOf(sam)).toHaveLength(0);

    // Finish: Sam sees the stroke (delivery time logged, not asserted).
    await priya.mouse.up();
    await expectEventually(
      async () => (await strokesOf(sam)).length === 1,
      'finished stroke visible to Sam'
    );

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-19: wheel while Pen active pans the board; a drag starting on a sticky creates a stroke and leaves the sticky in place', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const boardId = await apiCreateBoard();
    await page.goto(`/b/${boardId}`);
    await waitForBoardReady(page);
    await setCamera(page, -640, -400, 1);

    // Create a sticky at screen (400,300) with the Select tool.
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    let objs = await objectsOf(page);
    const sticky = objs.find((o) => o.type === 'sticky');
    expect(sticky).toBeDefined();
    const stickyBefore = { x: sticky!.x, y: sticky!.y };

    // Activate the Pen, then pan with the wheel.
    await page.keyboard.press('p');
    const camBefore = (await getCamera(page)) as { x: number; y: number; zoom: number };
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 120);
    const camAfter = (await getCamera(page)) as { x: number; y: number; zoom: number };
    expect(camAfter.y).toBeCloseTo(camBefore.y + 120 / camBefore.zoom, 5);
    expect(camAfter.x).toBeCloseTo(camBefore.x, 5);

    // Drag starting on the sticky's new screen position: a stroke is created,
    // the sticky does not move, and the board does not pan.
    const stickyScreen = toScreen(camAfter, stickyBefore.x + 100, stickyBefore.y + 100); // centre
    await page.mouse.move(stickyScreen.x, stickyScreen.y);
    await page.mouse.down();
    await page.mouse.move(stickyScreen.x + 90, stickyScreen.y + 60, { steps: 12 });
    await page.mouse.up();

    objs = await objectsOf(page);
    const stickyAfter = objs.find((o) => o.type === 'sticky')!;
    expect(stickyAfter.x).toBe(stickyBefore.x);
    expect(stickyAfter.y).toBe(stickyBefore.y);
    expect((await strokesOf(page)).length).toBe(1);

    // The pan did not happen via the drag: camera unchanged by the drag.
    const camEnd = (await getCamera(page)) as { x: number; y: number; zoom: number };
    expect(camEnd.y).toBeCloseTo(camAfter.y, 5);

    await context.close();
  });

  test('TC-20: select by line, resize proportionally, move, delete → gone on both screens', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const page = await ctxA.newPage();
    const sam = await ctxB.newPage();
    await page.goto(`/b/${boardId}`);
    await sam.goto(`/b/${boardId}`);
    await waitForBoardReady(page);
    await waitForBoardReady(sam);
    await setCamera(page, -640, -400, 1);
    await setCamera(sam, -640, -400, 1);

    // Draw a closed rectangle-ish sketch (a line with a real bbox).
    await page.keyboard.press('p');
    const cam = { x: -640, y: -400, zoom: 1 };
    const corners = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 100 },
    ].map((p) => toScreen(cam, p.x, p.y));
    await page.mouse.move(corners[0].x, corners[0].y);
    await page.mouse.down();
    for (const c of corners.slice(1)) {
      await page.mouse.move(c.x, c.y, { steps: 8 });
    }
    await page.mouse.up();
    await expect
      .poll(async () => (await strokesOf(page)).length, { timeout: 5000 })
      .toBe(1);

    // Switch to Select and click the line itself (top edge at world (200,100)).
    await page.keyboard.press('v');
    const lineScreen = toScreen(cam, 200, 100);
    await page.mouse.click(lineScreen.x, lineScreen.y);
    const stroke = (await strokesOf(page))[0];
    await expect(page.locator(`[data-stroke-id="${stroke.id}"][data-selected]`)).toHaveCount(1);

    // Drag the SE corner handle: aspect ratio preserved within 1%.
    const ratioBefore = stroke.width / stroke.height;
    const handle = page.getByTestId('resize-handle-se');
    const hb = await handle.boundingBox();
    expect(hb).not.toBeNull();
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb!.x + hb!.width / 2 + 50, hb!.y + hb!.height / 2 + 50, { steps: 10 });
    await page.mouse.up();

    const resized = (await strokesOf(page))[0];
    expect(resized.width).not.toBeCloseTo(stroke.width, 1);
    const ratioAfter = resized.width / resized.height;
    expect(Math.abs(ratioAfter / ratioBefore - 1) * 100).toBeLessThan(1);
    // Thickness is unchanged by the resize.
    expect(resized.thickness).toBe('medium');

    // Move: click the (scaled) line again — on the top edge, away from the
    // selection handles (which sit on the bbox edges) — and drag the body.
    const ptOnLine = {
      x: resized.x + (52 * resized.width) / resized.baseWidth,
      y: resized.y + (2 * resized.height) / resized.baseHeight,
    };
    const clickPt = toScreen(cam, ptOnLine.x, ptOnLine.y);
    await page.mouse.move(clickPt.x, clickPt.y);
    await page.mouse.down();
    await page.mouse.move(clickPt.x + 40, clickPt.y + 25, { steps: 8 });
    await page.mouse.up();
    const moved = (await strokesOf(page))[0];
    expect(moved.x).toBeCloseTo(resized.x + 40, 0);
    expect(moved.y).toBeCloseTo(resized.y + 25, 0);

    // Delete: removed on both screens.
    await page.keyboard.press('Delete');
    await expect
      .poll(async () => (await strokesOf(page)).length, { timeout: 5000 })
      .toBe(0);
    await expectEventually(
      async () => (await strokesOf(sam)).length === 0,
      'deleted stroke gone for Sam'
    );

    await ctxA.close();
    await ctxB.close();
  });
});
