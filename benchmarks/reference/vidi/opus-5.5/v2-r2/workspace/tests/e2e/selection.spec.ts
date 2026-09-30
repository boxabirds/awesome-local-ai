import { type Page, expect, test } from '@playwright/test';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { type SeedNote, retroBoard } from '../fixtures/selection-board';
import { getCamera, nextFrames, openBoard, setCamera } from './helpers/board';
import { closeParticipants, getNotes, openParticipants } from './helpers/participants';

const TOLERANCE = 0.01;
const Point = (x: number, y: number) => ({ x, y });
type Camera = { x: number; y: number; zoom: number };

const toScreen = (cam: Camera, w: { x: number; y: number }) => Point((w.x - cam.x) * cam.zoom, (w.y - cam.y) * cam.zoom);

async function seed(page: Page, notes: readonly SeedNote[]): Promise<string[]> {
  const ids = await page.evaluate((list) => window.__vidi6!.seedNotes!(list), notes);
  await expect.poll(async () => (await getNotes(page)).length).toBeGreaterThanOrEqual(notes.length);
  return ids;
}

async function notesById(page: Page): Promise<Map<string, StickySnapshot>> {
  return new Map((await getNotes(page)).map((n) => [n.id, n]));
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__vidi6?.getSelection?.() ?? [])].sort());
}

/** Shift+drag from one world point to another (selection rectangle). */
async function marquee(page: Page, cam: Camera, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = toScreen(cam, from);
  const b = toScreen(cam, to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await nextFrames(page);
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await nextFrames(page);
}

async function handleCentre(page: Page, name: string) {
  const box = await page.getByRole('button', { name: `Resize ${name}` }).boundingBox();
  if (!box) throw new Error(`no handle ${name}`);
  return Point(box.x + box.width / 2, box.y + box.height / 2);
}

function expectClose(actual: number, expected: number, label: string) {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(TOLERANCE);
}

const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

test.describe('story 7: select, move, resize and delete several objects', () => {
  test('TC-32 Shift+drag selects only the note entirely inside the rectangle', async ({ page }) => {
    await openBoard(page);
    const cam = { x: -100, y: -100, zoom: 1 };
    await setCamera(page, cam);
    const [a, b, c] = await seed(page, [
      { x: 0, y: 0, text: 'A inside', color: 'yellow' },
      { x: 300, y: 0, text: 'B half inside', color: 'blue' },
      { x: 800, y: 0, text: 'C outside', color: 'green' },
    ]);
    await marquee(page, cam, Point(-20, -20), Point(400, 220));
    expect(await selection(page)).toEqual([a]);
    for (const [id, selected] of [[a, 'true'], [b, 'false'], [c, 'false']] as const) {
      await expect(page.locator(`[data-id="${id}"]`)).toHaveAttribute('data-selected', selected);
    }
    // Board did not pan during the marquee.
    expect(await getCamera(page)).toEqual(cam);
  });

  test('workflow "reorganise a cluster": TC-33 move + resize, TC-34 nudge + delete', async ({ page }) => {
    await openBoard(page);
    const cam = { x: -100, y: -100, zoom: 0.5 };
    await setCamera(page, cam);
    const board = retroBoard();
    const ids = await seed(page, board.all);
    const clusterA = ids.slice(0, 6);
    const lone = ids[6]!;
    const start = await notesById(page);

    // Box-select cluster A (the lone note below it and cluster B stay out).
    await marquee(page, cam, Point(-30, -30), Point(680, 450));
    expect(await selection(page)).toEqual([...clusterA].sort());
    await expect(selectionBar(page)).toContainText('6 selected');
    await expect(page.locator('.selection-outline')).toHaveCount(6);
    await expect(page.getByRole('button', { name: /^Resize / })).toHaveCount(8);

    // TC-33 move: drag one note 300 world units down (150 px at 50%) over the lone note.
    const grab = toScreen(cam, Point(board.clusterA[4]!.x + 100, board.clusterA[4]!.y + 100));
    await drag(page, grab, 0, 150);
    let now = await notesById(page);
    for (const id of clusterA) {
      expect(now.get(id)).toMatchObject({ x: start.get(id)!.x, y: start.get(id)!.y + 300 });
    }
    const loneZ = now.get(lone)!.z;
    const aZ = clusterA.map((id) => now.get(id)!.z);
    expect(Math.min(...aZ)).toBeGreaterThan(loneZ);
    // Order among themselves is unchanged (they were created in order).
    expect([...aZ].sort((p, q) => p - q)).toEqual(aZ);
    const overlap = toScreen(cam, Point(board.lone.x + 100, board.lone.y + 20));
    const topId = await page.evaluate(
      ({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-id]') as HTMLElement | null)?.dataset.id,
      overlap,
    );
    expect(clusterA).toContain(topId);
    expect(await selection(page)).toEqual([...clusterA].sort());

    // TC-33 resize: bottom-right handle 160 px right (box 640 → 960 world wide, ×1.5).
    const before = now;
    const box = { x: 0, y: 300 };
    await drag(page, await handleCentre(page, 'bottom-right'), 160, 0);
    now = await notesById(page);
    for (const id of clusterA) {
      const n = now.get(id)!;
      const o = before.get(id)!;
      expectClose(n.width, STICKY_SIZE_WORLD * 1.5, 'width');
      expectClose(n.height, n.width, 'square');
      expectClose(n.x, box.x + (o.x - box.x) * 1.5, 'x');
      expectClose(n.y, box.y + (o.y - box.y) * 1.5, 'y');
    }
    // Gaps scale too (20 → 30).
    const row = clusterA.slice(0, 2).map((id) => now.get(id)!);
    expectClose(row[1]!.x - (row[0]!.x + row[0]!.width), 30, 'gap');
    await expect(page.locator(`[data-id="${clusterA[0]}"]`)).toHaveCSS('width', '300px');

    // Shrinking far past the minimum stops at STICKY_MIN_SIZE_WORLD for all six.
    await drag(page, await handleCentre(page, 'bottom-right'), -1000, -1000);
    now = await notesById(page);
    for (const id of clusterA) {
      expectClose(now.get(id)!.width, STICKY_MIN_SIZE_WORLD, 'min width');
      expectClose(now.get(id)!.height, STICKY_MIN_SIZE_WORLD, 'min height');
    }

    // TC-34 nudge: Right ×3 and Shift+Right; no page scroll, no board pan.
    const beforeNudge = await notesById(page);
    const camBefore = await getCamera(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    await nextFrames(page);
    now = await notesById(page);
    for (const id of clusterA) {
      expectClose(now.get(id)!.x, beforeNudge.get(id)!.x + 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 'nudged x');
      expectClose(now.get(id)!.y, beforeNudge.get(id)!.y + NUDGE_STEP_WORLD, 'nudged y');
    }
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await getCamera(page)).toEqual(camBefore);

    // TC-34 delete: all six go, the rest stay.
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await getNotes(page)).length).toBe(ids.length - 6);
    const left = await notesById(page);
    for (const id of clusterA) expect(left.has(id)).toBe(false);
    await expect(selectionBar(page)).toHaveCount(0);
    expect(await selection(page)).toEqual([]);
  });

  test('Ctrl/Cmd+A selects every note; Escape clears', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: -100, y: -100, zoom: 0.5 });
    const ids = await seed(page, retroBoard().all);
    await page.getByTestId('board-viewport').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(selectionBar(page)).toContainText(`${ids.length} selected`);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('Escape');
    await expect(selectionBar(page)).toHaveCount(0);
  });
});

test.describe('story 7: selection with other people', () => {
  test('TC-35 a colleague deletes one of my selected notes: it leaves my selection', async ({ browser }) => {
    const [lee, sam] = await openParticipants(browser, 2);
    try {
      const cam = { x: -100, y: -100, zoom: 0.5 };
      await setCamera(lee!.page, cam);
      await setCamera(sam!.page, cam);
      const ids = await seed(lee!.page, retroBoard().all);
      await expect.poll(async () => (await getNotes(sam!.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(ids.length);

      // Lee selects the top-left 2×2 of cluster A.
      await marquee(lee!.page, cam, Point(-20, -20), Point(450, 450));
      const leeSelected = await selection(lee!.page);
      expect(leeSelected).toHaveLength(4);
      await expect(selectionBar(lee!.page)).toContainText('4 selected');

      // Sam selects one of them and presses Delete.
      const victim = leeSelected[0]!;
      const n = (await notesById(sam!.page)).get(victim)!;
      await sam!.page.mouse.click(...(Object.values(toScreen(cam, Point(n.x + 100, n.y + 100))) as [number, number]));
      expect(await selection(sam!.page)).toEqual([victim]);
      const sentAt = Date.now();
      await sam!.page.keyboard.press('Delete');

      await expect(selectionBar(lee!.page)).toContainText('3 selected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      console.log(`[latency] TC-35 remote delete pruned in ${Date.now() - sentAt} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, not asserted)`);
      await expect(lee!.page.locator(`[data-id="${victim}"]`)).toHaveCount(0);
      await expect(lee!.page.locator('.selection-outline')).toHaveCount(3);
      expect(await selection(lee!.page)).toEqual(leeSelected.slice(1));

      await lee!.page.keyboard.press('Delete');
      await expect.poll(async () => (await getNotes(lee!.page)).length).toBe(ids.length - 4);
      const remaining = await notesById(lee!.page);
      for (const id of leeSelected) expect(remaining.has(id)).toBe(false);
      await expect.poll(async () => (await getNotes(sam!.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(ids.length - 4);
    } finally {
      await closeParticipants([lee!, sam!]);
    }
  });

  test('TC-36 MAX_CONCURRENT_EDITORS people move different selections at once: identical results', async ({ browser }) => {
    test.slow();
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      // Rectangles start right of the left toolbar (which also holds Undo/Redo since story 8).
      const cam = { x: -200, y: -100, zoom: 0.5 };
      await Promise.all(people.map((p) => setCamera(p.page, cam)));
      const rows = people.map((_, i) => [
        { x: 0, y: i * 300, text: `Row ${i + 1} left`, color: 'yellow' as const },
        { x: 220, y: i * 300, text: `Row ${i + 1} right`, color: 'blue' as const },
      ]);
      const ids = await seed(people[0]!.page, rows.flat());
      await Promise.all(
        people.map((p) =>
          expect.poll(async () => (await getNotes(p.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(ids.length),
        ),
      );
      // Each person box-selects their own row.
      for (const [i, p] of people.entries()) {
        await marquee(p.page, cam, Point(-20, i * 300 - 20), Point(440, i * 300 + 220));
        expect(await selection(p.page)).toEqual([ids[2 * i]!, ids[2 * i + 1]!].sort());
      }
      // Everyone drags at the same time: row i moves (100 × (i + 1), 0) world units.
      await Promise.all(
        people.map((p, i) => drag(p.page, toScreen(cam, Point(100, i * 300 + 100)), 50 * (i + 1), 0)),
      );
      const expected = ids
        .map((id, k) => ({ id, x: (k % 2) * 220 + 100 * (Math.floor(k / 2) + 1), y: Math.floor(k / 2) * 300 }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      await Promise.all(
        people.map((p) =>
          expect
            .poll(
              async () =>
                (await getNotes(p.page))
                  .map(({ id, x, y }) => ({ id, x, y }))
                  .sort((a, b) => (a.id < b.id ? -1 : 1)),
              { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `positions on ${p.name}` },
            )
            .toEqual(expected),
        ),
      );
      for (const p of people) expect(p.problems).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });
});
