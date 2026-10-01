import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD, STICKY_MIN_SIZE_WORLD } from '../../src/shared/config';
import { getCamera, openBoard } from './helpers/board';
import { closeAll, expectEventually, newNoteAt, notes, openParticipants, sameBoard } from './helpers/participants';

interface NoteRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  selected: boolean;
}

async function rects(page: Page): Promise<NoteRect[]> {
  const list = await notes(page).evaluateAll((els) =>
    els.map((el) => {
      const e = el as HTMLElement;
      return {
        id: e.dataset.noteId ?? '',
        left: parseFloat(e.style.left),
        top: parseFloat(e.style.top),
        width: parseFloat(e.style.width),
        height: parseFloat(e.style.height),
        z: parseInt(e.style.zIndex, 10),
        selected: e.dataset.selected === 'true',
      };
    }),
  );
  return list.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function makeNote(page: Page, x: number, y: number): Promise<string> {
  const id = await newNoteAt(page, x, y);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  return id;
}

/** Shift+drag from empty space. */
async function marquee(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** A note that was just created stays selected; start from an empty selection (the marquee is additive). */
async function clearSelection(page: Page) {
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await selectedIds(page)).length).toBe(0);
}

async function dragFrom(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

async function centreOf(page: Page, id: string) {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error('note not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A fresh board has the world origin at the centre of the 1280-wide viewport, at 100% zoom.
const VIEWPORT_CENTRE_X = 640;
const screenCentreX = (r: NoteRect) => r.left + r.width / 2 + VIEWPORT_CENTRE_X;

const selectedIds =async (page: Page) => (await rects(page)).filter((r) => r.selected).map((r) => r.id);

test.describe('multi-select', () => {
  test('TC-32 Shift+drag selects only notes entirely inside the rectangle', async ({ page }) => {
    await openBoard(page);
    const a = await makeNote(page, 250, 250); // 150..350
    const b = await makeNote(page, 480, 250); // 380..580, half inside the rectangle below
    const c = await makeNote(page, 900, 600);
    await clearSelection(page);
    await marquee(page, [120, 100], [480, 400]);
    expect(await selectedIds(page)).toEqual([a]);
    expect(await selectedIds(page)).not.toContain(b);
    expect(await selectedIds(page)).not.toContain(c);
  });

  test('TC-33 and TC-34 reorganise a cluster: move, resize, nudge, delete', async ({ page }) => {
    await openBoard(page);
    const cluster: string[] = [];
    for (const y of [200, 450]) for (const x of [250, 500, 750]) cluster.push(await makeNote(page, x, y));
    const other = await makeNote(page, 1100, 300);
    await clearSelection(page);
    await marquee(page, [120, 60], [900, 600]);
    await expect(page.getByText('6 selected')).toBeVisible();
    expect((await selectedIds(page)).sort()).toEqual([...cluster].sort());

    // Move 300 world units together and above the 4th note.
    const before = await rects(page);
    await dragFrom(page, await centreOf(page, cluster[0]), 300, 0);
    let after = await rects(page);
    const find = (list: NoteRect[], id: string) => list.find((r) => r.id === id)!;
    for (const id of cluster) {
      expect(find(after, id).left - find(before, id).left).toBeCloseTo(300, 1);
      expect(find(after, id).top).toBeCloseTo(find(before, id).top, 1);
      expect(find(after, id).z).toBeGreaterThan(find(after, other).z);
    }

    // Resize from the bottom-right corner: sizes and gaps scale, notes stay square.
    const startRects = await rects(page);
    const box = await page.getByTestId('selection-box').boundingBox();
    if (!box) throw new Error('no selection box');
    const handle = page.getByRole('button', { name: 'Resize bottom-right' });
    const hb = (await handle.boundingBox())!;
    await dragFrom(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, box.width * 0.1, 10);
    after = await rects(page);
    const scale = find(after, cluster[0]).width / find(startRects, cluster[0]).width;
    expect(scale).toBeCloseTo(1.1, 1);
    for (const id of cluster) {
      const r = find(after, id);
      expect(r.width).toBeCloseTo(r.height, 3);
      expect(r.width).toBeCloseTo(200 * scale, 2);
    }
    const gapBefore = find(startRects, cluster[1]).left - (find(startRects, cluster[0]).left + 200);
    const gapAfter = find(after, cluster[1]).left - (find(after, cluster[0]).left + find(after, cluster[0]).width);
    expect(gapAfter).toBeCloseTo(gapBefore * scale, 1);

    // Shrinking stops at the minimum size.
    const hb2 = (await handle.boundingBox())!;
    await dragFrom(page, { x: hb2.x + hb2.width / 2, y: hb2.y + hb2.height / 2 }, -2000, -2000);
    after = await rects(page);
    for (const id of cluster) expect(find(after, id).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 2);

    // Nudge with the arrow keys; the page and the board do not move.
    const cameraBefore = await getCamera(page);
    const nudgeStart = await rects(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    after = await rects(page);
    for (const id of cluster) {
      expect(find(after, id).left - find(nudgeStart, id).left).toBeCloseTo(NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD, 3);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await getCamera(page)).toEqual(cameraBefore);

    // Delete removes exactly the selection.
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    expect((await rects(page))[0].id).toBe(other);
  });

  test('Ctrl+A selects every note and Escape clears the selection', async ({ page }) => {
    await openBoard(page);
    await makeNote(page, 300, 300);
    await makeNote(page, 700, 300);
    await page.keyboard.press('ControlOrMeta+A');
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('2 selected')).toHaveCount(0);
  });

  test('TC-35 a colleague deletes one of my selected notes: my selection drops it', async ({ browser }) => {
    const [lee, sam] = await openParticipants(browser, 2);
    try {
      const ids: string[] = [];
      for (const x of [250, 500, 750, 1000]) ids.push(await makeNote(lee.page, x, 200));
      await makeNote(lee.page, 500, 500);
      await expectEventually('notes reach Sam', async () => (await rects(sam.page)).length === 5);

      await clearSelection(lee.page);
      await marquee(lee.page, [120, 100], [1130, 330]);
      await expect(lee.page.getByText('4 selected')).toBeVisible();

      const target = await centreOf(sam.page, ids[1]);
      await sam.page.mouse.click(target.x, target.y);
      await sam.page.keyboard.press('Delete');

      await expect(lee.page.getByText('3 selected')).toBeVisible();
      await expect(lee.page.getByTestId('selection-outline')).toHaveCount(3);
      await expect(notes(lee.page)).toHaveCount(4);
      await lee.page.keyboard.press('Delete');
      await expect(notes(lee.page)).toHaveCount(1);
    } finally {
      await closeAll([lee, sam]);
    }
  });

  test('TC-36 full capacity: everyone moves a different selection at once and all screens agree', async ({ browser }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      const xs = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => 200 + 230 * i);
      for (const x of xs) for (const y of [200, 450]) await makeNote(people[0].page, x, y);
      const total = xs.length * 2;
      for (const p of people) await expectEventually('notes arrive', async () => (await rects(p.page)).length === total);
      const start = await rects(people[0].page);

      await Promise.all(
        people.map(async (p, i) => {
          await clearSelection(p.page);
          await marquee(p.page, [xs[i] - 115, 60], [xs[i] + 115, 600]);
          await expect(p.page.getByText('2 selected')).toBeVisible();
          const mine = start.find((r) => Math.abs(screenCentreX(r) - xs[i]) < 10)!;
          await dragFrom(p.page, await centreOf(p.page, mine.id), 20 * (i + 1), 15 * (i + 1));
        }),
      );

      await expectEventually('screens agree', () => sameBoard(people));
      const end = await rects(people[0].page);
      for (const r of start) {
        const col = xs.findIndex((x) => Math.abs(screenCentreX(r) - x) < 10);
        const now = end.find((e) => e.id === r.id)!;
        expect(now.left - r.left).toBeCloseTo(20 * (col + 1), 1);
        expect(now.top - r.top).toBeCloseTo(15 * (col + 1), 1);
      }
    } finally {
      await closeAll(people);
    }
  });
});
