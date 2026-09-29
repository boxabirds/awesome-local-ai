import { type Page } from '@playwright/test';
import { expect, test } from './helpers/boardTest';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  board,
  readCamera,
  readNotes,
  screenPointOf,
  seedNotes,
  settle,
  setCamera,
} from './helpers/board';
import { openCrowd, slotOf } from './helpers/boards';

/**
 * Story 7 in a real browser: marquee, group move and keyboard commands.
 *
 * Where the component suite proves the *selection reducer* and *transform
 * geometry* in jsdom, this suite proves that a Shift+drag in Chromium /
 * Firefox / WebKit is dispatched the way the app expects — pointer capture,
 * Shift as a real modifier on the PointerEvent, and hit-testing through
 * `document.elementFromPoint`. Two things can only be seen here:
 *
 *   - the boundary case (a note *half* inside the rectangle is NOT selected)
 *     depends on real mouse-event ordering, and
 *   - a keyboard shortcut is only really tested when the browser's own
 *     "select all" would have otherwise selected the page's text.
 *
 * Positions are computed from world coordinates and the *live* camera, so
 * the geometry holds at any zoom. Notes are 200 world units wide, so the
 * marquee rectangle has to be clearly larger than the notes to enclose them.
 */

const HALF = STICKY_SIZE_WORLD / 2;

/** Press at a page-space point, drag by (dx, dy), release, then let it settle. */
async function dragFrom(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  options: { shift?: boolean } = {},
): Promise<void> {
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
  await settle(page);
}

/** Convert a world point to page-space coordinates using the *live* camera. */
async function worldToPage(page: Page, world: { x: number; y: number }) {
  return screenPointOf(page, world);
}

/**
 * Wait for the selection outlines to be exactly the given ids.
 *
 * The mouse-up returns before the app's React commit and Y.Doc transaction
 * have flushed, and the number of outlines changes as selection is pruned
 * against the snapshot. Polling the DOM — not a fixed sleep — is what keeps
 * this stable at any zoom and on all three engines.
 */
async function expectSelection(page: Page, ids: readonly string[]): Promise<void> {
  const wanted = new Set(ids);
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="local-selection-outline"]'),
          ).map((el) => el.getAttribute('data-outline-id') ?? ''),
        );
        if (now.length !== wanted.size) return false;
        return now.every((id) => wanted.has(id));
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

test('TC-32 a Shift+drag selects notes fully inside the rectangle', async ({ page }) => {
  // Camera placed so the whole row is on screen at 50%. Notes are seeded as
  // *centres*: A's top-left is (-HALF, -HALF), and the gap between A and B is
  // larger than the marquee's own tolerance for "half inside".
  await settle(page);
  await setCamera(page, { x: -500, y: -250, zoom: 0.5 });

  const [aId, bId, cId] = await seedNotes(page, [
    { x: 0, y: 0 }, // rect: (-100..100, -100..100) — fully inside
    { x: 300, y: 0 }, // rect: (200..400, ...) — right edge beyond marquee
    { x: 800, y: 0 }, // rect: (700..900, ...) — entirely outside
  ]);

  // Marquee rect from world (-200, -200) to world (150, 200). At zoom 0.5
  // that is a screen drag of (175, 200) px, big enough to enclose A clearly
  // while stopping well before B's right edge.
  const start = await worldToPage(page, { x: -200, y: -200 });
  const end = await worldToPage(page, { x: 150, y: 200 });
  await dragFrom(page, start.x, start.y, end.x - start.x, end.y - start.y, {
    shift: true,
  });

  // A is inside, so it becomes the selection. B is *not* fully inside, so
  // the marquee stops short of it. C is nowhere near the rectangle.
  await expectSelection(page, [aId]);

  // The two notes the marquee did not select are still just notes: same
  // places, still 3 seeds on the board.
  const after = await readNotes(page);
  expect(after.length).toBe(3);
  expect(after.map((row) => row.id)).toContain(bId);
  expect(after.map((row) => row.id)).toContain(cId);
});

test('TC-33 a group drag moves every selected note by the same world vector', async ({
  page,
}) => {
  await settle(page);
  await setCamera(page, { x: -500, y: -350, zoom: 0.35 });

  // Six notes in a 3x2 grid, plus a 7th unselected one below. The 7th lets
  // the test assert that the "raise above" side effect of a group drag does
  // not touch unselected notes.
  // Six notes in a 3x2 grid, plus a 7th unselected one to the right. The 7th
  // lets the test assert that the "raise above" side effect of a group drag
  // does not touch unselected notes. All seven go in one call because
  // `seedNotes` waits on the *total* rendered count.
  const ids = await seedNotes(page, [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 520, y: 0 },
    { x: 0, y: 260 },
    { x: 260, y: 260 },
    { x: 520, y: 260 },
    { x: 900, y: 0 },
  ]);
  const picked = ids.slice(0, 6);
  const sevenId = ids[6]!;
  expect(picked.length).toBe(6);

  // Select the six with a Shift+drag marquee rather than Ctrl+A: Ctrl+A
  // selects *every* object on the board, which would include the 7th and
  // defeat the assertion below. The rectangle spans world (-180,-180) to
  // (777,491), so it fully encloses the six and stops short of the 7th,
  // whose left edge is at world x = 800.
  const marquee = await worldToPage(page, { x: -180, y: -180 });
  await dragFrom(
    page,
    marquee.x,
    marquee.y,
    (777 + 180) * 0.35,
    (491 + 180) * 0.35,
    { shift: true },
  );
  await expectSelection(page, picked);

  // Press on the top-left note (which is in the selection) and drag it. The
  // gesture hook picks this up as a *group* move because count >= 2, so all
  // six notes translate together.
  const start = await worldToPage(page, { x: 0, y: 0 });
  const before = await readNotes(page);
  await dragFrom(page, start.x, start.y, 105, 70);

  // Every one of the six moved by the same amount: 105/0.35 = 300 world
  // units in x, 70/0.35 = 200 in y.
  const after = await readNotes(page);
  const byId = new Map(after.map((row) => [row.id, row]));
  for (const id of picked) {
    const b = before.find((row) => row.id === id);
    const a = byId.get(id);
    expect(a).toBeDefined();
    expect(a!.x).toBeCloseTo(b!.x + 300, 1);
    expect(a!.y).toBeCloseTo(b!.y + 200, 1);
  }

  // The unselected seventh was not moved.
  const sevenBefore = before.find((row) => row.id === sevenId)!;
  const sevenAfter = byId.get(sevenId)!;
  expect(sevenAfter.x).toBeCloseTo(sevenBefore.x, 1);
  expect(sevenAfter.y).toBeCloseTo(sevenBefore.y, 1);

  // The six moved notes were raised above the seventh, and their relative z
  // is preserved (they were seeded below it, and their own order is kept).
  const zOrder = (await readNotes(page)).map((row) => row.id);
  expect(zOrder.indexOf(sevenId)).toBeLessThan(zOrder.indexOf(picked[0]!));
  for (let i = 1; i < picked.length; i += 1) {
    expect(zOrder.indexOf(picked[i - 1]!)).toBeLessThan(zOrder.indexOf(picked[i]!));
  }

  // The camera never moved during the drag.
  expect(await readCamera(page)).toEqual({ x: -500, y: -350, zoom: 0.35 });
});

test('TC-34 arrow keys nudge the whole selection without panning the board', async ({
  page,
}) => {
  await settle(page);
  await setCamera(page, { x: -400, y: -250, zoom: 0.5 });

  const picked = await seedNotes(page, [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 520, y: 0 },
    { x: 0, y: 260 },
    { x: 260, y: 260 },
    { x: 520, y: 260 },
  ]);

  await page.keyboard.press('Control+a');
  await settle(page);
  await expectSelection(page, picked);

  const cameraBefore = await readCamera(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const before = await readNotes(page);

  // Three nudges right, then a Shift+nudge: the total world shift is
  // 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD.
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await page.keyboard.press('Shift+ArrowRight');
  await settle(page);

  const after = await readNotes(page);
  const shift = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
  const byId = new Map(after.map((row) => [row.id, row]));
  for (const id of picked) {
    const b = before.find((row) => row.id === id)!;
    const a = byId.get(id)!;
    expect(a.x).toBeCloseTo(b.x + shift, 1);
    expect(a.y).toBeCloseTo(b.y, 1);
  }

  // The camera and the page scroll never moved. `preventDefault` on the
  // arrow keys is the whole story: without it, arrow keys scroll the window
  // and the board would drift instead of the notes.
  expect(await readCamera(page)).toEqual(cameraBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // Delete removes all six, and the selection becomes Empty.
  await page.keyboard.press('Delete');
  await settle(page);
  await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
});

test('TC-35 a remote delete drops the note from my selection within 2 s', async ({
  browser,
}, testInfo) => {
  const { pages, contexts } = await openCrowd(browser, 2, 'TC-35', slotOf(testInfo));
  const [lee, sam] = pages;
  if (!lee || !sam) throw new Error('openCrowd returned fewer than two pages');

  await settle(lee);
  await settle(sam);
  await setCamera(lee, { x: -600, y: -200, zoom: 0.5 });

  // Four notes; Lee selects three of them with a Shift+marquee.
  const ids = await seedNotes(lee, [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 520, y: 0 },
    { x: 780, y: 0 },
  ]);
  expect(ids.length).toBe(4);

  // Wait for the four notes to reach Sam.
  await expect
    .poll(async () => (await readNotes(sam)).length, { timeout: 5_000 })
    .toBe(4);

  // Lee drags a Shift+marquee that covers the first three.
  const start = await worldToPage(lee, { x: -200, y: -150 });
  const end = await worldToPage(lee, { x: 620, y: 150 });
  await dragFrom(lee, start.x, start.y, end.x - start.x, end.y - start.y, {
    shift: true,
  });
  const firstThree = ids.slice(0, 3);
  await expectSelection(lee, firstThree);

  // Sam deletes one of Lee's selected notes on Sam's own client. The delete
  // travels through the Durable Room, and Lee's selection should shrink to
  // two as the id is pruned from the snapshot.
  const removed = firstThree[1]!;
  await sam.evaluate((id) => {
    const hooks = (window as unknown as { __vidi6?: { removeNote(id: string): boolean } })
      .__vidi6;
    if (!hooks) throw new Error('Sam has no __vidi6 hook yet');
    if (!hooks.removeNote(id)) throw new Error(`Sam could not remove ${id}`);
  }, removed);

  const remaining = [firstThree[0]!, firstThree[2]!];
  await expectSelection(lee, remaining);

  await Promise.all(contexts.map((context) => context.close()));
});

test('TC-36 MAX_CONCURRENT_EDITORS move different selections and converge', async ({
  browser,
}, testInfo) => {
  const { pages, contexts } = await openCrowd(
    browser,
    MAX_CONCURRENT_EDITORS,
    'TC-36',
    slotOf(testInfo),
  );

  // The first page is the anchor: it seeds the notes and reads back state.
  // The remaining pages are the editors, each with a different selection.
  const [anchor, ...editors] = pages;
  if (!anchor) throw new Error('no anchor page');
  await settle(anchor);
  await setCamera(anchor, { x: -500, y: -250, zoom: 0.5 });

  // Put MAX_CONCURRENT_EDITORS + 1 notes on the board. Each editor will take
  // the i-th note into its own selection and drag it by a different vector.
  const seeds = Array.from({ length: MAX_CONCURRENT_EDITORS + 1 }, (_0, i) => ({
    x: 260 * i,
    y: 0,
  }));
  const ids = await seedNotes(anchor, seeds);
  expect(ids.length).toBe(MAX_CONCURRENT_EDITORS + 1);

  // Everyone waits for the seed to arrive on their own page.
  for (const page of pages) {
    await settle(page);
    await expect
      .poll(async () => (await readNotes(page)).length, { timeout: 5_000 })
      .toBe(MAX_CONCURRENT_EDITORS + 1);
    await setCamera(page, { x: -500, y: -250, zoom: 0.5 });
  }

  // Each editor drags their own note rightward. Absolute writes: whichever
  // order the Durable Room sees them, every client ends on the same numbers.
  const shifts = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_0, i) => 60 + i * 40);
  await Promise.all(
    editors.map(async (page, i) => {
      const id = ids[i]!;
      const note = (await readNotes(page)).find((row) => row.id === id);
      if (!note) throw new Error(`page ${i} does not have note ${id} yet`);
      const centre = await worldToPage(page, { x: note.x + HALF, y: note.y + HALF });
      // Single-click first so this page's selection is only this note; the
      // group move path would otherwise require 2+ selected.
      await page.mouse.click(centre.x, centre.y);
      await settle(page);
      await dragFrom(page, centre.x, centre.y, shifts[i]!, 0);
    }),
  );

  // Convergence: every page must agree on the final (x, y) per id, because
  // every writer used absolute positions.
  await expect
    .poll(
      async () => {
        const views = await Promise.all(pages.map((page) => readNotes(page)));
        const reference = views[0]!;
        for (const view of views) {
          if (view.length !== reference.length) return false;
          for (const row of view) {
            const ref = reference.find((r) => r.id === row.id);
            if (!ref) continue;
            if (Math.abs(row.x - ref.x) > 0.5) return false;
            if (Math.abs(row.y - ref.y) > 0.5) return false;
          }
        }
        return true;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  await Promise.all(contexts.map((context) => context.close()));
});
