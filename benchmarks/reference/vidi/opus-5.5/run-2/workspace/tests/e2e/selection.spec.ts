/**
 * Story 7 e2e (TC-32 to TC-36): box-select, group move, resize, nudge and delete in a real
 * browser against `wrangler dev`, plus remote pruning and full-capacity convergence.
 * Boards are seeded with the 20-note two-cluster fixture; the camera is set so world
 * positions map to known screen pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { buildSelectionBoard, SELECTION_BOARD } from '../fixtures/boards';
import { getCamera, setCamera } from './helpers/board';
import { createBoard, seedBoard } from './helpers/seed';
import { E2E_BASE_URL } from './helpers/server';
import { closeAll, expectWithin, openParticipants, waitConnected, type Participant } from './helpers/participants';

const CAM: Camera = { x: -200, y: -200, zoom: 0.5 };
const NOTE_COUNT = 20;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
const WORLD_TOLERANCE = 1e-6;

interface RenderedRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

function toScreen(p: Point): Point {
  return { x: (p.x - CAM.x) * CAM.zoom, y: (p.y - CAM.y) * CAM.zoom };
}

function centreOfNote(topLeft: Point): Point {
  return toScreen({ x: topLeft.x + STICKY_SIZE_WORLD / 2, y: topLeft.y + STICKY_SIZE_WORLD / 2 });
}

async function seededBoard(): Promise<{ boardId: string; ids: ReturnType<typeof buildSelectionBoard> }> {
  const doc = new Y.Doc();
  const ids = buildSelectionBoard(doc);
  const boardId = await createBoard(E2E_BASE_URL);
  await seedBoard(E2E_BASE_URL, boardId, doc);
  return { boardId, ids };
}

async function openSeeded(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await waitConnected(page);
  await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT);
  await setCamera(page, CAM);
}

/** Every rendered note's world rect and z, by id. */
async function rects(page: Page): Promise<Map<string, RenderedRect>> {
  const list = await page.getByRole('group', { name: 'Sticky note' }).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
        z: Number(h.style.zIndex),
      };
    }),
  );
  return new Map(list.map((r) => [r.id, r]));
}

async function selectedIds(page: Page): Promise<string[]> {
  return (await page.getByTestId('selection-outline').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.objectId ?? ''))).sort();
}

/** Shift + drag on empty board space between two world points. */
async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  const a = toScreen(from);
  const b = toScreen(to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function dragScreen(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

async function handleCentre(page: Page, name: string): Promise<Point> {
  const box = await page.getByRole('button', { name }).boundingBox();
  if (box === null) throw new Error(`${name} not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function expectClose(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(WORLD_TOLERANCE);
}

let people: Participant[] = [];
test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test.describe('Reorganise a cluster', () => {
  test('TC-32 Shift+drag selects only the note fully inside the rectangle', async ({ page }) => {
    const { boardId, ids } = await seededBoard();
    await openSeeded(page, boardId);
    // A = grid[0] (0..200) fully inside, B = grid[1] (250..450) half inside, C = grid[2] outside.
    await marquee(page, { x: -50, y: -50 }, { x: 350, y: 220 });
    await expect.poll(() => selectedIds(page)).toEqual([ids.grid[0]]);
    await expect(page.locator(`[data-id="${ids.grid[0]}"]`)).toHaveAttribute('data-selected', 'true');
    await expect(page.locator(`[data-id="${ids.grid[1]}"]`)).toHaveAttribute('data-selected', 'false');
    await expect(page.locator(`[data-id="${ids.grid[2]}"]`)).toHaveAttribute('data-selected', 'false');
    // Exactly one sticky note selected: the note toolbar, not the bar.
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('TC-33 / TC-34 six notes move together above others, resize proportionally, nudge and delete', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'golden path runs in chromium');
    const { boardId, ids } = await seededBoard();
    await openSeeded(page, boardId);

    // Select the 3 × 2 grid.
    await marquee(page, { x: -50, y: -50 }, { x: 750, y: 470 });
    await expect(page.getByTestId('selection-bar')).toHaveText(/6 selected/);
    await expect.poll(() => selectedIds(page)).toEqual([...ids.grid].sort());
    await expect(page.locator('.selection-handle')).toHaveCount(8);

    // TC-33 move: drag one of them down by 300 world units (150 px at 50%) over the row notes.
    const before = await rects(page);
    await dragScreen(page, centreOfNote(SELECTION_BOARD.grid[4]!), 0, 300 * CAM.zoom);
    await expect.poll(async () => (await rects(page)).get(ids.grid[0]!)?.y).toBe(300);
    const moved = await rects(page);
    for (const id of ids.grid) {
      expectClose(moved.get(id)!.x, before.get(id)!.x, 'x kept');
      expectClose(moved.get(id)!.y, before.get(id)!.y + 300, 'y moved 300');
    }
    const minGridZ = Math.min(...ids.grid.map((id) => moved.get(id)!.z));
    const maxRowZ = Math.max(...ids.row.map((id) => moved.get(id)!.z));
    expect(minGridZ).toBeGreaterThan(maxRowZ);
    // Relative stacking among the moved notes is unchanged.
    const order = (m: Map<string, RenderedRect>) => [...ids.grid].sort((a, b) => m.get(a)!.z - m.get(b)!.z);
    expect(order(moved)).toEqual(order(before));
    // Where grid note 3 (now at y 550) overlaps row note 0 (y 600), the grid note is on top.
    const overlap = toScreen({ x: 100, y: 700 });
    const topId = await page.evaluate(
      (p) => (document.elementFromPoint(p.x, p.y)?.closest('[data-id]') as HTMLElement | null)?.dataset.id,
      overlap,
    );
    expect(topId).toBe(ids.grid[3]);

    // TC-33 resize: bounding box is (0,300)–(700,750); the se handle +350 world → ×1.5 from the top-left.
    const se = await handleCentre(page, 'Resize bottom-right');
    await dragScreen(page, se, 350 * CAM.zoom, 0);
    await expect.poll(async () => (await rects(page)).get(ids.grid[0]!)?.width).toBe(300);
    const scaled = await rects(page);
    const grid = ids.grid.map((id) => scaled.get(id)!);
    for (const r of grid) {
      expectClose(r.width, 300, 'width');
      expectClose(r.height, r.width, 'square');
    }
    expect(grid.map((r) => r.x)).toEqual([0, 375, 750, 0, 375, 750]);
    expect(grid.map((r) => r.y)).toEqual([300, 300, 300, 675, 675, 675]);
    expectClose(grid[1]!.x - (grid[0]!.x + grid[0]!.width), 75, 'gap scaled ×1.5');

    // Shrinking far past the minimum stops every note at STICKY_MIN_SIZE_WORLD.
    const se2 = await handleCentre(page, 'Resize bottom-right');
    await dragScreen(page, se2, -600, -600);
    await expect.poll(async () => (await rects(page)).get(ids.grid[0]!)?.width).toBe(STICKY_MIN_SIZE_WORLD);
    const tiny = await rects(page);
    for (const id of ids.grid) {
      expectClose(tiny.get(id)!.width, STICKY_MIN_SIZE_WORLD, 'min width');
      expectClose(tiny.get(id)!.height, STICKY_MIN_SIZE_WORLD, 'min height');
    }

    // TC-34 nudge: 3 × ArrowRight + Shift+ArrowRight, no page scroll, no board pan.
    const camera = await getCamera(page);
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const start = await rects(page);
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const step = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    await expect.poll(async () => (await rects(page)).get(ids.grid[0]!)!.x).toBe(start.get(ids.grid[0]!)!.x + step);
    const nudged = await rects(page);
    for (const id of ids.grid) {
      expectClose(nudged.get(id)!.x, start.get(id)!.x + step, 'nudged x');
      expectClose(nudged.get(id)!.y, start.get(id)!.y, 'nudged y');
    }
    for (const id of [...ids.row, ...ids.right]) expect(nudged.get(id)).toEqual(start.get(id));
    expect(await getCamera(page)).toEqual(camera);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(scroll);

    // TC-34 delete: all six go at once.
    await page.keyboard.press('Delete');
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT - ids.grid.length);
    for (const id of ids.grid) await expect(page.locator(`[data-id="${id}"]`)).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});

test.describe('Colleague deletes while I select', () => {
  test("TC-35 Sam deletes one of Lee's selected notes: Lee's selection drops by one", async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const { boardId, ids } = await seededBoard();
    people = await openParticipants(browser, ['Lee', 'Sam'], boardId);
    const [lee, sam] = people as [Participant, Participant];
    for (const p of people) {
      await expect(p.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT);
      await setCamera(p.page, CAM);
    }

    await marquee(lee.page, { x: -50, y: 560 }, { x: 700, y: 850 });
    await expect(lee.page.getByTestId('selection-bar')).toHaveText(/4 selected/);

    // Sam selects the top row note and deletes it.
    const last = ids.row[3]!;
    await sam.page.mouse.click(centreOfNote(SELECTION_BOARD.row[3]!).x, centreOfNote(SELECTION_BOARD.row[3]!).y);
    await expect(sam.page.locator(`[data-id="${last}"]`)).toHaveAttribute('data-selected', 'true');
    await sam.page.keyboard.press('Delete');

    await expectWithin(() => lee.page.locator(`[data-id="${last}"]`).count()).toBe(0);
    await expectWithin(async () => (await lee.page.getByTestId('selection-bar').textContent()) ?? '').toContain('3 selected');
    await expect.poll(() => selectedIds(lee.page)).toEqual(ids.row.slice(0, 3).sort());

    await lee.page.keyboard.press('Delete');
    await expect(lee.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT - 4);
    await expectWithin(() => sam.page.getByRole('group', { name: 'Sticky note' }).count()).toBe(NOTE_COUNT - 4);
    for (const id of ids.row) await expect(lee.page.locator(`[data-id="${id}"]`)).toHaveCount(0);
  });
});

test.describe('Full-capacity reorganisation', () => {
  test('TC-36 MAX_CONCURRENT_EDITORS people move different selections at once; every screen agrees', async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const { boardId, ids } = await seededBoard();
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
    people = await openParticipants(browser, names, boardId);
    for (const p of people) {
      await expect(p.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(NOTE_COUNT);
      await setCamera(p.page, CAM);
    }

    const plans = [
      { ids: ids.grid.slice(0, 3), from: { x: -50, y: -50 }, to: { x: 750, y: 220 }, grab: SELECTION_BOARD.grid[0]!, offset: { x: 100, y: -100 } },
      { ids: ids.grid.slice(3), from: { x: -50, y: 230 }, to: { x: 750, y: 470 }, grab: SELECTION_BOARD.grid[3]!, offset: { x: 200, y: 0 } },
      { ids: ids.row, from: { x: -50, y: 560 }, to: { x: 700, y: 850 }, grab: SELECTION_BOARD.row[3]!, offset: { x: 300, y: 100 } },
      { ids: ids.right.slice(0, 5), from: { x: 1350, y: -50 }, to: { x: 2340, y: 210 }, grab: SELECTION_BOARD.right[0]!, offset: { x: -100, y: 200 } },
      { ids: ids.right.slice(5), from: { x: 1350, y: 170 }, to: { x: 2340, y: 420 }, grab: SELECTION_BOARD.right[5]!, offset: { x: 100, y: 200 } },
    ].slice(0, MAX_CONCURRENT_EDITORS);

    // Everyone selects their own group first...
    await Promise.all(
      plans.map(async (plan, i) => {
        const page = people[i]!.page;
        await marquee(page, plan.from, plan.to);
        await expect.poll(() => selectedIds(page)).toEqual([...plan.ids].sort());
      }),
    );
    const start = await rects(people[0]!.page);
    // ...then all move at the same time.
    await Promise.all(
      plans.map((plan, i) =>
        dragScreen(people[i]!.page, centreOfNote(plan.grab), plan.offset.x * CAM.zoom, plan.offset.y * CAM.zoom),
      ),
    );

    const expected = new Map<string, Point>();
    for (const [id, r] of start) expected.set(id, { x: r.x, y: r.y });
    for (const plan of plans) {
      for (const id of plan.ids) {
        const s = start.get(id)!;
        expected.set(id, { x: s.x + plan.offset.x, y: s.y + plan.offset.y });
      }
    }
    const positions = async (page: Page) =>
      [...(await rects(page)).values()].map((r) => ({ id: r.id, x: r.x, y: r.y })).sort((a, b) => (a.id < b.id ? -1 : 1));
    const want = [...expected.entries()].map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const p of people) await expectWithin(() => positions(p.page), p.name).toEqual(want);
    const first = await positions(people[0]!.page);
    for (const p of people) expect(await positions(p.page)).toEqual(first);
    for (const p of people) expect(p.errors).toEqual([]);
  });
});
