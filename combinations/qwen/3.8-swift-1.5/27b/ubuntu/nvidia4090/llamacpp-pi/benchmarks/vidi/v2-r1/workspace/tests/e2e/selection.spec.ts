import { test, expect, Page, Browser } from '@playwright/test';

/**
 * Story 7 e2e: select, move, resize and delete several objects at once
 * (TC-32 marquee, TC-33 transform, TC-34 keyboard, TC-35 prune over sync,
 * TC-36 concurrent convergence).
 *
 * The camera is set to (0, 0, 1) in every test, so screen coordinates equal
 * world coordinates and bounding boxes read directly as world rects.
 */

const BASE = 'http://localhost:8787';

interface SeedNote { x: number; y: number; text?: string }

async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));
  return page;
}

async function seed(page: Page, notes: SeedNote[]): Promise<string[]> {
  return page.evaluate((ns) => (window as any).__vidi6.seedNotes(ns), notes);
}

/** Shift+drag a marquee from (x0,y0) to (x1,y1) (screen = world at cam 0,0,1). */
async function marquee(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function drag(page: Page, x0: number, y0: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 8 });
  await page.mouse.up();
}

/** World rects (top-left) of every note, keyed by note id. */
async function noteRects(page: Page): Promise<Record<string, { x: number; y: number; w: number; h: number }>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'))) {
      const r = el.getBoundingClientRect();
      out[el.getAttribute('data-note-id')!] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
}

async function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map((el) => el.getAttribute('data-note-id')!),
  );
}

async function closeContext(page: Page): Promise<void> {
  await page.context().close();
}

test.describe('TC-32: marquee selects fully-contained notes', () => {
  test('only the fully inside note is selected', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    // A: 100..300 (fully inside 50..350)  B: 325..525 (half inside)  C: 800..1000 (outside)
    const [a, b, c] = await seed(page, [
      { x: 200, y: 200 }, { x: 425, y: 200 }, { x: 900, y: 200 },
    ]);

    await marquee(page, 50, 50, 350, 350);

    // Exactly one sticky selected → story 2's NoteToolbar (not the
    // "N selected" bar, which appears for two or more).
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    const selA = await page.locator(`[data-note-id="${a}"]`).getAttribute('data-selected');
    const selB = await page.locator(`[data-note-id="${b}"]`).getAttribute('data-selected');
    const selC = await page.locator(`[data-note-id="${c}"]`).getAttribute('data-selected');
    expect(selA).not.toBeNull();
    expect(selB).toBeNull();
    expect(selC).toBeNull();
  });
});

test.describe('TC-33: group move and proportional resize', () => {
  test('six notes move together, land above the 4th, and scale as a unit', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    // 3x2 grid (union 50..750 x 50..450) plus a 7th note at (400,650).
    // Nothing touches the marquee edge (containment is strict).
    const ids = await seed(page, [
      { x: 150, y: 150 }, { x: 400, y: 150 }, { x: 650, y: 150 },
      { x: 150, y: 350 }, { x: 400, y: 350 }, { x: 650, y: 350 },
      { x: 400, y: 650 },
    ]);
    const fourth = ids[6];

    // Marquee the grid (not the 7th note: its y starts at 550 > 500).
    await marquee(page, 20, 20, 780, 500);
    await expect(page.getByTestId('selection-count')).toHaveText('6 selected');

    // Drag the first note (centre 150,150) down by 200 world units.
    // (Keeps the resized scene inside the 720px-tall test viewport.)
    const before = await noteRects(page);
    await drag(page, 150, 150, 0, 200);
    const after = await noteRects(page);
    for (let i = 0; i < 6; i++) {
      expect(after[ids[i]].y).toBeCloseTo(before[ids[i]].y + 200, 0);
      expect(after[ids[i]].x).toBeCloseTo(before[ids[i]].x, 0);
    }
    // The 7th note did not move.
    expect(after[fourth].y).toBeCloseTo(before[fourth].y, 0);

    // The moved notes now render above the 4th note (higher CSS z-index).
    const z = new Map(await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]')).map(
        (el) => [el.getAttribute('data-note-id')!, Number(getComputedStyle(el).zIndex)] as const,
      ),
    ));
    for (let i = 0; i < 6; i++) {
      expect(z.get(ids[i])!).toBeGreaterThan(z.get(fourth)!);
    }

    // Resize: union is now 50..750 x 250..650; drag the SE corner (750,650)
    // by (+70,+40) → aspect-locked uniform scale 1.1 → notes 220x220, gaps 55.
    await drag(page, 750, 650, 70, 40);
    const resized = await noteRects(page);
    for (let i = 0; i < 6; i++) {
      expect(resized[ids[i]].w).toBeCloseTo(220, 0);
      expect(resized[ids[i]].h).toBeCloseTo(220, 0);
    }
    const gap = resized[ids[1]].x - (resized[ids[0]].x + resized[ids[0]].w);
    expect(gap).toBeCloseTo(55, 0);

    // Shrink far below the min: every note stops at 50x50.
    // Union is now 50..820 x 250..690; drag the SE corner (820,690) far left.
    await drag(page, 820, 690, -780, 0);
    const shrunk = await noteRects(page);
    for (let i = 0; i < 6; i++) {
      expect(shrunk[ids[i]].w).toBeCloseTo(50, 0);
      expect(shrunk[ids[i]].h).toBeCloseTo(50, 0);
    }
  });
});

test.describe('TC-34: keyboard nudge and delete', () => {
  test('arrows nudge the selection; Delete removes all', async ({ page }) => {
    const boardId = await createBoard();
    await page.goto(`${BASE}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
    await page.evaluate(() => (window as any).__vidi6.setCamera(0, 0, 1));

    const ids = await seed(page, [
      { x: 150, y: 150 }, { x: 400, y: 150 }, { x: 650, y: 150 },
      { x: 150, y: 400 }, { x: 400, y: 400 }, { x: 650, y: 400 },
    ]);
    await marquee(page, 20, 20, 780, 520);
    await expect(page.getByTestId('selection-count')).toHaveText('6 selected');

    const before = await noteRects(page);
    const cameraBefore = await page.evaluate(() => (window as any).__vidi6.getCamera());

    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // +3
    await page.keyboard.press('Shift+ArrowRight'); // +10

    const after = await noteRects(page);
    for (const id of ids) {
      expect(after[id].x).toBeCloseTo(before[id].x + 13, 0);
      expect(after[id].y).toBeCloseTo(before[id].y, 0);
    }
    // Camera and page scroll are untouched by nudging.
    const cameraAfter = await page.evaluate(() => (window as any).__vidi6.getCamera());
    expect(cameraAfter).toEqual(cameraBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.keyboard.press('Delete');
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  });
});

test.describe('TC-35: a colleague deletes one of my selected notes', () => {
  test('the id is pruned live and Delete removes exactly the rest', async ({ browser }) => {
    const boardId = await createBoard();
    const lee = await openBoardContext(browser, boardId);
    const sam = await openBoardContext(browser, boardId);

    // 20-note fixture: 5x4 grid.
    const notes: SeedNote[] = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 5; i++) {
        notes.push({ x: 150 + i * 250, y: 150 + j * 250 });
      }
    }
    const ids = await seed(lee, notes);
    // Top-left 2x2 (row-major): ids 0,1,5,6.
    const victim = ids[1]; // centre (400,150)

    // Lee marquee-selects the top-left 2x2.
    await marquee(lee, 10, 10, 540, 540);
    await expect(lee.getByTestId('selection-count')).toHaveText('4 selected');

    // Sam selects the victim and deletes it.
    await sam.mouse.click(400, 150);
    await sam.keyboard.press('Delete');
    await expect(sam.getByTestId('sticky-note')).toHaveCount(19);

    // Lee sees the note disappear within the latency budget.
    await expect(lee.locator(`[data-note-id="${victim}"]`), 'victim disappears on Lee').toHaveCount(0, {
      timeout: 1000,
    });
    await expect(lee.getByTestId('selection-count')).toHaveText('3 selected');

    // Lee's Delete removes exactly the remaining 3.
    await lee.keyboard.press('Delete');
    await expect(lee.getByTestId('sticky-note')).toHaveCount(16);

    await closeContext(lee);
    await closeContext(sam);
  });
});

test.describe('TC-36: concurrent moves converge', () => {
  test('every context shows identical final positions', async ({ browser }) => {
    const boardId = await createBoard();
    const pages: Page[] = [];
    for (let i = 0; i < 5; i++) {
      pages.push(await openBoardContext(browser, boardId));
    }

    // Five notes in a row; context i moves note i by (30i+10, 20).
    const starts = [150, 350, 550, 750, 950];
    await seed(pages[0], starts.map((x) => ({ x, y: 100 })));
    // Let the other contexts receive the seed.
    await expect(pages[1].getByTestId('sticky-note')).toHaveCount(5, { timeout: 5000 });

    const ids = await noteIds(pages[0]);
    const expected = new Map<string, { x: number; y: number }>();
    starts.forEach((x, i) => {
      // Top-left is the centre minus 100; final = start + (30i+10, 20).
      expected.set(ids[i], { x: x - 100 + 30 * i + 10, y: 20 });
    });

    await Promise.all(pages.map(async (page, i) => {
      await drag(page, starts[i], 100, 30 * i + 10, 20);
    }));
    // Give the last sync round-trip a moment to settle on every context.
    await pages[0].waitForTimeout(300);

    for (const page of pages) {
      const rects = await noteRects(page);
      for (const [id, exp] of expected) {
        expect(rects[id].x, `x of ${id} on this context`).toBeCloseTo(exp.x, 0);
        expect(rects[id].y, `y of ${id} on this context`).toBeCloseTo(exp.y, 0);
      }
    }

    for (const page of pages) await closeContext(page);
  });
});
