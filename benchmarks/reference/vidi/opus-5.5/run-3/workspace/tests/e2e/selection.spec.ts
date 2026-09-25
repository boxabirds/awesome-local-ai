// Story 7 in real browsers against wrangler dev: marquee, group move and resize, nudge and delete, and
// selections that stay correct while other people change the board.
import { expect, test, type Page } from '@playwright/test';
import { createBoardAt } from './helpers/boards-api';
import { getCamera, setCamera, settle } from './helpers/board';
import { dragBy, noteAt, noteById, notes } from './helpers/notes';
import { closeAll, domSnapshot, expectWithin, openParticipants, type Participant } from './helpers/participants';
import { handleCentre, marquee, seedBoard, selectedIds, selectionBar, shiftClick, toScreen } from './helpers/selection';
import { CLUSTER_A, CLUSTER_B, clusterBoard } from '../fixtures/boards';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const CAM = { x: -100, y: -100, zoom: 0.5 };
const S = STICKY_SIZE_WORLD;

/** World top-left of cluster A's column c, row r. */
const a = (c: number, r: number) => ({ x: CLUSTER_A.x + c * CLUSTER_A.step, y: CLUSTER_A.y + r * CLUSTER_A.step });
const b = (c: number, r: number) => ({ x: CLUSTER_B.x + c * CLUSTER_B.step, y: CLUSTER_B.y + r * CLUSTER_B.step });
const centre = (p: { x: number; y: number }) => toScreen(CAM, { x: p.x + S / 2, y: p.y + S / 2 });

async function openSeeded(page: Page) {
  const board = clusterBoard();
  const boardId = await createBoardAt();
  await seedBoard(boardId, board.doc);
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.locator('[data-note-id]')).toHaveCount(20);
  await setCamera(page, CAM);
  await settle(page);
  return board.ids;
}

async function byId(page: Page) {
  return new Map((await notes(page)).map((n) => [n.id, n]));
}

test.describe('Workflow "Reorganise a cluster"', () => {
  test('TC-32 Shift+drag selects the note fully inside, not the half-inside or outside ones', async ({ page }) => {
    const ids = await openSeeded(page);
    // World (-20, -20) → (320, 210): A = (0,0) fully inside, B = (1,0) half inside, C = (3,0) outside.
    await marquee(page, toScreen(CAM, { x: -20, y: -20 }), toScreen(CAM, { x: 320, y: 210 }));
    expect(await selectedIds(page)).toEqual([ids[0]]);
    await expect(noteById(page, ids[0])).toHaveAttribute('data-selected', 'true');
    await expect(noteById(page, ids[1])).toHaveAttribute('data-selected', 'false');
    await expect(noteById(page, ids[3])).toHaveAttribute('data-selected', 'false');
    // One note selected: the note toolbar, not the selection bar.
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('TC-33 → TC-34 move 6 notes together, resize them, nudge them and delete them', async ({ page }) => {
    const ids = await openSeeded(page);
    const six = [0, 1, 2, 5, 6, 7].map((i) => ids[i]); // columns 0-2 of both rows of cluster A
    const fourth = ids[3];

    // Select the 6 with a box.
    await marquee(page, toScreen(CAM, { x: -10, y: -10 }), toScreen(CAM, { x: 650, y: 430 }));
    expect(await selectedIds(page)).toEqual([...six].sort());
    await expect(selectionBar(page)).toHaveText('6 selected');
    await expect(page.locator('[data-note-id][data-selected="true"]')).toHaveCount(6);
    await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(8);

    // TC-33 move: drag one of them 300 world units (150 px at 50%) to the right.
    const before = await byId(page);
    const orderBefore = (await notes(page)).map((n) => n.id).filter((id) => six.includes(id));
    await dragBy(page, centre(a(0, 0)), 300 * CAM.zoom, 0);
    await expect.poll(async () => (await byId(page)).get(six[0])!.x).toBe(before.get(six[0])!.x + 300);
    const moved = await byId(page);
    for (const id of six) {
      expect(moved.get(id)!.x - before.get(id)!.x).toBeCloseTo(300, 6);
      expect(moved.get(id)!.y).toBe(before.get(id)!.y);
    }
    expect(moved.get(fourth)!.x).toBe(before.get(fourth)!.x);
    // Their order among themselves is kept, and they are above the 4th note they were dragged over.
    expect((await notes(page)).map((n) => n.id).filter((id) => six.includes(id))).toEqual(orderBefore);
    const overlap = toScreen(CAM, { x: 800, y: 100 }); // moved column 2 (740..940) over column 3 (660..860)
    expect(await noteAt(page, overlap)).toBe(ids[2]);
    expect(await selectedIds(page)).toEqual([...six].sort());

    // Resize: drag the bottom-right handle out by (320, 100) world units. Notes stay square, so the box scales by
    // the larger factor, (640 + 320) / 640 = 1.5, from the top-left corner (300, 0).
    const se = await handleCentre(page, 'bottom-right');
    await dragBy(page, se, 320 * CAM.zoom, 100 * CAM.zoom);
    await expect.poll(async () => (await byId(page)).get(six[0])!.width).toBeCloseTo(300, 0);
    const resized = await byId(page);
    for (const [i, id] of six.entries()) {
      const c = i % 3;
      const r = Math.floor(i / 3);
      const n = resized.get(id)!;
      expect(n.width).toBeCloseTo(300, 0);
      expect(n.height).toBe(n.width); // square
      expect(n.x).toBeCloseTo(300 + c * 330, 0); // gaps scaled from 20 to 30
      expect(n.y).toBeCloseTo(r * 330, 0);
    }
    const box = await noteById(page, six[4]).boundingBox();
    expect(box!.width).toBeCloseTo(300 * CAM.zoom, 0);
    expect(box!.height).toBeCloseTo(300 * CAM.zoom, 0);

    // Shrinking far past the minimum stops every note at STICKY_MIN_SIZE_WORLD.
    const se2 = await handleCentre(page, 'bottom-right');
    await dragBy(page, se2, -600, -600);
    await expect.poll(async () => (await byId(page)).get(six[0])!.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    const small = await byId(page);
    for (const id of six) {
      expect(small.get(id)!.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
      expect(small.get(id)!.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 6);
    }

    // TC-34 nudge: Right ×3 and Shift+Right, without scrolling the page or panning the board.
    const cam = await getCamera(page);
    const beforeNudge = await byId(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const step = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
    await expect.poll(async () => (await byId(page)).get(six[0])!.x).toBeCloseTo(beforeNudge.get(six[0])!.x + step, 6);
    const nudged = await byId(page);
    for (const id of six) {
      expect(nudged.get(id)!.x - beforeNudge.get(id)!.x).toBeCloseTo(step, 6);
      expect(nudged.get(id)!.y).toBe(beforeNudge.get(id)!.y);
    }
    expect(await getCamera(page)).toEqual(cam);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    expect(await getCamera(page)).toEqual(cam);

    // Delete removes all 6.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-note-id]')).toHaveCount(14);
    for (const id of six) await expect(noteById(page, id)).toHaveCount(0);
    expect(await selectedIds(page)).toEqual([]);
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('Ctrl/Cmd+A selects every note and none of the page text; Escape clears', async ({ page }) => {
    await openSeeded(page);
    await page.mouse.click(1000, 700); // empty board space, focuses the board
    await page.keyboard.press('ControlOrMeta+a');
    await expect(selectionBar(page)).toHaveText('20 selected');
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
    expect(await selectedIds(page)).toEqual([]);
  });
});

test.describe('Workflow "Colleague deletes while I select"', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(people);
    people = [];
  });

  test('TC-35 Sam deletes one of Lee\'s 4 selected notes; Lee keeps the other 3 selected', async ({ browser }) => {
    const board = clusterBoard();
    const boardId = await createBoardAt();
    await seedBoard(boardId, board.doc);
    ({ people } = await openParticipants(browser, ['Lee', 'Sam'], boardId));
    const [lee, sam] = people.map((p) => p.page);
    for (const p of [lee, sam]) {
      await expect(p.locator('[data-note-id]')).toHaveCount(20);
      await setCamera(p, CAM);
      await settle(p);
    }
    const ids = board.ids;
    const four = [0, 1, 5, 6].map((i) => ids[i]);
    await marquee(lee, toScreen(CAM, { x: -10, y: -10 }), toScreen(CAM, { x: 430, y: 430 }));
    await expect(selectionBar(lee)).toHaveText('4 selected');

    // Sam selects one of those notes and deletes it.
    await sam.mouse.click(centre(a(1, 0)).x, centre(a(1, 0)).y);
    expect(await selectedIds(sam)).toEqual([ids[1]]);
    await sam.keyboard.press('Delete');

    await expectWithin(() => noteById(lee, ids[1]).count(), 'deleted note gone for Lee').toBe(0);
    await expectWithin(() => selectionBar(lee).textContent(), 'Lee bar count').toBe('3 selected');
    await expect(lee.locator('[data-note-id][data-selected="true"]')).toHaveCount(3);
    expect(await selectedIds(lee)).toEqual(four.filter((id) => id !== ids[1]).sort());

    // Lee's Delete removes exactly those 3.
    await lee.keyboard.press('Delete');
    await expect(lee.locator('[data-note-id]')).toHaveCount(16);
    await expectWithin(() => sam.locator('[data-note-id]').count(), 'Sam sees 16').toBe(16);
    for (const id of four) await expect(noteById(sam, id)).toHaveCount(0);
    for (const p of people) expect(p.errors).toEqual([]);
  });
});

test.describe('Workflow "Full-capacity reorganisation"', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeAll(people);
    people = [];
  });

  test('TC-36 MAX_CONCURRENT_EDITORS people move different selections at once; every screen agrees', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    expect(MAX_CONCURRENT_EDITORS).toBe(5);
    const board = clusterBoard();
    const boardId = await createBoardAt();
    await seedBoard(boardId, board.doc);
    const names = ['Lee', 'Sam', 'Ana', 'Kofi', 'Mei'].slice(0, MAX_CONCURRENT_EDITORS);
    ({ people } = await openParticipants(browser, names, boardId));
    for (const p of people) {
      await expect(p.page.locator('[data-note-id]')).toHaveCount(20);
      await setCamera(p.page, CAM);
      await settle(p.page);
    }
    const ids = board.ids;
    // Person i owns column i of both clusters: 4 notes. Each selects them with click + Shift-clicks.
    const owned = people.map((_, c) => [ids[c], ids[c + 5], ids[10 + c], ids[15 + c]]);
    const startPoints = people.map((_, c) => [centre(a(c, 0)), centre(a(c, 1)), centre(b(c, 0)), centre(b(c, 1))]);
    await Promise.all(
      people.map(async ({ page }, c) => {
        const [first, ...rest] = startPoints[c];
        await page.mouse.click(first.x, first.y);
        for (const p of rest) await shiftClick(page, p);
        expect(await selectedIds(page)).toEqual([...owned[c]].sort());
      }),
    );
    const before = await byId(people[0].page);

    // Everyone drags their selection down by 120 world units at the same time.
    const dy = 120;
    await Promise.all(people.map(({ page }, c) => dragBy(page, startPoints[c][0], 0, dy * CAM.zoom)));

    const expected = new Map(
      [...before].map(([id, n]) => [id, { x: n.x, y: n.y + (owned.flat().includes(id) ? dy : 0) }]),
    );
    for (const { page, name } of people) {
      await expectWithin(async () => {
        const now = await byId(page);
        return [...expected].every(([id, p]) => now.get(id)?.x === p.x && Math.abs(now.get(id)!.y - p.y) < 1e-6);
      }, `${name} sees every selection moved`).toBe(true);
    }
    // Identical on every screen, down to the stacking order.
    const reference = await domSnapshot(people[0].page);
    const order = (await notes(people[0].page)).map((n) => n.id);
    for (const { page } of people.slice(1)) {
      await expectWithin(() => domSnapshot(page)).toEqual(reference);
      expect((await notes(page)).map((n) => n.id)).toEqual(order);
    }
    for (const p of people) expect(p.errors).toEqual([]);
  });
});
