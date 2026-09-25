import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { getNotes, originMarker } from './helpers/board';
import {
  createNoteAt,
  dragNote,
  expectNoteCountWithin,
  expectWithin,
  freshBoardId,
  join,
  type Participant,
} from './helpers/participants';

/**
 * Story 7 e2e: multi-select, group move/resize/nudge and group delete
 * (task 15, TC-32 to TC-36; task 5, TC-35).
 *
 * Every test joins a fresh `/b/<boardId>` board (the app's `/` is the
 * landing page since story 5). Camera math (HOME camera: world (0,0) at
 * screen (640,400), zoom 1): screen = world + (640, 400). A note created
 * centred on world (wx, wy) has its top-left at (wx - 100, wy - 100).
 */

/** World → screen under the HOME camera. */
const W2S = (wx: number, wy: number) => ({ x: wx + 640, y: wy + 400 });

/** A note element by its doc id (StickyNote exposes `data-note-id`). */
const noteEl = (page: Page, id: string) => page.locator(`.vidi6-sticky[data-note-id="${id}"]`);

/** Full object snapshots (including width/height) via the test hook. */
interface FullNote {
  id: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

async function fullNotes(page: Page): Promise<FullNote[]> {
  return page.evaluate(() => {
    const hook = (
      window as unknown as { __vidi6?: { getNotes(): readonly unknown[] } }
    ).__vidi6;
    return (hook ? hook.getNotes() : []) as FullNote[];
  });
}

const byId = (notes: readonly FullNote[]) =>
  Object.fromEntries(notes.map((n) => [n.id, n])) as Record<string, FullNote>;

/**
 * Seed notes centred on the given world points (double-click + Escape per
 * note). Returns the ids in creation order (which is the z order: every
 * new note takes the top of the stack).
 *
 * Ending the last note's edit keeps it selected (endEdit keeps the
 * selection), so the seed finishes with an empty-space click that clears
 * the selection — subsequent marquee/shift-click tests start from an
 * empty set (the marquee ADDS to the current selection, prd sel.marquee).
 */
async function seed(
  page: Page,
  centers: ReadonlyArray<readonly [number, number]>,
): Promise<string[]> {
  for (const [wx, wy] of centers) {
    const p = W2S(wx, wy);
    await createNoteAt(page, p.x, p.y);
  }
  const all = await fullNotes(page);
  expect(all).toHaveLength(centers.length);
  // World (-275, -330) → screen (365, 70): empty in every fixture in this
  // file (sits in the x gap between the first two note columns) and clear
  // of the left toolbar (x < ~70).
  await page.mouse.click(W2S(-275, -330).x, W2S(-275, -330).y);
  return all.map((n) => n.id);
}

/**
 * Shift+click the centre of each world point: builds a multi-selection
 * without moving anything (a sub-threshold press is a click).
 */
async function shiftSelect(
  page: Page,
  centers: ReadonlyArray<readonly [number, number]>,
): Promise<void> {
  for (const [wx, wy] of centers) {
    const p = W2S(wx, wy);
    await page.keyboard.down('Shift');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');
  }
}

/** Shift+drag a marquee between two screen points. */
async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Close every participant, whatever the outcome. */
async function closeAll(...ps: Participant[]): Promise<void> {
  for (const p of ps) await p.close();
}

/** The 3×2 grid fixture (centres x ∈ {-400, -100, 200}, y ∈ {-150, 150}). */
const GRID: ReadonlyArray<readonly [number, number]> = [
  [-400, -150],
  [-100, -150],
  [200, -150],
  [-400, 150],
  [-100, 150],
  [200, 150],
];
/** The unselected "fourth" note centre, below the grid (created first → lowest z). */
const D_CENTER: readonly [number, number] = [0, 300];

test.describe('sel.marquee_ui', () => {
  test('TC-32 A fully inside, B half inside, C outside the Shift+drag rect → only A selected', async ({
    browser,
  }) => {
    const p = await join(browser, freshBoardId());
    try {
      // A centre (-200, 0); B centre (100, 0); C centre (400, 0).
      const [a, b, c] = await seed(p.page, [[-200, 0], [100, 0], [400, 0]]);
      await expect(p.page.locator('.vidi6-sticky')).toHaveCount(3);

      // Marquee world rect (-350, -150) to (100, 150) → screen (290, 250)
      // to (740, 550). A spans (-300..-100, -100..100): fully inside.
      // B spans (0..200, -100..100): half inside (right half cut at x = 100).
      // C spans (300..500, -100..100): outside.
      await marquee(p.page, { x: 290, y: 250 }, { x: 740, y: 550 });

      await expect(noteEl(p.page, a)).toHaveAttribute('data-selected', 'true');
      await expect(noteEl(p.page, b)).toHaveAttribute('data-selected', 'false');
      await expect(noteEl(p.page, c)).toHaveAttribute('data-selected', 'false');

      // One sticky → the story 2 NoteToolbar, not the multi-select bar.
      await expect(p.page.getByRole('toolbar', { name: 'Note options' })).toBeVisible();
      await expect(p.page.getByTestId('selection-bar')).toHaveCount(0);
    } finally {
      await closeAll(p);
    }
  });
});

test.describe('sel.transform', () => {
  test('TC-33 group move 300 raises z above the 4th note; se resize scales notes and gaps, stays square; shrinking stops at the min size', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const p = await join(browser, freshBoardId());
    try {
      // D first (lowest z), then the six grid notes.
      const [d, ...s] = await seed(p.page, [D_CENTER, ...GRID]);
      expect(s).toHaveLength(6);

      await shiftSelect(p.page, GRID);
      await expect(p.page.locator('.vidi6-sticky--selected')).toHaveCount(6);
      await expect(p.page.getByTestId('selection-bar')).toContainText('6 selected');

      const before = byId(await fullNotes(p.page));

      // Drag one selected note 300 world units right (zoom 1 → 300 px).
      const p1 = W2S(-400, -150);
      await dragNote(p.page, p1.x, p1.y, 300, 0);

      const moved = byId(await fullNotes(p.page));
      for (const id of s) {
        expect(moved[id].x).toBeCloseTo(before[id].x + 300, 3);
        expect(moved[id].y).toBeCloseTo(before[id].y, 3);
        // All six now render above D.
        expect(moved[id].z).toBeGreaterThan(moved[d].z);
      }
      // D did not move.
      expect(moved[d].x).toBeCloseTo(before[d].x, 3);
      expect(moved[d].y).toBeCloseTo(before[d].y, 3);

      // Selection box: top-left (-200, -250) world → screen (440, 150),
      // size 800×500; the 'se' handle sits at screen (1240, 650).
      // Drag it by (30, 30): uniform scale 830/800 = 1.0375.
      await dragNote(p.page, 1240, 650, 30, 30);

      const scaled = byId(await fullNotes(p.page));
      const scaledSize = 200 * (830 / 800); // 207.5
      for (const id of s) {
        expect(scaled[id].width).toBeCloseTo(scaledSize, 3);
        // Stickies are aspect-locked: they stay square.
        expect(scaled[id].height).toBeCloseTo(scaledSize, 3);
      }
      // The 100-unit gap between the two left top-row notes scales too.
      const gap = scaled[s[1]!].x - (scaled[s[0]!].x + (scaled[s[0]!].width ?? 0));
      expect(gap).toBeCloseTo(100 * (830 / 800), 3);

      // Shrink far below the minimum: raw box 50×50 (scale ≈ 0.06) → the
      // group must stop at STICKY_MIN_SIZE_WORLD per note (scale ≈ 0.241).
      // The box is now 830×518.75, top-left still (440, 150);
      // 'se' at (1270, 668.75).
      await dragNote(p.page, 1270, 668.75, -(830 - 50), -(518.75 - 50));

      const shrunk = byId(await fullNotes(p.page));
      for (const id of s) {
        expect(shrunk[id].width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
        expect(shrunk[id].height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 3);
      }
      // D was never resized (no explicit width/height in the doc).
      expect(shrunk[d].width).toBeUndefined();
      expect(shrunk[d].height).toBeUndefined();
    } finally {
      await closeAll(p);
    }
  });

  test('TC-36 MAX_CONCURRENT_EDITORS contexts each move a different selection at the same time → identical final positions', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ps = [] as Participant[];
    try {
      // One context per concurrent editor, all on the same board.
      const boardId = freshBoardId();
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        ps.push(await join(browser, boardId));
      }

      // Each editor creates one note: centres on a horizontal row
      // (world x = -400 + 200i, y = -200), 200 apart edge to edge.
      const starts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const center = W2S(-400 + 200 * i, -200);
        starts.push(center);
        await createNoteAt(ps[i]!.page, center.x, center.y);
      }
      for (const q of ps) {
        await expectNoteCountWithin(q, MAX_CONCURRENT_EDITORS);
      }

      // Select each editor's own note (a plain click selects only it).
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        await ps[i]!.page.mouse.click(starts[i]!.x, starts[i]!.y);
      }
      for (const q of ps) {
        await expect(q.page.locator('.vidi6-sticky--selected')).toHaveCount(1);
      }

      // Different targets per editor: (80 + 30i, 120) screen px.
      const deltas = ps.map((_, i) => ({ dx: 80 + 30 * i, dy: 120 }));

      // Simultaneous drags: everyone presses, move steps are interleaved,
      // everyone releases.
      await Promise.all(
        ps.map((q, i) =>
          q.page.mouse.move(starts[i]!.x, starts[i]!.y).then(() => q.page.mouse.down()),
        ),
      );
      const steps = 10;
      for (let step = 1; step <= steps; step++) {
        await Promise.all(
          ps.map((q, i) =>
            q.page.mouse.move(
              starts[i]!.x + (deltas[i]!.dx * step) / steps,
              starts[i]!.y + (deltas[i]!.dy * step) / steps,
            ),
          ),
        );
      }
      await Promise.all(ps.map((q) => q.page.mouse.up()));

      // Expected final top-lefts: start centre - (100, 100) + delta.
      const key = (n: { x: number; y: number }) =>
        `${Math.round(n.x * 100) / 100},${Math.round(n.y * 100) / 100}`;
      const expected = ps
        .map((_, i) => {
          const wx = -400 + 200 * i - 100 + deltas[i]!.dx;
          const wy = -200 - 100 + deltas[i]!.dy;
          return key({ x: wx, y: wy });
        })
        .sort()
        .join('|');

      // Absolute writes converge: every context shows the identical set.
      for (const q of ps) {
        await expectWithin(
          () => getNotes(q.page).then((ns) => ns.map(key).sort().join('|')),
          expected,
        );
      }
      expect(ps.flatMap((q) => q.pageErrors)).toEqual([]);
    } finally {
      await closeAll(...ps);
    }
  });
});

test.describe('sel.keyboard', () => {
  test('TC-34 ArrowRight ×3 then Shift+ArrowRight nudges by 3 + 10 world units without panning; Delete removes all six', async ({
    browser,
  }) => {
    const p = await join(browser, freshBoardId());
    try {
      const selIds = await seed(p.page, GRID);
      expect(selIds).toHaveLength(6);
      await shiftSelect(p.page, GRID);
      await expect(p.page.locator('.vidi6-sticky--selected')).toHaveCount(6);

      const before = byId(await fullNotes(p.page));
      const originBefore = (await originMarker(p.page).boundingBox())!;
      const scrollBefore = await p.page.evaluate(() => window.scrollY);

      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.press('ArrowRight');
      await p.page.keyboard.press('Shift+ArrowRight');

      const nudged = byId(await fullNotes(p.page));
      for (const id of selIds) {
        // 3 × NUDGE_STEP_WORLD (1) + 1 × NUDGE_LARGE_STEP_WORLD (10) = 13.
        expect(nudged[id].x).toBeCloseTo(before[id].x + 13, 3);
        expect(nudged[id].y).toBeCloseTo(before[id].y, 3);
      }

      // No pan: the world origin stays put and the page never scrolls.
      const originAfter = (await originMarker(p.page).boundingBox())!;
      expect(originAfter.x).toBeCloseTo(originBefore.x, 3);
      expect(originAfter.y).toBeCloseTo(originBefore.y, 3);
      expect(await p.page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      await p.page.keyboard.press('Delete');
      await expect(p.page.locator('.vidi6-sticky')).toHaveCount(0);
      await expect.poll(() => getNotes(p.page).then((n) => n.length)).toBe(0);
    } finally {
      await closeAll(p);
    }
  });
});

test.describe('sel.interaction', () => {
  test('TC-35 colleague deletes one of my selected notes → pruned to "3 selected"; Delete removes exactly the remaining three', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const boardId = freshBoardId();
    const lee = await join(browser, boardId);
    const sam = await join(browser, boardId);
    try {
      // 20-note fixture: a 5×4 grid (centres x ∈ {-400..600 step 250},
      // y ∈ {-300, -100, 100, 300}). Shifted right of the left toolbar so
      // the marquee can start on empty space; the rightmost column is
      // partly clipped by the viewport but its centre is visible. No
      // dblclick centre lands under the bottom-right zoom controls.
      const xCenters = [-400, -150, 100, 350, 600];
      const centers: Array<[number, number]> = [];
      for (const y of [-300, -100, 100, 300]) {
        for (const x of xCenters) centers.push([x, y]);
      }
      await seed(lee.page, centers);
      await expectNoteCountWithin(sam, 20);

      // Lee Shift+drags across the third row (four notes, centres y = 100
      // → note extent y 0..200; the four left notes span x -500..450).
      // Marquee world rect (-510, -10) to (460, 210) → screen (130, 390)
      // to (1100, 610): fully covers exactly those four (the row above
      // ends at y = 0, the row below starts at y = 200).
      await marquee(lee.page, { x: 130, y: 390 }, { x: 1100, y: 610 });
      await expect(lee.page.getByTestId('selection-bar')).toContainText('4 selected');
      await expect(lee.page.locator('.vidi6-sticky--selected')).toHaveCount(4);

      // Sam selects one of those four (centre (-150, 100) → screen (490, 500))
      // and presses Delete.
      await sam.page.mouse.click(490, 500);
      await expect(sam.page.locator('.vidi6-sticky--selected')).toHaveCount(1);
      await sam.page.keyboard.press('Delete');

      // Lee's selection prunes the deleted id within the live budget.
      await expectWithin(() => getNotes(lee.page).then((n) => n.length), 19);
      await expect
        .poll(
          async () =>
            ((await lee.page.getByTestId('selection-bar').textContent()) ?? '').trim(),
          {
            timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
            intervals: [20],
            message: "Lee's bar should read '3 selected' after the prune",
          },
        )
        .toBe('3 selected');
      // The remaining three still show outlines.
      await expect(lee.page.locator('.vidi6-sticky--selected')).toHaveCount(3);

      // Lee's Delete removes exactly those three.
      await lee.page.keyboard.press('Delete');
      await expectWithin(() => getNotes(lee.page).then((n) => n.length), 16);
      await expectWithin(() => getNotes(sam.page).then((n) => n.length), 16);
      await expect(lee.page.getByTestId('selection-bar')).toHaveCount(0);

      expect(lee.pageErrors).toEqual([]);
      expect(sam.pageErrors).toEqual([]);
    } finally {
      await closeAll(lee, sam);
    }
  });
});
