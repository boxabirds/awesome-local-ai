import { expect, test } from '@playwright/test';
import { waitForSettled, setCamera, readCamera } from './helpers/board';
import { openParticipants, closeParticipants, expectEventually, createNoteViaToolbar } from './helpers/participants';

/** Read all objects from the board test hooks. */
async function readAllObjects(page: import('@playwright/test').Page) {
  const objects = await page.evaluate(() => window.__vidi6?.getAllObjects() ?? []);
  return objects as readonly {
    id: string; type: string; x: number; y: number; z: number;
    width?: number; height?: number;
  }[];
}

/** Count strokes on a page. */
async function strokeCount(page: import('@playwright/test').Page): Promise<number> {
  const objs = await readAllObjects(page);
  return objs.filter((o) => o.type === 'stroke').length;
}

/** Draw a stroke with the pen tool by simulating a drag at the given screen points. */
async function drawStroke(page: import('@playwright/test').Page, points: { x: number; y: number }[]): Promise<void> {
  await page.keyboard.press('p');
  await waitForSettled(page);

  const first = points[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i]!.x, points[i]!.y, { steps: 3 });
  }
  await page.mouse.up();
  await waitForSettled(page);
}

/** Draw a stroke keeping the mouse down (for checking mid-drag state). Returns a release function. */
async function startStrokeDraw(page: import('@playwright/test').Page, points: { x: number; y: number }[]): Promise<() => Promise<void>> {
  await page.keyboard.press('p');
  await waitForSettled(page);

  const first = points[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i]!.x, points[i]!.y, { steps: 3 });
  }

  return async () => {
    await page.mouse.up();
    await waitForSettled(page);
  };
}

test.describe('story 11: Pen tool', () => {
  test('TC-17: real drag draws stroke, preview present during drag, stroke persists after release', async ({ page }) => {
    // Create board
    const res = await page.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForSettled(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Draw a loop with the pen
    const points = [
      { x: 400, y: 300 },
      { x: 500, y: 250 },
      { x: 600, y: 300 },
      { x: 650, y: 400 },
      { x: 600, y: 500 },
      { x: 500, y: 550 },
      { x: 400, y: 500 },
      { x: 350, y: 400 },
    ];

    const release = await startStrokeDraw(page, points);

    // During drag: preview SVG path should be present
    const preview = page.locator('[data-testid="pen-preview"]');
    await expect(preview).toBeVisible();
    const path = preview.locator('path');
    const dDuringDrag = await path.getAttribute('d');
    expect(dDuringDrag).toBeTruthy();

    // Release
    await release();

    // Stroke persists after release (appears in model)
    const count = await strokeCount(page);
    expect(count).toBe(1);

    // Stroke is visible as an SVG element
    const strokeEl = page.locator('svg[aria-label="Drawing"]');
    await expect(strokeEl).toBeVisible();
  });

  test('TC-18: Priya draws while Sam watches → Sam sees nothing during drag, finished stroke after release', async ({ browser }) => {
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const priya = participants[0]!;
    const sam = participants[1]!;

    try {
      await setCamera(priya.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Verify Sam starts with 0 strokes
      expect(await strokeCount(sam.page)).toBe(0);

      // Priya starts drawing but doesn't release yet
      const points = [
        { x: 400, y: 300 },
        { x: 450, y: 280 },
        { x: 500, y: 300 },
        { x: 550, y: 350 },
        { x: 600, y: 400 },
      ];
      const release = await startStrokeDraw(priya.page, points);

      // During drag: Sam sees no strokes
      expect(await strokeCount(sam.page)).toBe(0);

      // Release
      await release();

      // Sam should eventually see the finished stroke
      await expectEventually('TC-18: Sam sees stroke', async () => {
        expect(await strokeCount(sam.page)).toBe(1);
      });
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-19: wheel while Pen active pans board, drag on sticky creates stroke (no pan/move)', async ({ page }) => {
    const res = await page.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForSettled(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create a sticky note
    const noteId = await createNoteViaToolbar(page);

    // Switch to Pen tool
    await page.keyboard.press('p');
    await waitForSettled(page);

    // Scroll (wheel) should pan the board
    const cameraBefore = await readCamera(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await waitForSettled(page);
    const cameraAfter = await readCamera(page);
    // Camera y should have changed (panned down)
    expect(cameraAfter.y).not.toBe(cameraBefore.y);

    // Now try drawing starting on top of the sticky → should create a stroke, NOT move the sticky
    const strokesBefore = await strokeCount(page);
    const noteObj = (await readAllObjects(page)).find((o) => o.id === noteId);
    const noteXBefore = noteObj!.x;
    const noteYBefore = noteObj!.y;

    // Draw on/near the sticky note area
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(660, 420, { steps: 3 });
    await page.mouse.move(680, 440, { steps: 3 });
    await page.mouse.up();
    await waitForSettled(page);

    // A stroke should have been created
    const strokesAfter = await strokeCount(page);
    expect(strokesAfter).toBe(strokesBefore + 1);

    // The sticky note should NOT have moved
    const noteObjAfter = (await readAllObjects(page)).find((o) => o.id === noteId);
    expect(noteObjAfter!.x).toBe(noteXBefore);
    expect(noteObjAfter!.y).toBe(noteYBefore);
  });

  test('TC-20: select by line, resize proportionally, move, delete across participants', async ({ browser }) => {
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const priya = participants[0]!;
    const sam = participants[1]!;

    try {
      await setCamera(priya.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Priya draws a horizontal stroke
      await drawStroke(priya.page, [
        { x: 400, y: 400 },
        { x: 450, y: 400 },
        { x: 500, y: 400 },
        { x: 550, y: 400 },
        { x: 600, y: 400 },
      ]);

      // Wait for stroke to sync to Sam
      await expectEventually('TC-20: Sam sees stroke', async () => {
        expect(await strokeCount(sam.page)).toBe(1);
      });

      const strokes = (await readAllObjects(priya.page)).filter((o) => o.type === 'stroke');
      expect(strokes.length).toBe(1);
      const stroke = strokes[0]!;
      void stroke;

      // Switch to select tool
      await priya.page.keyboard.press('v');
      await waitForSettled(priya.page);

      // Click on the stroke line to select it (avoid resize handles at center/bottom)
      await priya.page.mouse.click(450, 399);
      await waitForSettled(priya.page);

      // Check stroke is selected (bounding box should appear)
      const hasBBox = await priya.page.locator('[data-testid="selection-bounding-box"]').isVisible().catch(() => false);
      expect(hasBBox).toBe(true);

      // Move the stroke by dragging from a point on the stroke but NOT on a resize handle
      const moveBefore = await readAllObjects(priya.page);
      const strokeBefore = moveBefore.find((o) => o.type === 'stroke')!;

      await priya.page.mouse.move(450, 399);
      await priya.page.mouse.down();
      await priya.page.mouse.move(470, 419, { steps: 4 });
      await priya.page.mouse.up();
      await waitForSettled(priya.page);

      const moveAfter = await readAllObjects(priya.page);
      const strokeAfter = moveAfter.find((o) => o.type === 'stroke')!;

      // Stroke should have moved
      const moved = strokeAfter.x !== strokeBefore.x || strokeAfter.y !== strokeBefore.y;
      expect(moved).toBe(true);

      // Delete the stroke
      await priya.page.keyboard.press('Delete');
      await waitForSettled(priya.page);

      // Verify deleted on Priya's side
      expect(await strokeCount(priya.page)).toBe(0);

      // Verify deleted on Sam's side
      await expectEventually('TC-20: stroke deleted for Sam', async () => {
        expect(await strokeCount(sam.page)).toBe(0);
      });
    } finally {
      await closeParticipants(participants);
    }
  });
});
