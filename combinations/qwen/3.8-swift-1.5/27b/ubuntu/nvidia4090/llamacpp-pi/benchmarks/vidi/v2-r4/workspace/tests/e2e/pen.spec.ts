import { test, expect, type Page } from '@playwright/test';
import { setCamera, getOriginMarkerPosition } from './helpers/board';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

const BASE_URL = 'http://localhost:8787';

/** Creates a fresh board via the API and returns its id. */
async function createBoard(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`createBoard failed: ${res.status}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Opens a page on the given board with a known camera. */
async function openBoard(page: Page, boardId: string) {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
}

test.describe('Story 11: Sketch freehand with a pen E2E', () => {
  // TC-17: a real drag replaying the handwritten loop → the preview path is
  // present during the drag and its `d` changes across animation frames; the
  // stroke persists after release.
  test('TC-17: drawing shows a live preview and persists the stroke', async ({ page }) => {
    await openBoard(page, await createBoard());

    await page.click('button[aria-label="Pen (P)"]');
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();

    const path = handwrittenLoop();
    const ox = 400;
    const oy = 250;

    await page.mouse.move(ox + path[0].x, oy + path[0].y);
    await page.mouse.down();

    // Sample the preview `d` across animation frames while the drag continues
    const sampling = page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const samples: string[] = [];
          let frame = 0;
          const tick = () => {
            const el = document.querySelector('[data-testid="pen-preview-path"]');
            samples.push(el ? (el.getAttribute('d') ?? '') : '');
            if (++frame < 12) requestAnimationFrame(tick);
            else resolve(samples);
          };
          requestAnimationFrame(tick);
        }),
    );

    for (const p of path) {
      await page.mouse.move(ox + p.x, oy + p.y);
    }

    const samples = await sampling;
    const nonEmpty = samples.filter((s) => s.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    // The preview follows the pointer: `d` changes across frames
    expect(new Set(samples).size).toBeGreaterThan(1);

    await page.mouse.up();

    // The stroke persists and the preview is cleared
    await expect(page.getByTestId('stroke-object')).toHaveCount(1);
    await expect(page.getByTestId('pen-preview-path')).toHaveCount(0);
  });

  // TC-18: Priya draws while Sam watches → Sam sees nothing during the drag
  // and sees the finished stroke after release. The delivery time is logged
  // against LIVE_UPDATE_LATENCY_BUDGET_MS, not asserted.
  test('TC-18: the other participant sees the stroke only after release', async ({ browser }) => {
    const boardId = await createBoard();
    const context = await browser.newContext();
    const priya = await context.newPage();
    const sam = await context.newPage();
    await openBoard(priya, boardId);
    await openBoard(sam, boardId);

    await priya.click('button[aria-label="Pen (P)"]');

    const path = underline().map((p) => ({ x: 400 + p.x, y: 300 + p.y }));

    await priya.mouse.move(path[0].x, path[0].y);
    await priya.mouse.down();
    for (let i = 1; i < 40; i++) {
      await priya.mouse.move(path[i].x, path[i].y);
    }

    // In-progress: Sam must not see the stroke
    await expect(sam.getByTestId('stroke-object')).toHaveCount(0, { timeout: 1000 });

    const releaseAt = Date.now();
    for (let i = 40; i < path.length; i++) {
      await priya.mouse.move(path[i].x, path[i].y);
    }
    await priya.mouse.up();

    // Finished: Sam sees the stroke (functional wait; latency is logged)
    await expect(sam.getByTestId('stroke-object')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const deliveryMs = Date.now() - releaseAt;
    console.log(
      `TC-18: finished stroke delivered to the other participant in ${deliveryMs}ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms — logged, not asserted)`,
    );

    await context.close();
  });

  // TC-19: while the Pen is active, wheel pans the board; a drag starting on
  // a sticky creates a stroke and leaves the sticky in place (no pan/move).
  test('TC-19: wheel pans while Pen is active; drags over objects draw', async ({ page }) => {
    await openBoard(page, await createBoard());

    // Create a sticky note
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });
    const editor = page.locator('[data-testid="sticky-text-editor"]');
    await editor.waitFor();
    await editor.press('Escape');
    await expect(page.getByTestId('sticky-note')).toHaveCount(1);

    await page.click('button[aria-label="Pen (P)"]');
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();

    // Wheel pans the board while the Pen is active
    const markerBefore = await getOriginMarkerPosition(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(150);
    const markerAfter = await getOriginMarkerPosition(page);
    expect(
      Math.abs(markerAfter.x - markerBefore.x) + Math.abs(markerAfter.y - markerBefore.y),
    ).toBeGreaterThan(0);

    // A drag starting on the sticky draws a stroke; the sticky does not move
    const noteBefore = await page.getByTestId('sticky-note').boundingBox();
    expect(noteBefore).toBeTruthy();
    await page.mouse.move(noteBefore!.x + 50, noteBefore!.y + 50);
    await page.mouse.down();
    await page.mouse.move(noteBefore!.x + 150, noteBefore!.y + 130, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByTestId('stroke-object')).toHaveCount(1);
    const noteAfter = await page.getByTestId('sticky-note').boundingBox();
    expect(noteAfter!.x).toBeCloseTo(noteBefore!.x, 0);
    expect(noteAfter!.y).toBeCloseTo(noteBefore!.y, 0);
  });

  // TC-20: select by line, resize proportionally (aspect preserved), move,
  // delete — the delete is visible on both screens.
  test('TC-20: select by line, resize in proportion, move, delete', async ({ browser }) => {
    const boardId = await createBoard();
    const context = await browser.newContext();
    const priya = await context.newPage();
    const sam = await context.newPage();
    await openBoard(priya, boardId);
    await openBoard(sam, boardId);

    // Draw a diagonal stroke
    await priya.click('button[aria-label="Pen (P)"]');
    await priya.mouse.move(300, 250);
    await priya.mouse.down();
    await priya.mouse.move(500, 450, { steps: 8 });
    await priya.mouse.up();
    await expect(priya.getByTestId('stroke-object')).toHaveCount(1);
    await expect(sam.getByTestId('stroke-object')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Switch to Select and click the line itself (its midpoint)
    await priya.keyboard.press('v');
    await priya.mouse.click(400, 350);
    await expect(priya.getByTestId('selection-bounding-box')).toBeVisible();

    const stroke = priya.getByTestId('stroke-object');
    const box1 = await stroke.boundingBox();
    expect(box1).toBeTruthy();
    const ratio1 = box1!.width / box1!.height;

    // Drag the SE corner handle: the aspect ratio is preserved (±1%)
    const handle = priya.getByTestId('handle-se');
    const hBox = await handle.boundingBox();
    expect(hBox).toBeTruthy();
    await priya.mouse.move(hBox!.x + hBox!.width / 2, hBox!.y + hBox!.height / 2);
    await priya.mouse.down();
    await priya.mouse.move(hBox!.x + 50, hBox!.y + 50, { steps: 5 });
    await priya.mouse.up();

    const box2 = await stroke.boundingBox();
    expect(box2).toBeTruthy();
    const ratio2 = box2!.width / box2!.height;
    expect(Math.abs(ratio2 - ratio1) / ratio1).toBeLessThan(0.01);
    expect(box2!.width).toBeGreaterThan(box1!.width);

    // Drag the body (the centre of the bbox lies on the diagonal line) to move it
    const midX = box2!.x + box2!.width / 2;
    const midY = box2!.y + box2!.height / 2;
    await priya.mouse.move(midX, midY);
    await priya.mouse.down();
    await priya.mouse.move(midX + 80, midY + 60, { steps: 5 });
    await priya.mouse.up();

    const box3 = await stroke.boundingBox();
    expect(box3).toBeTruthy();
    expect(box3!.x).toBeCloseTo(box2!.x + 80, 0);
    expect(box3!.y).toBeCloseTo(box2!.y + 60, 0);

    // Delete: removed on both screens
    await priya.keyboard.press('Delete');
    await expect(priya.getByTestId('stroke-object')).toHaveCount(0);
    await expect(sam.getByTestId('stroke-object')).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await context.close();
  });
});
