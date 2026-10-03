/**
 * E2E tests for story 7: select, move, resize and delete several objects at
 * once (TC-32 to TC-36).
 *
 * The camera is normalised per test; screen↔world conversions use the
 * standard formula screen = (world − camera) × zoom with camera
 * {x: -640, y: -400}. Notes are inserted at exact world points through the
 * test-only `insertSticky` hook (test builds).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBoardAndOpen, setCamera, originMarkerCenter } from './helpers/board';
import { openParticipants, expectEventually } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** Insert a sticky centred on a world point (test build hook). */
async function insertSticky(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(async ({ x, y }) => {
    const hook = (window as { __vidi6?: { insertSticky?: (x: number, y: number) => string } }).__vidi6;
    if (!hook?.insertSticky) throw new Error('insertSticky hook missing (not a test build?)');
    return hook.insertSticky(x, y);
  }, { x, y });
}

/** Inline-style world geometry of the notes with the given ids (DOM order). */
async function noteGeometry(
  page: Page,
  ids?: string[],
): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  return page.evaluate((want) => {
    const els = [...document.querySelectorAll('[data-testid="sticky-note"]')];
    const list = want ? els.filter((el) => want.includes(el.getAttribute('data-note-id') as string)) : els;
    return list.map((el) => {
      const s = (el as HTMLElement).style;
      return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
    });
  }, ids ?? null);
}

/** Shift+drag a marquee between two screen points. */
async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Number of elements carrying the data-selected attribute. */
async function selectedCount(page: Page): Promise<number> {
  return page.locator('[data-selected]').count();
}

test.describe('story 7 e2e', () => {
  test.beforeEach(async ({ page }) => {
    await createBoardAndOpen(page);
  });

  // TC-32: marquee selects only the fully-inside note.
  test('TC-32: marquee selects fully-inside objects only', async ({ page }) => {
    await setCamera(page, { x: -640, y: -400, zoom: 0.5 });

    const a = await insertSticky(page, 0, 0); // spans [-100,100]
    await insertSticky(page, 400, 0); // spans [300,500] — half inside
    await insertSticky(page, 900, 0); // spans [800,1000] — outside

    // Marquee over world [-150,-150]..[450,150] → screen (zoom 0.5).
    await marqueeDrag(page, 245, 125, 545, 275);

    expect(await selectedCount(page)).toBe(1);
    const selectedId = await page.locator('[data-selected]').getAttribute('data-note-id');
    expect(selectedId).toBe(a);
  });

  // TC-33: 6 notes move 300 world units together above a 7th note; corner
  // resize scales sizes and gaps; notes stay square.
  test('TC-33: group move preserves layout and stacking; corner resize scales', async ({ page }) => {
    await setCamera(page, { x: -640, y: -400, zoom: 0.5 });

    // 3×2 grid of notes, 300 world units apart (centres).
    const group: string[] = [];
    for (const gx of [-400, -100, 200]) {
      for (const gy of [-150, 150]) {
        group.push(await insertSticky(page, gx, gy));
      }
    }
    // A 7th note the group will move on top of (it sticks out of the group's
    // bounding box so re-selecting the group does not capture it).
    const extra = await insertSticky(page, 600, -200);
    void extra;

    const screen = (wx: number, wy: number) => ({ x: (wx + 640) * 0.5, y: (wy + 400) * 0.5 });

    // Marquee over the grid: world [-550,-300]..[350,300].
    const m1 = screen(-550, -300);
    const m2 = screen(350, 300);
    await marqueeDrag(page, m1.x, m1.y, m2.x, m2.y);
    expect(await selectedCount(page)).toBe(6);

    const before = await noteGeometry(page, group);

    // Drag the group +300 world units (= +150 screen at zoom 0.5), grabbing
    // one of the selected notes.
    const grab = screen(-100, -150);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 150, grab.y, { steps: 10 });
    await page.mouse.up();

    const after = await noteGeometry(page, group);
    expect(after).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(300, 0);
      expect(after[i].y - before[i].y).toBeCloseTo(0, 0);
    }

    // Stacking: the moved group is above the 7th note (DOM order).
    const domOrder = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sticky-note"]')].map((el) =>
        el.getAttribute('data-note-id'),
      ),
    );
    const extraIndex = domOrder.indexOf(extra);
    expect(extraIndex).toBeGreaterThan(-1);
    for (const id of group) {
      expect(domOrder.indexOf(id)).toBeGreaterThan(extraIndex);
    }

    // Re-select the moved group and resize from the SE corner.
    const m3 = screen(-250, -300);
    const m4 = screen(650, 300);
    await marqueeDrag(page, m3.x, m3.y, m4.x, m4.y);
    expect(await selectedCount(page)).toBe(6);

    // SE handle of the 800×500 box at world (600, 250).
    const se = screen(600, 250);
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    // +80 world x, +40 world y → scale 1.1 (max of 880/800, 540/500).
    await page.mouse.move(se.x + 40, se.y + 20, { steps: 10 });
    await page.mouse.up();

    const resized = await noteGeometry(page, group);
    for (const n of resized) {
      expect(n.w).toBeCloseTo(220, 0); // 200 × 1.1
      expect(n.h).toBeCloseTo(220, 0); // square
    }
    // Gaps scale too: column pitch was 300, now 330 (top row, left to right).
    const topRow = resized.filter((n) => n.y < 0).sort((a, b) => a.x - b.x);
    expect(topRow).toHaveLength(3);
    expect(Math.abs(topRow[1].x - topRow[0].x - 330)).toBeLessThan(2);
    expect(Math.abs(topRow[2].x - topRow[1].x - 330)).toBeLessThan(2);
  });

  // TC-34: arrows nudge without page scroll or board pan; Delete removes all.
  test('TC-34: arrows nudge the selection; Delete removes it all', async ({ page }) => {
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    await insertSticky(page, 0, 0);
    await insertSticky(page, 300, 0);
    await insertSticky(page, -300, 0);

    await page.keyboard.press('Control+a');
    expect(await selectedCount(page)).toBe(3);

    const originBefore = await originMarkerCenter(page);
    const before = await noteGeometry(page);

    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp');

    // The board did not pan and the page did not scroll.
    const originAfter = await originMarkerCenter(page);
    expect(originAfter.x).toBe(originBefore.x);
    expect(originAfter.y).toBe(originBefore.y);
    expect(await page.evaluate(() => window.scrollX + window.scrollY)).toBe(0);

    // Every note moved +3 x, −20 y (3 × 1 and 2 × 10).
    const after = await noteGeometry(page);
    for (let i = 0; i < 3; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(3, 0);
      expect(after[i].y - before[i].y).toBeCloseTo(-20, 0);
    }

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
  });

  // TC-35: a colleague deletes one of my selected notes → my count drops.
  test('TC-35: remote deletion prunes the local selection', async ({ browser }) => {
    const [lee, sam] = await openParticipants(browser, 2);
    try {
      await setCamera(lee.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Lee seeds three notes and selects them all.
      await insertSticky(lee.page, -300, 0);
      await insertSticky(lee.page, 0, 0);
      await insertSticky(lee.page, 300, 0);
      await expectEventually(
        async () => (await noteCountOf(sam.page)) === 3,
        'Sam sees the three notes',
      );

      await lee.page.keyboard.press('Control+a');
      await expect(lee.page.locator('[data-testid="selection-count"]')).toHaveText('3 selected');

      // Sam deletes the middle note.
      const notes = sam.page.locator('[data-testid="sticky-note"]');
      await notes.nth(1).click();
      await sam.page.keyboard.press('Delete');

      // Lee's selection count drops by one (pruned).
      await expectEventually(
        async () => {
          const text = (await lee.page.locator('[data-testid="selection-count"]').textContent()) ?? '';
          return text === '2 selected';
        },
        "Lee's selection count drops to 2",
      );
    } finally {
      await lee.close();
      await sam.close();
    }
  });

  // TC-36: MAX_CONCURRENT_EDITORS participants move different selections at
  // the same time → identical final boards.
  test(`TC-36: ${MAX_CONCURRENT_EDITORS} participants move different selections simultaneously`, async ({ browser }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const parts = await openParticipants(browser, n);
    try {
      const leader = parts[0];
      // Five notes in a row, 300 units apart.
      for (let i = 0; i < n; i++) {
        await insertSticky(leader.page, -600 + i * 300, 0);
      }
      for (const p of parts) {
        await expectEventually(async () => (await noteCountOf(p.page)) === n, `${p.name} sees all notes`);
      }

      // Each participant drags their own note (note i by (i+1)*30 px).
      await Promise.all(
        parts.map(async (p, i) => {
          const box = await p.page.locator('[data-testid="sticky-note"]').nth(i).boundingBox();
          if (!box) throw new Error(`${p.name}: note ${i} not found`);
          const gx = box.x + box.width / 2;
          const gy = box.y + box.height / 2;
          await p.page.mouse.move(gx, gy);
          await p.page.mouse.down();
          await p.page.mouse.move(gx + (i + 1) * 30, gy + (i + 1) * 20, { steps: 8 });
          await p.page.mouse.up();
        }),
      );

      // All participants converge on the identical board. Poll until every
      // participant renders the same set of positions (drags may still be
      // settling when the last pointerup is dispatched).
      const snap = (p: (typeof parts)[number]) =>
        p.page.evaluate(() =>
          JSON.stringify(
            [...document.querySelectorAll('[data-testid="sticky-note"]')].map((el) => {
              const s = (el as HTMLElement).style;
              return [parseFloat(s.left), parseFloat(s.top)];
            }).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
          ),
        );
      await expect.poll(async () => {
        const s: string[] = [];
        for (const p of parts) s.push(await snap(p));
        return new Set(s).size === 1;
      }, { timeout: 20_000, message: 'all participants converge on the same board' }).toBe(true);

      const snapshots: string[] = [];
      for (const p of parts) snapshots.push(await snap(p));
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i]).toBe(snapshots[0]);
      }
    } finally {
      for (const p of parts) await p.close();
    }
  });
});

/** Count of rendered sticky notes. */
async function noteCountOf(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"]').count();
}
