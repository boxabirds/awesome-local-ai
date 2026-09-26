import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  createNoteAt,
  dragNoteBy,
  joinBoard,
  noteIds,
  notePositions,
  notesOnScreen,
  startBoard,
  waitForIdenticalBoards,
  type Box,
} from './helpers/live';

/**
 * Story 7 (select, move, resize and delete several objects at once), end to
 * end. The camera is pinned to {0, 0, 1} so a screen pixel equals a world unit
 * and a note is a 200×200 box centred on the point that was double-clicked.
 */

const cameraPin = { x: 0, y: 0, zoom: 1 };

async function pinCamera(page: Page): Promise<void> {
  await page.evaluate((camera) => {
    const hooks = (window as unknown as {
      __vidi6?: { setCamera(c: { x: number; y: number; zoom: number }): void };
    }).__vidi6;
    hooks?.setCamera(camera);
  }, cameraPin);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}

async function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const hooks = (window as unknown as {
      __vidi6?: { getCamera(): { x: number; y: number; zoom: number } };
    }).__vidi6;
    return hooks ? hooks.getCamera() : { x: 0, y: 0, zoom: 1 };
  });
}

const selected = (page: Page) => page.locator('[data-selected="true"]');

async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
}

/** Drag the screen-space handle identified by test id by `delta`. */
async function dragHandleBy(
  page: Page,
  handle: string,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
  if (!box) throw new Error(`handle ${handle} has no box`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

const widthOf = (box: Box): number => box.width;

test.describe('Multi-select E2E (single board)', () => {
  test('TC-32: a Shift+drag selects only fully-enclosed objects', async ({ page }) => {
    const boardId = await startBoard(page);
    await joinBoard(page, boardId);
    await pinCamera(page);

    // A (300,300) fully inside; B (550,300) half inside; C (1000,300) outside.
    const a = await createNoteAt(page, { x: 300, y: 300 });
    const b = await createNoteAt(page, { x: 550, y: 300 });
    const c = await createNoteAt(page, { x: 1000, y: 300 });
    await page.keyboard.press('Escape'); // start the marquee from nothing selected

    await page.mouse.move(150, 150);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(500, 420, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);

    await expect(selected(page)).toHaveCount(1);
    const boxes = await notesOnScreen(page);
    expect(boxes[a]).toBeDefined();
    // only A carries data-selected; B (half inside) and C (outside) do not
    await expect(page.locator(`[data-note-id="${a}"][data-selected="true"]`)).toHaveCount(1);
    await expect(page.locator(`[data-note-id="${b}"][data-selected="true"]`)).toHaveCount(0);
    await expect(page.locator(`[data-note-id="${c}"][data-selected="true"]`)).toHaveCount(0);
  });

  test('TC-33: dragging one of six selected notes moves all six by the same delta', async ({ page }) => {
    await startBoard(page);
    await pinCamera(page);
    const ids: string[] = [];
    for (const at of notePositions(6)) ids.push(await createNoteAt(page, at));

    await selectAll(page);
    await expect(selected(page)).toHaveCount(6);

    const before = await notesOnScreen(page);
    await dragNoteBy(page, ids[0]!, { x: 300, y: 0 });
    await page.waitForTimeout(200);

    const after = await notesOnScreen(page);
    for (const id of ids) {
      expect(after[id].x - before[id].x).toBeCloseTo(300, 0);
      expect(after[id].y).toBeCloseTo(before[id].y, 0);
    }
  });

  test('TC-33: a corner handle scales the group proportionally and stops at the minimum', async ({ page }) => {
    await startBoard(page);
    await pinCamera(page);
    const ids: string[] = [];
    for (const at of notePositions(6)) ids.push(await createNoteAt(page, at));

    await selectAll(page);
    const before = await notesOnScreen(page);
    const wBefore = widthOf(before[ids[0]!]!);

    // Grow with the bottom-right corner.
    await dragHandleBy(page, 'se', { x: 120, y: 120 });
    const grown = await notesOnScreen(page);
    const wGrown = widthOf(grown[ids[0]!]!);
    expect(wGrown).toBeGreaterThan(wBefore);
    // every note stays square and grew by the same factor
    for (const id of ids) {
      expect(widthOf(grown[id])).toBeGreaterThan(wBefore);
      expect(grown[id].width).toBeCloseTo(grown[id].height, 0);
    }
    // the gap between two neighbours scaled too
    const gapBefore = before[ids[1]!]!.x - (before[ids[0]!]!.x + before[ids[0]!]!.width);
    const gapAfter = grown[ids[1]!]!.x - (grown[ids[0]!]!.x + grown[ids[0]!]!.width);
    expect(gapAfter).toBeGreaterThan(gapBefore);

    // Shrink far past the limit: nothing goes below STICKY_MIN_SIZE_WORLD.
    await dragHandleBy(page, 'nw', { x: 5000, y: 5000 });
    const shrunk = await notesOnScreen(page);
    for (const id of ids) {
      expect(widthOf(shrunk[id])).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
    }
  });

  test('TC-34: arrow nudge and Shift nudge move the selection without scrolling or panning', async ({ page }) => {
    await startBoard(page);
    await pinCamera(page);
    const ids: string[] = [];
    for (const at of notePositions(6)) ids.push(await createNoteAt(page, at));

    await selectAll(page);
    const cameraBefore = await getCamera(page);
    const before = await notesOnScreen(page);

    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);

    const after = await notesOnScreen(page);
    const expected = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (const id of ids) {
      expect(after[id].x - before[id].x).toBeCloseTo(expected, 0);
    }
    // the window never scrolled and the camera never moved
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await getCamera(page)).toEqual(cameraBefore);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-note-id]')).toHaveCount(0);
  });
});

test.describe('Multi-select E2E (collaboration)', () => {
  test('TC-35: when a colleague deletes one selected note the selection drops it', async ({
    browser,
  }) => {
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    const boardId = await startBoard(ownerPage);

    const intruder = await browser.newContext();
    const intruderPage = await intruder.newPage();
    await joinBoard(intruderPage, boardId);

    // Owner creates two notes and selects both.
    const keep = await createNoteAt(ownerPage, { x: 400, y: 300 });
    const gone = await createNoteAt(ownerPage, { x: 700, y: 300 });
    await selectAll(ownerPage);
    await expect(selected(ownerPage)).toHaveCount(2);

    // The intruder deletes `gone`.
    await intruderPage.locator(`[data-note-id="${gone}"]`).click();
    await intruderPage.keyboard.press('Delete');

    // The owner's selection prunes to the surviving note.
    await expect(selected(ownerPage)).toHaveCount(1);
    await expect(ownerPage.locator(`[data-note-id="${gone}"]`)).toHaveCount(0);
    await expect(
      ownerPage.locator(`[data-note-id="${keep}"][data-selected="true"]`),
    ).toHaveCount(1);

    await owner.close();
    await intruder.close();
  });

  test('TC-36: every concurrent editor ends on identical positions (absolute writes converge)', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const seed = await browser.newContext();
    const seedPage = await seed.newPage();
    const boardId = await startBoard(seedPage);
    // Seed exactly MAX_CONCURRENT_EDITORS notes spread far apart.
    const ids: string[] = [];
    for (const at of notePositions(MAX_CONCURRENT_EDITORS)) {
      ids.push(await createNoteAt(seedPage, at));
    }

    // One editor per note, all on the same board.
    const editors = await Promise.all(
      ids.map(async () => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await joinBoard(page, boardId);
        return { ctx, page };
      }),
    );

    // Each editor selects its own note and drags it a distinct distance.
    await Promise.all(
      editors.map(async ({ page }, index) => {
        await page.locator(`[data-note-id="${ids[index]}"]`).click();
        await dragNoteBy(page, ids[index]!, { x: 40 + index * 10, y: 20 + index * 5 });
      }),
    );

    // Every board (including the seeder) converges to the same state.
    const allPages = [seedPage, ...editors.map((e) => e.page)];
    await waitForIdenticalBoards(allPages, 15_000);
    expect(await noteIds(allPages[0]!)).toHaveLength(MAX_CONCURRENT_EDITORS);

    for (const { ctx } of editors) await ctx.close();
    await seed.close();
  });
});
