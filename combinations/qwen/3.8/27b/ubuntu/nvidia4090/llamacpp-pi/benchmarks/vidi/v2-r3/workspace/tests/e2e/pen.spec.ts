import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { apiCreateBoard, logLatency, openBoard, setCamera } from './helpers';

interface Participant {
  context: BrowserContext;
  page: Page;
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  // The tests work in world coordinates: screen = world at this camera.
  await setCamera(page, 0, 0, 1);
  return { context, page };
}

async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

const strokes = (page: Page) => page.locator('[data-stroke-id]');

test.describe('pen (real browsers + wrangler dev)', () => {
  test('TC-17: a real drag replaying the handwritten loop → the preview follows frame by frame, and the stroke persists after release', async ({ page, request }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board);
    await setCamera(page, 0, 0, 1);
    await page.keyboard.press('p');
    await expect(page.locator('[data-pen-tool-layer]')).toBeVisible();

    const pts = [...handwrittenLoop];
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    const [ , samples] = await Promise.all([
      (async () => {
        for (let i = 1; i < pts.length; i++) {
          await page.mouse.move(pts[i].x, pts[i].y);
          // Pacing: a real hand is slower than the protocol loop.
          if (i % 8 === 0) await new Promise((r) => setTimeout(r, 2));
        }
        await page.mouse.up();
      })(),
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const out: string[] = [];
            let i = 0;
            const tick = () => {
              const el = document.querySelector('[data-pen-preview]');
              out.push(el ? (el as SVGPathElement).getAttribute('d') ?? '' : '');
              if (++i >= 80) resolve(out);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      ),
    ]);

    // The preview is present during the drag and its d changes across frames.
    const nonEmpty = samples.filter((s) => s.length > 0);
    expect(nonEmpty.length).toBeGreaterThan(0);
    expect(new Set(nonEmpty).size).toBeGreaterThan(1);

    // The finished stroke persists after the pointer is released.
    await expect(strokes(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const d = await strokes(page).locator('path').first().getAttribute('d');
    expect(d ?? '').not.toBe('');
  });

  test('TC-18: Sam sees nothing during the drag and the finished stroke after release (the time is logged, not asserted)', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const priya = await join(browser, board);
    const sam = await join(browser, board);
    try {
      const pts = [...underline.slice(0, 40)];
      await priya.page.keyboard.press('p');
      await priya.page.mouse.move(pts[0].x, pts[0].y);
      await priya.page.mouse.down();
      for (let i = 1; i < pts.length; i++) {
        await priya.page.mouse.move(pts[i].x, pts[i].y);
      }
      // Mid-drag: the preview is local to Priya — Sam's board is still empty.
      await expect(strokes(sam.page)).toHaveCount(0);

      await priya.page.mouse.up();
      const t0 = Date.now();
      await logLatency('stroke release → visible', t0, async () => (await strokes(sam.page).count()) === 1);
      await expect(strokes(priya.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    } finally {
      await closeAll(priya, sam);
    }
  });

  test('TC-19: wheel pans with the pen active; a drag over a sticky creates a stroke and does not move the sticky', async ({ page, request }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board);
    await setCamera(page, 0, 0, 1);

    // A sticky centred at (500,400).
    await page.mouse.dblclick(500, 400);
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await page.keyboard.press('Escape'); // leave edit mode (note stays put)
    const before = (await note.boundingBox())!;

    await page.keyboard.press('p');
    await expect(page.locator('[data-pen-tool-layer]')).toBeVisible();

    // Wheel over the board pans (the pen layer lets wheel events through).
    // Map-style convention: wheel deltaY +100 scrolls the content up.
    await page.mouse.move(100, 700);
    await page.mouse.wheel(0, 100);
    const panned = (await note.boundingBox())!;
    expect(panned.y).toBeCloseTo(before.y - 100, 0);
    expect(panned.x).toBeCloseTo(before.x, 0);

    // A drag starting over the sticky creates a stroke — the sticky does not move.
    const mid = { x: panned.x + panned.width / 2, y: panned.y + panned.height / 2 };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y - 40, { steps: 6 });
    await page.mouse.up();
    const after = (await note.boundingBox())!;
    expect(Math.abs(after.x - panned.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - panned.y)).toBeLessThanOrEqual(1);
    await expect(strokes(page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-20: select by the line, resize proportionally (thickness unchanged), move, delete — both screens agree', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const priya = await join(browser, board);
    const sam = await join(browser, board);
    const P = priya.page;
    const S = sam.page;
    try {
      // Priya draws the diagonal (200,200) → (400,300).
      await P.keyboard.press('p');
      await P.mouse.move(200, 200);
      await P.mouse.down();
      await P.mouse.move(300, 250, { steps: 6 });
      await P.mouse.move(400, 300, { steps: 6 });
      await P.mouse.up();
      await expect(strokes(P)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(strokes(S)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Select by clicking the drawn line (its midpoint).
      await P.keyboard.press('v');
      await P.mouse.click(300, 250);
      const stroke = strokes(P);
      await expect(stroke).toHaveAttribute('data-selected', 'true', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

      const boxBefore = (await stroke.boundingBox())!;
      const ratioBefore = boxBefore.width / boxBefore.height;
      const swBefore = await stroke.locator('path').first().getAttribute('stroke-width');

      // Resize from the bottom-right corner: the ratio holds and the
      // thickness (stroke-width, world units) does not change.
      await P.mouse.move(boxBefore.x + boxBefore.width, boxBefore.y + boxBefore.height);
      await P.mouse.down();
      await P.mouse.move(boxBefore.x + boxBefore.width + 100, boxBefore.y + boxBefore.height + 50, { steps: 8 });
      await P.mouse.up();
      const boxAfter = (await stroke.boundingBox())!;
      const ratioAfter = boxAfter.width / boxAfter.height;
      expect(boxAfter.width).toBeGreaterThan(boxBefore.width);
      expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThanOrEqual(0.01);
      const swAfter = await stroke.locator('path').first().getAttribute('stroke-width');
      expect(swAfter).toBe(swBefore);

      // Move the body (a drag on the line): the bbox shifts by the drag.
      const center = { x: boxAfter.x + boxAfter.width / 2, y: boxAfter.y + boxAfter.height / 2 };
      await P.mouse.move(center.x, center.y);
      await P.mouse.down();
      await P.mouse.move(center.x + 60, center.y + 40, { steps: 6 });
      await P.mouse.up();
      const boxMoved = (await stroke.boundingBox())!;
      expect(boxMoved.x).toBeCloseTo(boxAfter.x + 60, 0);
      expect(boxMoved.y).toBeCloseTo(boxAfter.y + 40, 0);

      // Delete: it is gone on both screens.
      await P.keyboard.press('Delete');
      await expect(strokes(P)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect(strokes(S)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    } finally {
      await closeAll(priya, sam);
    }
  });
});
