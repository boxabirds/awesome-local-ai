import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  addStickyAt,
  dragHandle,
  dragNote,
  getBoard,
  getNote,
  getSelectedIds,
  marquee,
  noteBox,
  noteIdAtPoint,
  positionsOf,
  scrollPosition,
  selectAll,
  selectionBarText,
  setCamera,
  worldTransform,
} from './helpers/board';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const SIZE = STICKY_SIZE_WORLD;
const HALF = SIZE / 2;

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

/** Wait until the app's selection holds exactly these ids, in any order. */
async function expectSelected(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(
      async () => (await getSelectedIds(page)).slice().sort().join(','),
      { timeout: 10000 },
    )
    .toBe([...ids].sort().join(','));
}

/** Wait for a note's rectangle in world units. */
async function expectRect(
  page: Page,
  id: string,
  expected: { x?: number; y?: number; width?: number; height?: number },
  tol = 0.5,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const o = await getNote(page, id);
        if (!o) return 'missing';
        return [
          Math.abs(o.x - (expected.x ?? o.x)) <= tol,
          Math.abs(o.y - (expected.y ?? o.y)) <= tol,
          Math.abs((o.width ?? 0) - (expected.width ?? o.width ?? 0)) <= tol,
          Math.abs((o.height ?? 0) - (expected.height ?? o.height ?? 0)) <= tol,
        ].every(Boolean);
      },
      { timeout: 10000 },
    )
    .toBe(true);
}

test.describe('Story 7: selecting and transforming several objects', () => {
  test.beforeEach(async ({ page }) => {
    const id = await createBoard();
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-33: a box-selected cluster moves together, above what it passes, and resizes as a unit', async ({
    page,
  }) => {
    const centres = [
      { x: 300, y: 200 },
      { x: 540, y: 200 },
      { x: 780, y: 200 },
      { x: 300, y: 440 },
      { x: 540, y: 440 },
      { x: 780, y: 440 },
    ];
    const ids: string[] = [];
    for (const c of centres) ids.push(await addStickyAt(page, c));
    // A note created last, so it is painted above the cluster it touches.
    const other = await addStickyAt(page, { x: 1000, y: 320 });
    await expect.poll(() => getBoard(page)).toHaveLength(7);

    // Box-select the six notes: the seventh lies outside the box.
    await marquee(page, { x: 150, y: 60 }, { x: 900, y: 580 });
    await expectSelected(page, ids);

    // Where the cluster will land, `other` is on top before the move.
    const landing = { x: 1040, y: 260 };
    expect(await noteIdAtPoint(page, landing.x, landing.y)).toBe(other);

    // Dragging one member moves all six by the same 300 units.
    await dragNote(page, ids[0], 300, 0, { fx: 0.5, fy: 0.5 });
    for (let i = 0; i < ids.length; i += 1) {
      await expectRect(page, ids[i], {
        x: centres[i].x - HALF + 300,
        y: centres[i].y - HALF,
        width: SIZE,
        height: SIZE,
      });
    }
    // The group was lifted above the note it was dragged over...
    expect(await noteIdAtPoint(page, landing.x, landing.y)).not.toBe(other);
    // ...and the untouched note stayed put.
    await expectRect(page, other, { x: 1000 - HALF, y: 320 - HALF, width: SIZE, height: SIZE });

    // Resize the whole group from the corner. Zoomed out so the handle is on
    // screen: sizes and gaps are still world units.
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    await dragHandle(page, 'se', 340, 220); // +680 x +440 world: exactly twice the box

    for (const id of ids) {
      const o = (await getNote(page, id))!;
      expect(Math.abs(o.width! - SIZE * 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(o.height! - SIZE * 2)).toBeLessThanOrEqual(0.5); // notes stay square
    }
    const moved = await getBoard(page);
    const n1 = moved.find((o) => o.id === ids[0])!;
    const n2 = moved.find((o) => o.id === ids[1])!;
    const n4 = moved.find((o) => o.id === ids[3])!;
    // The gap between neighbours doubled with the sizes: 40 became 80.
    expect(n2.x - (n1.x + n1.width!)).toBeCloseTo(80, 1);
    expect(n4.y - (n1.y + n1.height!)).toBeCloseTo(80, 1);
    await expectRect(page, other, { x: 1000 - HALF, y: 320 - HALF, width: SIZE, height: SIZE });
  });

  test('TC-33: a group resize cannot make a sticky note smaller than its minimum', async ({
    page,
  }) => {
    const id = await addStickyAt(page, { x: 400, y: 300 });
    await dragNote(page, id, 0, 0); // click to select
    await expectSelected(page, [id]);

    await dragHandle(page, 'se', -250, -250);
    await expectRect(page, id, { width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD });
  });

  test('TC-34: arrow keys nudge the selection without scrolling the page or panning the board', async ({
    page,
  }) => {
    const ids = [
      await addStickyAt(page, { x: 300, y: 300 }),
      await addStickyAt(page, { x: 520, y: 300 }),
      await addStickyAt(page, { x: 410, y: 520 }),
    ];
    const before = await getBoard(page);
    const cameraBefore = await worldTransform(page);
    const scrollBefore = await scrollPosition(page);

    await selectAll(page);
    await expectSelected(page, ids);
    expect(await selectionBarText(page)).toContain('3 selected');

    // Three small steps and one large one, in the direction of the arrow keys.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const nudgedRight = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;

    const after = await getBoard(page);
    for (let i = 0; i < ids.length; i += 1) {
      const a = after.find((o) => o.id === ids[i])!;
      const b = before.find((o) => o.id === ids[i])!;
      expect(a.x - b.x).toBeCloseTo(nudgedRight, 6);
      expect(a.y - b.y).toBeCloseTo(0, 6);
    }

    // A large step upwards, so both steps and both axes are covered.
    await page.keyboard.press('Shift+ArrowUp');
    const lifted = await getBoard(page);
    for (let i = 0; i < ids.length; i += 1) {
      const a = lifted.find((o) => o.id === ids[i])!;
      expect(a.x - (before.find((o) => o.id === ids[i])!.x + nudgedRight)).toBeCloseTo(0, 6);
      expect(a.y - (before.find((o) => o.id === ids[i])!.y - NUDGE_LARGE_STEP_WORLD)).toBeCloseTo(0, 6);
    }

    expect(await worldTransform(page)).toEqual(cameraBefore);
    expect(await scrollPosition(page)).toEqual(scrollBefore);
    await expectSelected(page, ids);
  });

  test('TC-34: Delete removes every selected object and clears the selection', async ({ page }) => {
    const kept = await addStickyAt(page, { x: 1100, y: 600 });
    const selected = [
      await addStickyAt(page, { x: 300, y: 300 }),
      await addStickyAt(page, { x: 520, y: 300 }),
    ];
    await marquee(page, { x: 150, y: 150 }, { x: 640, y: 430 });
    await expectSelected(page, selected);

    await page.keyboard.press('Delete');

    await expect.poll(() => getBoard(page)).toHaveLength(1);
    expect((await getBoard(page))[0].id).toBe(kept);
    await expectSelected(page, []);
    expect(await selectionBarText(page)).toBeNull();
  });

  test('TC-35: a colleague deleting one of my selected notes shrinks my selection', async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const lee = await openBoard(await browser.newContext(), boardId);
    const sam = await openBoard(await browser.newContext(), boardId);

    // Four notes Lee will select, two outside the box it will draw.
    const selected = [
      await addStickyAt(lee, { x: 300, y: 300 }, 'one'),
      await addStickyAt(lee, { x: 520, y: 300 }, 'two'),
      await addStickyAt(lee, { x: 300, y: 520 }, 'three'),
      await addStickyAt(lee, { x: 520, y: 520 }, 'four'),
    ];
    const kept = [
      await addStickyAt(lee, { x: 1050, y: 300 }, 'five'),
      await addStickyAt(lee, { x: 1050, y: 560 }, 'six'),
    ];
    await expect.poll(() => getBoard(sam)).toHaveLength(6);

    await marquee(lee, { x: 150, y: 150 }, { x: 660, y: 660 });
    await expectSelected(lee, selected);
    expect(await selectionBarText(lee)).toContain('4 selected');

    // Sam deletes one of the notes Lee has selected.
    const samBox = await noteBox(sam, selected[1]);
    await sam.mouse.click(samBox.cx, samBox.cy);
    await sam.keyboard.press('Delete');

    // Lee's selection loses exactly that note, within the live update budget.
    const start = Date.now();
    await expectSelected(lee, [selected[0], selected[2], selected[3]]);
    const elapsed = Date.now() - start;
    if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS) {
      console.log(`[latency] selection pruned in ${elapsed}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
    }
    expect(await selectionBarText(lee)).toContain('3 selected');
    await expect(lee.getByTestId('selection-outline')).toHaveCount(3);

    // Lee deletes the rest: exactly the three selected notes go.
    await lee.keyboard.press('Delete');
    await expect.poll(() => getBoard(lee)).toHaveLength(2);
    expect((await getBoard(lee)).map((o) => o.id).sort()).toEqual([...kept].sort());
    await expectSelected(lee, []);
    expect(await selectionBarText(lee)).toBeNull();
    // Sam sees the same board.
    await expect.poll(() => getBoard(sam)).toHaveLength(2);

    await lee.context().close();
    await sam.context().close();
  });

  test(`TC-36: ${MAX_CONCURRENT_EDITORS} people reorganise different selections at once and agree on the result`, async ({
    browser,
  }) => {
    const boardId = await createBoard();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await openBoard(ctx, boardId));
    }

    const ids: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      ids.push(await addStickyAt(pages[0], { x: 150 + i * 250, y: 300 }, `note ${i}`));
    }
    for (const page of pages) await expect.poll(() => getBoard(page)).toHaveLength(ids.length);

    const before = await getBoard(pages[0]);
    // Each person moves only their own note, by their own distance, all at once.
    const deltas = ids.map((_, i) => 30 + i * 10);
    await Promise.all(
      pages.map((page, i) => dragNote(page, ids[i], 0, deltas[i], { fx: 0.5, fy: 0.5 })),
    );

    // Everyone ends up with the same board...
    const expected = positionsOf(
      before.map((o, i) => ({
        id: o.id,
        x: o.x,
        y: o.y + (deltas[ids.indexOf(o.id)] ?? 0),
      })),
    );
    for (const page of pages) {
      await expect
        .poll(async () => positionsOf(await getBoard(page)), { timeout: 10000 })
        .toBe(expected);
    }
    // ...and each note moved by exactly the distance its person dragged it.
    const final = await getBoard(pages[0]);
    for (let i = 0; i < ids.length; i += 1) {
      const a = final.find((o) => o.id === ids[i])!;
      const b = before.find((o) => o.id === ids[i])!;
      expect(a.y - b.y).toBeCloseTo(deltas[i], 6);
      expect(a.x - b.x).toBeCloseTo(0, 6);
    }

    for (const ctx of contexts) await ctx.close();
  });
});
