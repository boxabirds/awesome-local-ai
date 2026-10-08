import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { MAX_CONCURRENT_EDITORS, STICKY_MIN_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import type { NoteSpec } from '../fixtures/boards';
import { settle, setCamera, originPosition } from './helpers/board';
import { NodeWsClient } from './helpers/node-ws-client';
import {
  Participant,
  createBoard,
  sameBoard,
  sharedServerUrl,
  type ObjectState,
} from './helpers/participants';
import { agentPort } from './helpers/wrangler-process';

/**
 * E2E multi-selection for story 7 (design "E2E workflows"):
 *
 *   TC-32: marquee — inside / half-inside / outside → only inside selected
 *   TC-33: 6 notes move 300 units together above a 4th note; corner resize
 *          scales sizes and gaps; notes stay square
 *   TC-34: arrow keys nudge the selection without page scroll or board pan;
 *          Delete removes everything
 *   TC-35: Sam deletes one of Lee's selected notes → Lee's count drops by 1
 *   TC-36: MAX_CONCURRENT_EDITORS contexts move different selections
 *          simultaneously → identical final positions everywhere
 *
 * Boards are seeded from Node through the real sync protocol (NodeWsClient);
 * every assertion reads the model through the test-only window.__vidi6 hook.
 *
 * Cameras (1280x800 viewport, the playwright default):
 *   - MAIN: {x:-1280, y:-800, zoom:0.5} → screen = world*0.5 + (640, 400)
 *   - TC-36: {x:-1280, y:-200, zoom:0.5} → screen = world*0.5 + (640, 100)
 */

const MAIN_CAM: Camera = { x: -1280, y: -800, zoom: 0.5 };
const TC36_CAM: Camera = { x: -1280, y: -200, zoom: 0.5 };

/** World → screen under MAIN_CAM. */
const s05 = (x: number, y: number): Point => ({ x: x * 0.5 + 640, y: y * 0.5 + 400 });
/** World → screen under TC36_CAM. */
const s36 = (x: number, y: number): Point => ({ x: x * 0.5 + 640, y: y * 0.5 + 100 });

const COLORS: StickyColor[] = ['yellow', 'green', 'blue', 'pink'];

/**
 * The 20-note fixture: two clusters of ten, each a 2x5 grid of note centres.
 * Cluster A occupies world x -100..1140, y -100..400; cluster B the same
 * shape shifted by (500, 600). Texts A0..A9 / B0..B9 identify the notes.
 */
function mainSpecs(): NoteSpec[] {
  const specs: NoteSpec[] = [];
  for (let i = 0; i < 10; i += 1) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    specs.push({ x: col * 260, y: row * 300, text: `A${i}`, color: COLORS[i % COLORS.length] });
  }
  for (let i = 0; i < 10; i += 1) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    specs.push({
      x: 500 + col * 260,
      y: 600 + row * 300,
      text: `B${i}`,
      color: COLORS[(i + 2) % COLORS.length],
    });
  }
  return specs;
}

/**
 * The TC-36 fixture: MAX_CONCURRENT_EDITORS rows of five notes; row k is one
 * context's selection. Row k: y = 300k, note centres x = col*260.
 */
function rowsSpecs(): NoteSpec[] {
  const specs: NoteSpec[] = [];
  for (let k = 0; k < MAX_CONCURRENT_EDITORS; k += 1) {
    for (let col = 0; col < 5; col += 1) {
      specs.push({
        x: col * 260,
        y: k * 300,
        text: `R${k}C${col}`,
        color: COLORS[(k + col) % COLORS.length],
      });
    }
  }
  return specs;
}

/** Creates the board, seeds it from Node and returns the id. */
async function seededBoard(specs: NoteSpec[]): Promise<string> {
  const boardId = await createBoard(sharedServerUrl());
  const seeder = await NodeWsClient.connect(agentPort(1), boardId);
  await seeder.waitForSync();
  seeder.seed(specs);
  await seeder.waitForNotes(specs.length);
  seeder.close();
  return boardId;
}

/** The model state of every object (test hook), including sizes. */
interface Obj {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
  width?: number;
  height?: number;
}

async function objects(page: Page): Promise<Obj[]> {
  return page.evaluate(() => (window.__vidi6?.getObjects() ?? []) as Obj[]);
}

async function byText(page: Page, text: string): Promise<Obj> {
  const all = await objects(page);
  const found = all.find((o) => o.text === text);
  if (found === undefined) {
    throw new Error(`no object with text ${text}; have: ${all.map((o) => o.text).join(',')}`);
  }
  return found;
}

/** The ids of currently selected objects (data-selected="true"). */
async function selectedIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-object-id][data-selected="true"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-object-id') ?? ''));
}

/** The selection bar's "N selected" text, or null when hidden. */
async function barText(page: Page): Promise<string | null> {
  const bar = page.getByTestId('selection-bar');
  if ((await bar.count()) === 0) {
    return null;
  }
  return (await bar.textContent()) ?? null;
}

/** Shift+drag a marquee from screen point `from` to `to` (both on empty space). */
async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** Drags a pointer that starts at screen point `from` by a screen-px delta. */
async function dragAt(page: Page, from: Point, delta: Point, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps });
  await page.mouse.up();
  await settle(page);
}

function closeTo(actual: number, expected: number, tolerance: number, what: string): void {
  expect(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} ± ${tolerance}, got ${actual}`,
  ).toBe(true);
}

test.describe('multi-select.e2e', () => {
  test('TC-32: marquee — A inside, B half inside, C outside → only A selected', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await seededBoard(mainSpecs());
    const ctx = await browser.newContext();
    const lee = await Participant.join(ctx, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);
      expect(await objects(lee.page)).toHaveLength(20);

      // Marquee world rect (-160,-160)..(320,160):
      //   A0 (0,0):    x -100..100  → fully inside
      //   A1 (260,0):  x  160..360  → half inside (160..320)
      //   A3 (780,0):  x  680..880  → outside
      await marquee(lee.page, s05(-160, -160), s05(320, 160));

      const a0 = await byText(lee.page, 'A0');
      const a1 = await byText(lee.page, 'A1');
      const a3 = await byText(lee.page, 'A3');
      const sel = await selectedIds(lee.page);
      expect(sel).toEqual([a0.id]);
      expect(a1.id).not.toBe(a0.id);
      expect(a3.id).not.toBe(a0.id);

      // One selection shows the NoteToolbar, not the multi-selection bar.
      expect(await barText(lee.page)).toBeNull();
      expect(await lee.page.getByTestId('note-toolbar').count()).toBe(1);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('TC-33: 6 notes move 300 units together above a 4th note; corner resize scales sizes and gaps; notes square', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await seededBoard(mainSpecs());
    const ctx = await browser.newContext();
    const lee = await Participant.join(ctx, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);

      // Marquee world rect (-160,-160)..(680,460) takes exactly the first
      // three notes of each cluster-A row: A0 A1 A2 A5 A6 A7. A3/A8 (x 680..880)
      // touch the right edge and are not fully inside.
      await marquee(lee.page, s05(-160, -160), s05(680, 460));
      const moved = ['A0', 'A1', 'A2', 'A5', 'A6', 'A7'];
      const sel = await selectedIds(lee.page);
      expect(sel).toHaveLength(6);
      for (const t of moved) {
        expect(sel).toContain((await byText(lee.page, t)).id);
      }
      expect(await barText(lee.page)).toContain('6 selected');

      // --- move: drag A1 (260,0) by 150 screen px = 300 world units in +x ---
      const a3 = await byText(lee.page, 'A3'); // (780,0): unselected "4th" note
      const a8 = await byText(lee.page, 'A8'); // (780,300): unselected
      const zBefore = { a3: a3.z, a8: a8.z };
      const start = s05(260, 0); // A1 centre
      await dragAt(lee.page, start, { x: 150, y: 0 });

      // Each of the six moved exactly +300 in x (world), y unchanged.
      // (Model x/y are the note's TOP-LEFT corner: centre - 100.)
      const expectedMove: Record<string, { x: number; y: number }> = {
        A0: { x: 200, y: -100 },
        A1: { x: 460, y: -100 },
        A2: { x: 720, y: -100 },
        A5: { x: 200, y: 200 },
        A6: { x: 460, y: 200 },
        A7: { x: 720, y: 200 },
      };
      for (const t of moved) {
        const o = await byText(lee.page, t);
        expect(o.x, `${t}.x after move`).toBe(expectedMove[t].x);
        expect(o.y, `${t}.y after move`).toBe(expectedMove[t].y);
      }
      // The moved group is z-above the unselected notes it now overlaps
      // (A2 over A3, A7 over A8); internal stacking order is preserved.
      for (const t of moved) {
        const o = await byText(lee.page, t);
        expect(o.z, `${t}.z above A3`).toBeGreaterThan(zBefore.a3);
        expect(o.z, `${t}.z above A8`).toBeGreaterThan(zBefore.a8);
      }
      // Internal stacking order of the moved group is preserved (A0..A2,A5..A7
      // were created in that order).
      const zMoved = await Promise.all(
        moved.map(async (t) => (await byText(lee.page, t)).z),
      );
      expect(zMoved).toEqual([...zMoved].sort((a, b) => a - b));

      // --- resize: drag the SE corner by (100,100) screen = (200,200) world ---
      // Bounding box is x 200..920 (720), y -100..400 (500). Aspect is locked
      // (sticky notes); |dx| >= |dy| so the width axis leads: scale =
      // 920/720 = 1.27778 and both axes scale by it.
      const se = lee.page.getByLabel('Resize bottom-right');
      expect(await lee.page.getByTestId('resize-handle').count()).toBe(8);
      const handle = (await se.boundingBox())!;
      await dragAt(lee.page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: 100, y: 100 });

      const SCALE = 920 / 720;
      for (const t of moved) {
        const o = await byText(lee.page, t);
        expect(o.width, `${t}.width`).toBeCloseTo(200 * SCALE, 3);
        expect(o.height, `${t}.height`).toBeCloseTo(200 * SCALE, 3);
        // Notes stay square: both axes agree (float noise < 1e-6).
        expect(
          Math.abs((o.width ?? 0) - (o.height ?? 0)),
          `${t} square`,
        ).toBeLessThan(1e-6);
      }
      // Gaps scale too: A0↔A1 distance was 260 → 260*SCALE = 332.22.
      const a0 = await byText(lee.page, 'A0');
      const a1 = await byText(lee.page, 'A1');
      closeTo(a1.x - a0.x, 260 * SCALE, 0.01, 'A0→A1 gap after resize');
      // A0 is pinned to the bounding box' top-left corner (200, -100).
      closeTo(a0.x, 200, 0.01, 'A0 x after resize (box top-left pinned)');
      closeTo(a0.y, -100, 0.01, 'A0 y after resize');

      // --- shrink: drag the SE corner far back; clamping stops every note
      // at STICKY_MIN_SIZE_WORLD (50×50), the box top-left stays pinned ---
      // Raw scale would be (920-800)/920 = 0.1304; the min-size clamp limits
      // it to 50 / (200*SCALE), so all six end exactly 50×50. The gaps scale
      // by the same ratio from their grown value: 260*SCALE*(50/200/SCALE) =
      // 260*50/200 = 65.
      const se2 = lee.page.getByLabel('Resize bottom-right');
      const handle2 = (await se2.boundingBox())!;
      await dragAt(lee.page, { x: handle2.x + handle2.width / 2, y: handle2.y + handle2.height / 2 }, { x: -400, y: -400 });
      for (const t of moved) {
        const o = await byText(lee.page, t);
        closeTo(o.width ?? 0, STICKY_MIN_SIZE_WORLD, 0.01, `${t}.width clamped`);
        closeTo(o.height ?? 0, STICKY_MIN_SIZE_WORLD, 0.01, `${t}.height clamped`);
      }
      const a0b = await byText(lee.page, 'A0');
      const a1b = await byText(lee.page, 'A1');
      closeTo(a0b.x, 200, 0.01, 'A0 x after shrink (pinned)');
      closeTo(a0b.y, -100, 0.01, 'A0 y after shrink');
      closeTo(a1b.x - a0b.x, (260 * STICKY_MIN_SIZE_WORLD) / 200, 0.01, 'A0→A1 gap after shrink');

      // Unselected notes never changed size or position.
      const b0 = await byText(lee.page, 'B0');
      expect(b0.x).toBe(400);
      expect(b0.width).toBe(200);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('TC-34: arrows nudge the selection without page scroll or board pan; Delete removes everything', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await seededBoard(mainSpecs());
    const ctx = await browser.newContext();
    const lee = await Participant.join(ctx, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);

      // Select all 20.
      await lee.page.keyboard.press('Control+a');
      expect(await barText(lee.page)).toContain('20 selected');
      expect(await selectedIds(lee.page)).toHaveLength(20);

      const originBefore = await originPosition(lee.page);
      const scrollBefore = await lee.page.evaluate(() => window.scrollY);
      const xBefore = new Map((await objects(lee.page)).map((o) => [o.text, o.x]));

      // ArrowRight ×3: every note +NUDGE_STEP_WORLD (1) in x.
      for (let i = 0; i < 3; i += 1) {
        await lee.page.keyboard.press('ArrowRight');
      }
      for (const [text, x0] of xBefore) {
        expect((await byText(lee.page, text)).x, `${text} after 3×ArrowRight`).toBe(x0 + 3);
      }

      // Shift+ArrowRight: +NUDGE_LARGE_STEP_WORLD (10) in x.
      await lee.page.keyboard.down('Shift');
      await lee.page.keyboard.press('ArrowRight');
      await lee.page.keyboard.up('Shift');
      for (const [text, x0] of xBefore) {
        expect((await byText(lee.page, text)).x, `${text} after Shift+ArrowRight`).toBe(x0 + 13);
      }

      // Neither the camera nor the page moved.
      const originAfter = await originPosition(lee.page);
      expect(originAfter.x).toBe(originBefore.x);
      expect(originAfter.y).toBe(originBefore.y);
      expect(await lee.page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      // Delete removes the whole selection.
      await lee.page.keyboard.press('Delete');
      await settle(lee.page);
      expect(await objects(lee.page)).toHaveLength(0);
      expect(await barText(lee.page)).toBeNull();
      expect(await lee.page.locator('[data-sticky-note]').count()).toBe(0);
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
    } finally {
      await ctx.close();
    }
  });

  test('TC-35: Sam deletes one of Lee\'s selected notes → Lee\'s count drops by 1', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await seededBoard(mainSpecs());
    const ctxL = await browser.newContext();
    const ctxS = await browser.newContext();
    const lee = await Participant.join(ctxL, boardId);
    const sam = await Participant.join(ctxS, boardId);
    try {
      await setCamera(lee.page, MAIN_CAM);
      await setCamera(sam.page, MAIN_CAM);

      // Lee marquee-selects the 2×2 cluster A0, A1, A5, A6 (world rect
      // -160..420 × -160..460 fully contains exactly those four).
      await marquee(lee.page, s05(-160, -160), s05(420, 460));
      expect(await barText(lee.page)).toContain('4 selected');
      const leeSel = new Set<string>(await selectedIds(lee.page));
      expect(leeSel.size).toBe(4);

      // Sam deletes A1 — one of Lee's selected notes — through the normal UI.
      const a1 = await byText(sam.page, 'A1');
      await sam.select(a1.id);
      await sam.deleteNote(a1.id);

      // Lee: the note disappears and the bar drops to 3 selected (useSelection
      // pruned the id from the snapshot); the remaining three stay selected.
      await lee.waitFor((o) => o.length === 19, 'A1 to be deleted for Lee');
      expect(await barText(lee.page)).toContain('3 selected');
      const leeAfter = await selectedIds(lee.page);
      expect(leeAfter).toHaveLength(3);
      for (const id of leeAfter) {
        expect(leeSel.has(id)).toBe(true);
      }
      expect(leeAfter).not.toContain(a1.id);

      // Lee presses Delete: exactly his remaining three go.
      await lee.page.keyboard.press('Delete');
      await lee.waitFor((o) => o.length === 16, "Lee's three to be deleted");
      expect(await selectedIds(lee.page)).toHaveLength(0);

      // Sam sees every deletion on his board too.
      await sam.waitFor((o) => o.length === 16, 'all deletions to reach Sam');
      expect(lee.hasErrors(), lee.errorDetails()).toBe(false);
      expect(sam.hasErrors(), sam.errorDetails()).toBe(false);
    } finally {
      await ctxL.close();
      await ctxS.close();
    }
  });

  test(`TC-36: ${MAX_CONCURRENT_EDITORS} contexts move different selections simultaneously → identical final positions`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    const boardId = await seededBoard(rowsSpecs());
    const contexts: BrowserContext[] = [];
    const players: Participant[] = [];
    for (let k = 0; k < MAX_CONCURRENT_EDITORS; k += 1) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      players.push(await Participant.join(ctx, boardId));
    }
    try {
      await Promise.all(players.map((p) => setCamera(p.page, TC36_CAM)));
      for (const p of players) {
        expect(await objects(p.page)).toHaveLength(MAX_CONCURRENT_EDITORS * 5);
      }

      // Each context marquee-selects its own row of five (row spans world
      // x -100..1140; the rect must fully contain it).
      await Promise.all(
        players.map((p, k) =>
          marquee(p.page, s36(-160, k * 300 - 160), s36(1200, k * 300 + 160)),
        ),
      );
      for (let k = 0; k < MAX_CONCURRENT_EDITORS; k += 1) {
        const sel = await selectedIds(players[k].page);
        expect(sel, `player ${k} selected`).toHaveLength(5);
        expect(await barText(players[k].page)).toContain('5 selected');
      }

      // All contexts drag their row 150 screen px = 300 world units in +x,
      // at the same time.
      await Promise.all(
        players.map((p, k) => dragAt(p.page, s36(0, k * 300), { x: 150, y: 0 })),
      );

      // Every context converges on the same final board. (Model x/y are the
      // note's top-left corner: centre - 100.)
      const final = players.map(async (p) => {
        await p.waitFor(
          (o) =>
            o.length === MAX_CONCURRENT_EDITORS * 5 &&
            o.every((n) => {
              const m = /^R(\d)C(\d)$/.exec(n.text);
              if (m === null) {
                return false;
              }
              const row = Number(m[1]);
              const col = Number(m[2]);
              return n.x === col * 260 + 200 && n.y === row * 300 - 100;
            }),
          'final positions for player',
        );
        return o2states(await objects(p.page));
      });
      const boards = await Promise.all(final);
      for (let i = 1; i < boards.length; i += 1) {
        expect(sameBoard(boards[0], boards[i]), `board ${i} matches board 0`).toBe(true);
      }
      for (const p of players) {
        expect(p.hasErrors(), p.errorDetails()).toBe(false);
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});

/** Projects the richer Obj[] onto participants' ObjectState for sameBoard. */
function o2states(objs: Obj[]): ObjectState[] {
  return objs.map((o) => ({
    id: o.id,
    x: o.x,
    y: o.y,
    z: o.z,
    color: o.color,
    text: o.text,
  }));
}
