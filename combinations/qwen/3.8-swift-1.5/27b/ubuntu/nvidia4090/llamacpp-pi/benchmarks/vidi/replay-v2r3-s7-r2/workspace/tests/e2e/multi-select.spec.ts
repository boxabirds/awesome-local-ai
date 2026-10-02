import { test, expect, type Page, type Locator, type BrowserContext, type Browser } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';

/**
 * Story 7 E2E: select, move, resize and delete several objects at once.
 *
 * TC-32 marquee, TC-33 group move + resize, TC-34 keyboard, TC-35 remote
 * delete pruning, TC-36 full-capacity concurrent reorganisation.
 *
 * Notes are located by world position (the DOM is ordered by id, not by
 * creation order).
 */

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
  // The hook applies the camera via requestAnimationFrame — wait two frames so
  // the React state (and every screenToWorld call) sees the new camera.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(50);
}

function notes(page: Page): Locator {
  return page.locator('[data-testid^="sticky-note-"]');
}

/** Locator of the note whose centre is closest to world (x, y) (camera at origin). */
async function noteAt(page: Page, x: number, y: number, zoom: number): Promise<Locator> {
  const locs = notes(page);
  const n = await locs.count();
  let best = { i: 0, d: Infinity };
  for (let i = 0; i < n; i++) {
    const b = (await locs.nth(i).boundingBox())!;
    const cx = (b.x + b.width / 2) / zoom;
    const cy = (b.y + b.height / 2) / zoom;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < best.d) best = { i, d };
  }
  return locs.nth(best.i);
}

async function noteCenter(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Double-click empty board space to create a note centred on screen (x, y) and end editing. */
async function createNoteAt(page: Page, x: number, y: number) {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('[data-testid^="sticky-note-"]', { timeout: 5000 });
  await page.keyboard.press('Escape');
}

/** Click empty board space to clear any existing selection. */
async function clickEmpty(page: Page) {
  // Away from the zoom controls (bottom-right) and the navigation hint (bottom-centre).
  await page.mouse.click(1100, 640);
}

/** Shift+drag a marquee from (x1,y1) to (x2,y2) starting on empty board space. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number) {
  // The marquee is additive — clear any pre-existing selection first.
  await clickEmpty(page);
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 3 });
  await page.mouse.move(x2, y2, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Drag a note (grabbed at its centre) by (dx, dy) screen pixels. */
async function dragNoteBy(page: Page, note: Locator, dx: number, dy: number) {
  const c = await noteCenter(note);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Wait for rAF-driven renders to settle after a mutation gesture. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(50);
}

async function worldBox(note: Locator) {
  const b = (await note.boundingBox())!;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** Create a fresh board and open it in a new context with the camera at origin. */
async function openFreshBoard(browser: Browser): Promise<{ boardId: string; page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.request.post('/api/boards');
  expect(res.status()).toBe(201);
  const boardId = ((await res.json()) as { id: string }).id;
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__vidi6);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  return { boardId, page, ctx };
}

/** Open an existing board in a new context with the camera at origin. */
async function openBoardContext(browser: Browser, boardId: string): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !!(window as any).__vidi6);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  return { page, ctx };
}

test.describe('Story 7: multi-select (E2E)', () => {
  // TC-32
  test('TC-32: marquee selects only fully-inside notes', async ({ browser }) => {
    const { page, ctx } = await openFreshBoard(browser);
    // A (100,100,200,200), B (250,100,200,200) half in, C (800,100,200,200) out.
    await createNoteAt(page, 200, 200);
    await createNoteAt(page, 350, 200);
    await createNoteAt(page, 900, 200);
    expect(await notes(page).count()).toBe(3);
    const a = await noteAt(page, 200, 200, 1);
    const b = await noteAt(page, 350, 200, 1);
    const c = await noteAt(page, 900, 200, 1);

    // Marquee rect (50,50) → (350,350): fully contains A, half of B, not C.
    await marquee(page, 50, 50, 350, 350);

    expect(await a.getAttribute('data-selected')).not.toBeNull();
    expect(await b.getAttribute('data-selected')).toBeNull();
    expect(await c.getAttribute('data-selected')).toBeNull();
    // Exactly one note selected → story 2's note toolbar, not the multi bar.
    expect(await page.getByTestId('selection-bar').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Green colour' }).count()).toBe(1);
    await ctx.close();
  });

  // TC-33
  test('TC-33: group move keeps layout above an unselected note; group resize scales proportionally', async ({ browser }) => {
    const { page, ctx } = await openFreshBoard(browser);
    // Work at zoom 0.4 so the whole 6-note grid and its 2× resize fit on screen.
    const ZOOM = 0.4;
    await setCamera(page, { x: 0, y: 0, zoom: ZOOM });
    // Six notes in a 2-col × 3-row grid (world centres); a 7th note to the right.
    const centers: Array<[number, number]> = [
      [150, 150],
      [450, 150],
      [150, 450],
      [450, 450],
      [150, 750],
      [450, 750],
    ];
    for (const [x, y] of centers) await createNoteAt(page, x * ZOOM, y * ZOOM);
    await createNoteAt(page, 850 * ZOOM, 150 * ZOOM); // the 7th (unselected) note
    expect(await notes(page).count()).toBe(7);

    // Marquee-select the 6 grid notes (screen rect (5,5)→(250,345) = world
    // (12.5,12.5)→(625,862.5); the 7th starts at world x=750, outside).
    await marquee(page, 5, 5, 250, 345);
    expect(await page.getByTestId('selection-count').textContent()).toBe('6 selected');

    // Drag one of the selected notes 300 world units right → all 6 move.
    const note0 = await noteAt(page, centers[0][0], centers[0][1], ZOOM);
    await dragNoteBy(page, note0, 300 * ZOOM, 0);
    await settle(page);
    for (let i = 0; i < 6; i++) {
      await expect
        .poll(async () => {
          const box = await worldBox(await noteAt(page, centers[i][0] + 300, centers[i][1], ZOOM));
          return [
            Math.round(box.x / ZOOM + box.width / ZOOM / 2),
            Math.round(box.y / ZOOM + box.height / ZOOM / 2),
          ];
        })
        .toEqual([centers[i][0] + 300, centers[i][1]]);
    }
    // The moved cluster rendered above the unselected 7th note.
    const dragged = await noteAt(page, centers[0][0] + 300, centers[0][1], ZOOM);
    const seventh = await noteAt(page, 850, 150, ZOOM);
    const zDragged = await dragged.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    const zSeventh = await seventh.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    expect(zDragged).toBeGreaterThan(zSeventh);

    // Group resize: the 6-note bbox is (50,50,500,800); after the +300 move its
    // SE corner is at world (850,850). Drag it to world (1350,1650) → 2× scale
    // about the NW anchor (350,50).
    const seHandle = page.getByRole('button', { name: 'Resize bottom-right' });
    await expect(seHandle).toBeVisible();
    const seBox = (await seHandle.boundingBox())!;
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(1350 * ZOOM, 1650 * ZOOM, { steps: 10 });
    await page.mouse.up();
    await settle(page);

    // Post-resize centres: anchor + 2 × (moved centre − anchor).
    const anchor: [number, number] = [350, 50];
    const afterResize: Array<[number, number]> = centers.map(([x, y]) => [
      anchor[0] + 2 * (x + 300 - anchor[0]),
      anchor[1] + 2 * (y - anchor[1]),
    ]);
    for (let i = 0; i < 6; i++) {
      await expect
        .poll(async () => {
          const box = await worldBox(await noteAt(page, afterResize[i][0], afterResize[i][1], ZOOM));
          return [Math.round(box.width / ZOOM), Math.round(box.height / ZOOM)];
        })
        .toEqual([400, 400]);
    }
    // Gap between the columns: original 100 world units, scaled 2× → 200.
    const col1 = await worldBox(await noteAt(page, afterResize[0][0], afterResize[0][1], ZOOM));
    const col2 = await worldBox(await noteAt(page, afterResize[1][0], afterResize[1][1], ZOOM));
    expect(Math.round((col2.x - (col1.x + col1.width)) / ZOOM)).toBe(200);

    // Shrink back down: dragging SE toward the NW anchor stops at the minimum
    // note size (STICKY_MIN_SIZE_WORLD) — notes stay square at 50×50.
    await settle(page);
    const se2 = page.getByRole('button', { name: 'Resize bottom-right' });
    const se2Box = (await se2.boundingBox())!;
    await page.mouse.move(se2Box.x + se2Box.width / 2, se2Box.y + se2Box.height / 2);
    await page.mouse.down();
    // Far past the minimum — the clamp must stop the shrink at 50×50 notes.
    await page.mouse.move(col1.x + 1, col1.y + 1, { steps: 10 });
    await page.mouse.up();
    await settle(page);
    // Final (shrunken) centres: anchor + (MIN/400) × (afterResize − anchor).
    const shrinkScale = STICKY_MIN_SIZE_WORLD / 400;
    const shrunken: Array<[number, number]> = afterResize.map(([x, y]) => [
      anchor[0] + shrinkScale * (x - anchor[0]),
      anchor[1] + shrinkScale * (y - anchor[1]),
    ]);
    for (let i = 0; i < 6; i++) {
      await expect
        .poll(async () => {
          const box = await worldBox(await noteAt(page, shrunken[i][0], shrunken[i][1], ZOOM));
          return [Math.round(box.width / ZOOM), Math.round(box.height / ZOOM)];
        })
        .toEqual([STICKY_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD]);
    }
    await ctx.close();
  });

  // TC-34
  test('TC-34: arrows nudge the selection (no scroll, no pan); Delete removes all', async ({ browser }) => {
    const { page, ctx } = await openFreshBoard(browser);
    const centers: Array<[number, number]> = [
      [200, 200],
      [500, 200],
      [800, 200],
      [200, 500],
      [500, 500],
      [800, 500],
    ];
    for (const [x, y] of centers) await createNoteAt(page, x, y);
    expect(await notes(page).count()).toBe(6);

    await page.keyboard.press('Control+a');
    expect(await page.getByTestId('selection-count').textContent()).toBe('6 selected');

    const note0 = await noteAt(page, centers[0][0], centers[0][1], 1);
    const before = await worldBox(note0);
    const camBefore = await page.evaluate(() => (window as any).__vidi6.getCamera());

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    const after = await worldBox(note0);
    // 3 × NUDGE_STEP_WORLD (1) + NUDGE_LARGE_STEP_WORLD (10) = 13.
    expect(after.x - before.x).toBeCloseTo(13, 0);
    expect(after.y - before.y).toBeCloseTo(0, 0);
    // No page scroll and no camera change.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const camAfter = await page.evaluate(() => (window as any).__vidi6.getCamera());
    expect(camAfter).toEqual(camBefore);

    await page.keyboard.press('Delete');
    expect(await notes(page).count()).toBe(0);
    await ctx.close();
  });

  // TC-35
  test('TC-35: colleague deletes one of my selected notes → selection prunes live', async ({ browser }) => {
    const { boardId, page: lee, ctx: leeCtx } = await openFreshBoard(browser);

    // Lee creates 4 notes.
    const centers: Array<[number, number]> = [
      [200, 200],
      [600, 200],
      [200, 600],
      [600, 600],
    ];
    for (const [x, y] of centers) await createNoteAt(lee, x, y);
    expect(await notes(lee).count()).toBe(4);

    // Sam: second context on the same board.
    const { page: sam, ctx: samCtx } = await openBoardContext(browser, boardId);
    await expect.poll(() => notes(sam).count(), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(4);

    // Lee shift-drags a marquee around all 4 → "4 selected".
    await marquee(lee, 50, 50, 810, 810);
    expect(await lee.getByTestId('selection-count').textContent()).toBe('4 selected');

    // Sam selects the top-right note and deletes it.
    const samTarget = await noteAt(sam, 600, 200, 1);
    const c = await noteCenter(samTarget);
    await sam.mouse.click(c.x, c.y);
    await sam.keyboard.press('Delete');
    expect(await notes(sam).count()).toBe(3);

    // Lee sees the deletion within the latency budget…
    await expect
      .poll(() => notes(lee).count(), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(3);
    // …the bar prunes to "3 selected"…
    expect(await lee.getByTestId('selection-count').textContent()).toBe('3 selected');
    // …and Delete removes exactly the remaining 3.
    await lee.keyboard.press('Delete');
    expect(await notes(lee).count()).toBe(0);
    await expect.poll(() => notes(sam).count(), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(0);

    await leeCtx.close();
    await samCtx.close();
  });

  // TC-36
  test('TC-36: full-capacity reorganisation converges across all contexts', async ({ browser }) => {
    const { boardId, page: first, ctx: firstCtx } = await openFreshBoard(browser);

    // MAX_CONCURRENT_EDITORS contexts on one board.
    const contexts: BrowserContext[] = [firstCtx];
    const pages: Page[] = [first];
    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      const { page, ctx } = await openBoardContext(browser, boardId);
      contexts.push(ctx);
      pages.push(page);
    }

    // Create 5 notes (one per future selection) in the first context.
    const centers: Array<[number, number]> = [
      [200, 200],
      [600, 200],
      [1000, 200],
      [200, 600],
      [600, 600],
    ];
    for (const [x, y] of centers) await createNoteAt(first, x, y);
    // Let every context see the 5 notes.
    for (const p of pages) {
      await expect.poll(() => notes(p).count(), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(5);
    }

    // Each context selects its own note and drags it +100 world units right,
    // all at the same time.
    await Promise.all(
      pages.map(async (p, i) => {
        const target = await noteAt(p, centers[i][0], centers[i][1], 1);
        const c = await noteCenter(target);
        await p.mouse.move(c.x, c.y);
        await p.mouse.down();
        await p.mouse.move(c.x + 100, c.y, { steps: 10 });
        await p.mouse.up();
      }),
    );

    // Every context shows identical final positions (absolute writes converge).
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const target = await noteAt(pages[i], centers[i][0] + 100, centers[i][1], 1);
      const box = (await target.boundingBox())!;
      expect(box.x + box.width / 2, `context ${i} note ${i}`).toBeCloseTo(centers[i][0] + 100, 0);
    }

    for (const ctx of contexts) await ctx.close();
  });
});
