import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createBoard, readCamera, settle } from './helpers/board';
import { eventually, openParticipant, type Participant } from './helpers/participants';

// The seed grid places note tops at world (-460 + col·240, -200 + row·240) with
// STICKY_SIZE_WORLD = 200, so on screen neighbours sit exactly 240px apart in a
// 4-column grid. Absolute screen coordinates depend on page chrome, so tests
// measure the grid origin (the first note's top-left) at runtime.
async function gridOrigin(page: Page, firstId: string): Promise<{ x: number; y: number }> {
  return noteTopLeft(page, firstId);
}

function seedTopLeft(origin: { x: number; y: number }, index: number): { x: number; y: number } {
  return { x: origin.x + (index % 4) * 240, y: origin.y + Math.floor(index / 4) * 240 };
}

async function seedStickies(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(() => page.evaluate(() => typeof window.__vidi6?.seedStickies === 'function'), { timeout: 30_000 })
    .toBe(true);
  const ids = await page.evaluate((n) => window.__vidi6!.seedStickies!(n), count);
  await eventually(() => countNotes(page), 'seeded notes render').toBe(count);
  return ids;
}

function countNotes(page: Page): Promise<number> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter((id) => id.startsWith('sticky-') && !id.startsWith('sticky-text-') && !id.startsWith('sticky-fade-'))
      .length
  );
}

async function noteBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(`sticky-${id}`).boundingBox();
  if (box === null) throw new Error(`note ${id} not visible`);
  return box;
}

async function noteTopLeft(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await noteBox(page, id);
  return { x: box.x, y: box.y };
}

async function noteCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await noteBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function selectionText(page: Page): Promise<string | null> {
  return page.getByTestId('selection-count').textContent();
}

async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

async function dragElementCenter(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} not visible`);
  await dragFrom(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

test.describe('story 7 workflows', () => {
  test('TC-32: marquee selects only fully-enclosed notes', async ({ page, request }) => {
    const boardId = await createBoard(request);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const ids = await seedStickies(page, 3);
    const o = await gridOrigin(page, ids[0]);
    const topLeftOfN0 = { x: o.x - 30, y: o.y - 30 };
    const aboveGap = { x: o.x + 220, y: o.y - 25 };

    // This marquee fully covers n0 (a 30px margin) but cuts n1 in half after
    // the 40px gap: only n0 is selected.
    await marquee(page, topLeftOfN0, { x: o.x + 240 + 100, y: o.y + 230 });
    // A single selected note gets the note toolbar and a selection outline,
    // not the multi-selection bar.
    await expect(page.getByTestId('selection-overlay')).toBeVisible();
    await expect(page.getByTestId('selection-count')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Note tools' })).toHaveCount(1);

    // Clear, then cover n1 and n2 fully.
    await page.mouse.click(o.x - 40, o.y + 420);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);
    await marquee(page, aboveGap, { x: o.x + 480 + 230, y: o.y + 230 });
    expect(await selectionText(page)).toBe('2 selected');
  });

  test('TC-33: move a cluster together, then resize the selection from a corner', async ({ page, request }) => {
    const boardId = await createBoard(request);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const ids = await seedStickies(page, 8);
    const [n0, n1, n2, n3, n4, n5, n6, n7] = ids;
    const moved = [n0, n1, n2, n4, n5, n6];
    const origin = await gridOrigin(page, n0);
    const n3Before = await noteTopLeft(page, n3);
    const n7Before = await noteTopLeft(page, n7);

    // Select six notes: click, then shift+click.
    await page.getByTestId(`sticky-${n0}`).click();
    for (const id of [n1, n2, n4, n5, n6]) {
      await page.keyboard.down('Shift');
      await page.getByTestId(`sticky-${id}`).click();
      await page.keyboard.up('Shift');
    }
    expect(await selectionText(page)).toBe('6 selected');

    // Drag the cluster right by exactly 300 units: every selected note lands
    // 300px on, the unselected n3 and n7 stay put, and the cluster's n2 ends
    // up overlapping the fourth note n3.
    await dragFrom(page, await noteCenter(page, n0), 300, 0);
    for (const id of moved) {
      const after = await noteTopLeft(page, id);
      const before = seedTopLeft(origin, ids.indexOf(id));
      expect(Math.round(after.x)).toBe(Math.round(before.x + 300));
      expect(Math.round(after.y)).toBe(Math.round(before.y));
    }
    expect((await noteTopLeft(page, n3)).x).toBeCloseTo(n3Before.x, 0);
    expect((await noteTopLeft(page, n7)).x).toBeCloseTo(n7Before.x, 0);
    const n2box = await noteBox(page, n2);
    expect(n2box.x + n2box.width).toBeGreaterThan(n3Before.x);

    // Resize all eight through the bottom-right handle: notes scale together,
    // stay square, and the gaps between them scale with the notes.
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('selection-overlay')).toBeVisible();
    const before = new Map<string, { x: number; y: number; w: number }>();
    for (const id of ids) {
      const box = await noteBox(page, id);
      before.set(id, { x: box.x, y: box.y, w: box.width });
    }
    const anchorX = Math.min(...[...before.values()].map((b) => b.x));
    const anchorY = Math.min(...[...before.values()].map((b) => b.y));
    await dragElementCenter(page, 'resize-handle-se', -200, -200);

    const n4box = await noteBox(page, n4);
    const k = n4box.width / 200;
    expect(k).toBeLessThan(0.999);
    for (const id of ids) {
      const box = await noteBox(page, id);
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - 200 * k)).toBeLessThanOrEqual(1);
      const origin = before.get(id)!;
      expect(Math.abs(box.x - (anchorX + (origin.x - anchorX) * k))).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y - (anchorY + (origin.y - anchorY) * k))).toBeLessThanOrEqual(2);
    }
  });

  test('TC-34: arrows nudge without scrolling or panning; Delete removes all', async ({ page, request }) => {
    const boardId = await createBoard(request);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    const ids = await seedStickies(page, 3);
    const origin = await gridOrigin(page, ids[0]);
    const cameraBefore = await readCamera(page);

    await page.keyboard.press('Control+a');
    expect(await selectionText(page)).toBe('3 selected');

    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await settle(page);
    for (const id of ids) {
      const after = await noteTopLeft(page, id);
      const before = seedTopLeft(origin, ids.indexOf(id));
      expect(Math.round(after.x)).toBe(Math.round(before.x + 3));
      expect(Math.round(after.y)).toBe(Math.round(before.y - 10));
    }
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(scroll).toEqual({ x: 0, y: 0 });
    expect(await readCamera(page)).toEqual(cameraBefore);

    await page.keyboard.press('Delete');
    await settle(page);
    expect(await countNotes(page)).toBe(0);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);
  });

  test('TC-35: a colleague deleting a selected note shrinks my selection', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const lee = await openParticipant(browser, 'Lee', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const ids = await seedStickies(lee.page, 3);
    await eventually(() => countNotes(sam.page), 'Sam sees all three notes').toBe(3);

    await lee.page.keyboard.press('Control+a');
    expect(await selectionText(lee.page)).toBe('3 selected');

    const doomed = ids[1];
    await sam.page.getByTestId(`sticky-${doomed}`).click();
    await sam.page.getByRole('button', { name: 'Delete note' }).click();
    await settle(sam.page);

    await eventually(() => selectionText(lee.page), 'Lee keeps 2 of 3 selected').toBe('2 selected');
    await eventually(() => countNotes(lee.page), 'Lee sees 2 notes').toBe(2);

    expect(lee.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await lee.context.close();
    await sam.context.close();
  });

  test(`TC-36: ${MAX_CONCURRENT_EDITORS} participants reorganise different notes at once`, async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const people: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      people.push(await openParticipant(browser, `Editor ${String(i + 1)}`, boardId));
    }
    const ids = await seedStickies(people[0].page, MAX_CONCURRENT_EDITORS);
    for (const p of people) {
      await eventually(() => countNotes(p.page), `${p.name} sees every note`).toBe(MAX_CONCURRENT_EDITORS);
    }

    // Every participant drags their own note by a distinct offset, all at once.
    const origins: Array<{ x: number; y: number }> = [];
    for (const p of people) origins.push(await gridOrigin(p.page, ids[0]));
    await Promise.all(
      people.map(async (p, i) => {
        const from = await noteCenter(p.page, ids[i]);
        await dragFrom(p.page, from, 80 + i * 30, 60 + i * 20);
      })
    );
    await settle(people[0].page);

    for (const [pi, p] of people.entries()) {
      for (let i = 0; i < ids.length; i++) {
        const after = await noteTopLeft(p.page, ids[i]);
        const before = seedTopLeft(origins[pi], i);
        expect(after.x, `${p.name} sees note ${String(i)} moved`).toBeCloseTo(before.x + 80 + i * 30, 0);
        expect(after.y, `${p.name} sees note ${String(i)} moved`).toBeCloseTo(before.y + 60 + i * 20, 0);
      }
    }
    for (const p of people) expect(p.consoleErrors).toEqual([]);
    for (const p of people) await p.context.close();
  });
});
