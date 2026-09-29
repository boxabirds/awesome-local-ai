// Story 7 e2e: select, move, resize, nudge and delete several objects at once (TC-32 to TC-36),
// against the real service (wrangler dev).
import { type Page, expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { SELECTION_GRID, selectionBoard } from '../fixtures/boards';
import { boxOf, centreOf, getCamera, getNotes, noteIdAt, setCamera, waitForFrame } from './helpers/board';
import { LatencyLog, openParticipants, waitForConnected } from './helpers/participants';
import { createBoardViaApi, seedBoard } from './helpers/seed';

// Zoomed out so the whole 20-note board is visible: world x ∈ [-1280, 1280], y ∈ [-800, 800].
const CAMERA = { x: -1280, y: -800, zoom: 0.5 };
const TOTAL_NOTES = 20;

type World = { x: number; y: number };
const toPage = (p: World) => ({
  x: (p.x - CAMERA.x) * CAMERA.zoom,
  y: (p.y - CAMERA.y) * CAMERA.zoom,
});
/** Top-left of the grid note at row r, column c (fixture layout). */
const gridCorner = (r: number, c: number): World => ({
  x: SELECTION_GRID.left + c * SELECTION_GRID.pitch,
  y: SELECTION_GRID.top + r * SELECTION_GRID.pitch,
});
const noteCentre = (corner: World) => toPage({ x: corner.x + 100, y: corner.y + 100 });

const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });
const selectedNoteIds = (page: Page) =>
  page
    .locator('[data-sticky-id][data-selected="true"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.stickyId!).sort());

async function seededBoard(baseURL: string) {
  const fixture = selectionBoard();
  const id = await createBoardViaApi(baseURL);
  await seedBoard(baseURL, id, fixture.updates);
  return { id, ...fixture };
}

async function openSeeded(page: Page, boardId: string) {
  await page.goto(`/b/${boardId}`);
  await waitForConnected(page);
  await expect(page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES);
  await setCamera(page, CAMERA);
}

/** Shift+drag on empty board from one world point to another. */
async function marquee(page: Page, from: World, to: World) {
  const a = toPage(from);
  const b = toPage(to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await waitForFrame(page);
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await waitForFrame(page);
}

const byId = async (page: Page) => new Map((await getNotes(page)).map((n) => [n.id, n]));

test.describe('Workflow: Reorganise a cluster', () => {
  test('TC-32 Shift+drag selects only the note fully inside the rectangle', async ({ page }, testInfo) => {
    const board = await seededBoard(testInfo.project.use.baseURL!);
    await openSeeded(page, board.id);
    const cameraBefore = await getCamera(page);
    // A = grid[0][0] fully inside; grid[0][1] and grid[1][0] half inside; the rest outside.
    await marquee(page, { x: -1270, y: -770 }, { x: -940, y: -400 });
    await expect(page.getByTestId('marquee')).toHaveCount(0);
    expect(await selectedNoteIds(page)).toEqual([board.grid[0][0]]);
    // One sticky: the note toolbar, not the bar.
    await expect(page.getByRole('toolbar', { name: 'Note toolbar' })).toBeVisible();
    await expect(page.getByTestId('selection-status')).toHaveText('1 selected');
    expect(await getCamera(page)).toEqual(cameraBefore);
  });

  test('TC-33 / TC-34 move 6 notes together, resize them, nudge them and delete them', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    const board = await seededBoard(testInfo.project.use.baseURL!);
    await openSeeded(page, board.id);
    const six = [0, 1].flatMap((r) => [0, 1, 2].map((c) => board.grid[r][c]));
    const fourth = board.grid[0][3];

    // Select the 2 × 3 block with a box.
    await marquee(page, { x: -1260, y: -760 }, { x: -580, y: -310 });
    expect(await selectedNoteIds(page)).toEqual([...six].sort());
    await expect(selectionBar(page)).toContainText('6 selected');
    await expect(page.getByTestId('selection-status')).toHaveText('6 selected');

    // TC-33 move: drag grid[0][2] 300 world units right, over the 4th note.
    const start = await byId(page);
    await dragBy(page, noteCentre(gridCorner(0, 2)), 300 * CAMERA.zoom, 0);
    await expect
      .poll(async () => (await byId(page)).get(board.grid[0][2])!.x)
      .toBe(gridCorner(0, 2).x + 300);
    const moved = await byId(page);
    for (const id of six) {
      expect(moved.get(id)!.x).toBe(start.get(id)!.x + 300);
      expect(moved.get(id)!.y).toBe(start.get(id)!.y);
    }
    expect(moved.get(fourth)!.x).toBe(start.get(fourth)!.x);
    // Above the 4th note where they overlap; their own order is unchanged.
    // grid[0][2] now spans x −490…−290, overlapping the 4th note (−560…−360).
    const overlap = toPage({ x: gridCorner(0, 3).x + 160, y: gridCorner(0, 3).y + 100 });
    expect(await noteIdAt(page, overlap.x, overlap.y)).toBe(board.grid[0][2]);
    const order = (await getNotes(page)).map((n) => n.id).filter((id) => six.includes(id));
    expect(order).toEqual(six);
    expect(await selectedNoteIds(page)).toEqual([...six].sort());

    // TC-33 resize: bottom-right handle outward. The box (670 × 430) grows about 1.5×.
    const se = page.getByRole('button', { name: 'Resize bottom-right' });
    await dragBy(page, centreOf(await boxOf(se)), 335 * CAMERA.zoom, 0);
    const grown = await byId(page);
    const size = grown.get(six[0])!.width;
    const scale = size / STICKY_SIZE_WORLD;
    expect(scale).toBeGreaterThan(1.4);
    const topLeft = { x: moved.get(six[0])!.x, y: moved.get(six[0])!.y };
    for (const id of six) {
      const n = grown.get(id)!;
      expect(n.width).toBeCloseTo(size, 6);
      expect(n.height).toBeCloseTo(size, 6); // notes stay square
      // Positions (and so gaps) scale from the fixed top-left corner.
      expect(n.x).toBeCloseTo(topLeft.x + (moved.get(id)!.x - topLeft.x) * scale, 6);
      expect(n.y).toBeCloseTo(topLeft.y + (moved.get(id)!.y - topLeft.y) * scale, 6);
    }
    const gap = grown.get(six[1])!.x - (grown.get(six[0])!.x + size);
    expect(gap).toBeCloseTo((SELECTION_GRID.pitch - STICKY_SIZE_WORLD) * scale, 6);

    // Shrinking far past the minimum stops every note at STICKY_MIN_SIZE_WORLD.
    await dragBy(page, centreOf(await boxOf(se)), -1200 * CAMERA.zoom, -1200 * CAMERA.zoom);
    const shrunk = await byId(page);
    for (const id of six) {
      expect(shrunk.get(id)!.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
      expect(shrunk.get(id)!.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    }

    // TC-34 nudge: 3 × Right and 1 × Shift+Right, no page scroll, no board pan.
    const cameraBefore = await getCamera(page);
    const before = await byId(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    const dx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    await expect
      .poll(async () => (await byId(page)).get(six[0])!.x)
      .toBeCloseTo(before.get(six[0])!.x + dx, 6);
    const nudged = await byId(page);
    for (const id of six) {
      expect(nudged.get(id)!.x).toBeCloseTo(before.get(id)!.x + dx, 6);
      expect(nudged.get(id)!.y).toBeCloseTo(before.get(id)!.y + NUDGE_STEP_WORLD, 6);
    }
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await getCamera(page)).toEqual(cameraBefore);

    // TC-34 delete: Delete removes all six and nothing else.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 6);
    const left = await byId(page);
    for (const id of six) expect(left.has(id)).toBe(false);
    await expect(selectionBar(page)).toHaveCount(0);
    await expect(page.getByTestId('selection-box')).toHaveCount(0);
  });

  test('Ctrl/Cmd+A selects every note without selecting page text; Escape clears', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    const board = await seededBoard(testInfo.project.use.baseURL!);
    await openSeeded(page, board.id);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(selectionBar(page)).toContainText(`${TOTAL_NOTES} selected`);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
    expect(await selectedNoteIds(page)).toEqual([]);
  });
});

test.describe('Workflow: Colleague deletes while I select', () => {
  test('TC-35 Sam deletes one of Lee\'s 4 selected notes; Lee keeps the other 3', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    const board = await seededBoard(testInfo.project.use.baseURL!);
    const session = await openParticipants(browser, testInfo, ['Lee', 'Sam'], board.id);
    const [lee, sam] = session.participants;
    const log = new LatencyLog();
    try {
      for (const p of [lee, sam]) {
        await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES);
        await setCamera(p.page, CAMERA);
      }
      // Lee: the 2 × 2 block at the top-left of the grid.
      const four = [board.grid[0][0], board.grid[0][1], board.grid[1][0], board.grid[1][1]];
      await marquee(lee.page, { x: -1260, y: -760 }, { x: -810, y: -310 });
      await expect(selectionBar(lee.page)).toContainText('4 selected');
      expect(await selectedNoteIds(lee.page)).toEqual([...four].sort());

      // Sam selects grid[1][1] and presses Delete.
      const target = noteCentre(gridCorner(1, 1));
      await sam.page.mouse.click(target.x, target.y);
      await expect(sam.page.locator(`[data-sticky-id="${board.grid[1][1]}"]`)).toHaveAttribute(
        'data-selected',
        'true',
      );
      const since = Date.now();
      await sam.page.keyboard.press('Delete');
      await log.expectEventually(
        'remote delete prunes selection',
        async () => (await lee.page.locator(`[data-sticky-id="${board.grid[1][1]}"]`).count()) === 0,
        since,
      );
      await expect(selectionBar(lee.page)).toContainText('3 selected');
      await expect(lee.page.getByTestId('selection-status')).toHaveText('3 selected');
      expect(await selectedNoteIds(lee.page)).toEqual(four.slice(0, 3).sort());

      await lee.page.keyboard.press('Delete');
      await expect(lee.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 4);
      const remaining = await byId(lee.page);
      for (const id of four) expect(remaining.has(id)).toBe(false);
      await expect(sam.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 4, {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      for (const p of [lee, sam]) expect(p.problems, `${p.name} problems`).toEqual([]);
    } finally {
      log.report('TC-35 latency');
      await session.close();
    }
  });
});

test.describe('Workflow: Full-capacity reorganisation', () => {
  test('TC-36 MAX_CONCURRENT_EDITORS people move different selections at once; all screens agree', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    test.setTimeout(120_000);
    const board = await seededBoard(testInfo.project.use.baseURL!);
    const names = ['Lee', 'Sam', 'Alex', 'Kim', 'Noor'].slice(0, MAX_CONCURRENT_EDITORS);
    const session = await openParticipants(browser, testInfo, names, board.id);
    const people = session.participants;
    try {
      for (const p of people) {
        await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES);
        await setCamera(p.page, CAMERA);
      }
      // Person i owns two neighbouring notes; each pair moves by its own offset.
      const cells: [number, number][] = [];
      for (let r = 0; r < SELECTION_GRID.rows; r++)
        for (let c = 0; c < SELECTION_GRID.columns; c++) cells.push([r, c]);
      const pairs = people.map((_, i) => [cells[2 * i], cells[2 * i + 1]]);
      const offsets = people.map((_, i) => ({ x: 20 + 10 * i, y: 40 - 10 * i }));
      const start = await byId(people[0].page);

      await Promise.all(
        people.map(async (p, i) => {
          const [[r1, c1], [r2, c2]] = pairs[i];
          const a = noteCentre(gridCorner(r1, c1));
          const b = noteCentre(gridCorner(r2, c2));
          await p.page.mouse.click(a.x, a.y);
          await p.page.keyboard.down('Shift');
          await p.page.mouse.click(b.x, b.y);
          await p.page.keyboard.up('Shift');
          await expect(selectionBar(p.page)).toContainText('2 selected');
          await p.page.mouse.move(a.x, a.y);
          await p.page.mouse.down();
        }),
      );
      // Everyone drags at the same time.
      await Promise.all(
        people.map(async (p, i) => {
          const [[r1, c1]] = pairs[i];
          const a = noteCentre(gridCorner(r1, c1));
          const off = offsets[i];
          for (let s = 1; s <= 8; s++) {
            await p.page.mouse.move(
              a.x + (off.x * CAMERA.zoom * s) / 8,
              a.y + (off.y * CAMERA.zoom * s) / 8,
            );
          }
          await p.page.mouse.up();
        }),
      );

      // Every pair moved by its owner's offset, on every screen, and all screens agree.
      const expected = new Map<string, World>();
      pairs.forEach((pair, i) => {
        for (const [r, c] of pair) {
          const id = board.grid[r][c];
          expected.set(id, { x: start.get(id)!.x + offsets[i].x, y: start.get(id)!.y + offsets[i].y });
        }
      });
      const settled = async (page: Page) => {
        const notes = await byId(page);
        return [...expected].every(([id, p]) => notes.get(id)?.x === p.x && notes.get(id)?.y === p.y);
      };
      for (const p of people) {
        await expect.poll(() => settled(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
      }
      const reference = JSON.stringify(await getNotes(people[0].page));
      for (const p of people.slice(1)) {
        await expect
          .poll(async () => JSON.stringify(await getNotes(p.page)), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(reference);
      }
      for (const p of people) expect(p.problems, `${p.name} problems`).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
