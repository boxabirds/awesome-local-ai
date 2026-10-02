import { test, expect, type Page, type Browser } from '@playwright/test';
import { createBoard, openBoardInPage } from './helpers/board';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * TC-33 (sel.transform): reorganise a cluster — move 6 notes together,
 * corner-resize the group (proportional, square), shrink to the minimum.
 * TC-34 (sel.keyboard): nudge + Delete.
 * TC-36 (sel.transform): full-capacity reorganisation — 5 contexts move
 * different selections at the same time, all converge to identical state.
 *
 * Chromium only (pixel-accurate drag + convergence timing).
 */
// The cluster after the move+resize steps spans x 400..1500, y 100..787.5,
// so this spec needs a viewport that contains it (the project default is
// Desktop Chrome's 1280×720). Contexts are created manually below, so the
// viewport is passed explicitly.
const VIEWPORT = { width: 1600, height: 900 };

test.skip(({ browserName }) => browserName !== 'chromium', 'story 7 e2e runs in chromium');

type NoteRect = { x: number; y: number; w: number; h: number; z: number };

/** Thrown (internally) when a pointer drag is cancelled → retry on a fresh board. */
const RETRY = Symbol('retry');

async function armCancelCounter(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    if (!w.__cancelArm) {
      w.__cancelArm = true;
      w.__cancelCount = 0;
      document.addEventListener(
        'pointercancel',
        () => {
          w.__cancelCount += 1;
        },
        true,
      );
    }
    w.__cancelCount = 0;
  });
}

/** Reset the counter so only cancels during the upcoming drag are counted. */
async function resetCancelCounter(page: Page) {
  await page.evaluate(() => {
    (window as any).__cancelCount = 0;
  });
}

/** Abort the current attempt if a pointercancel was seen since the last reset. */
async function ensureNotCancelled(page: Page) {
  const n = await page.evaluate(() => (window as any).__cancelCount);
  if (n > 0) throw RETRY;
}

async function createNotes(page: Page, positions: { x: number; y: number }[]): Promise<string[]> {
  return page.evaluate((positions) => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const Y = (window as any).__VIDI_Y__;
    const doc = hook.doc;
    const objects = doc.getMap('objects');
    let maxZ = 0;
    objects.forEach((m: any) => {
      const z = m.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    });
    const ids: string[] = [];
    for (const p of positions) {
      const id = `n${Math.random().toString(36).slice(2, 10)}`;
      maxZ += 1;
      const m = new Y.Map();
      m.set('id', id);
      m.set('type', 'sticky');
      m.set('x', p.x);
      m.set('y', p.y);
      m.set('color', 'yellow');
      m.set('z', maxZ);
      m.set('createdAt', Date.now());
      m.set('text', new Y.Text());
      objects.set(id, m);
      ids.push(id);
    }
    return ids;
  }, positions);
}

async function getNoteRects(page: Page): Promise<Record<string, NoteRect>> {
  return page.evaluate(() => {
    const doc = (window as any).__VIDI_DEBUG__.doc;
    const objects = doc.getMap('objects');
    const out: Record<string, NoteRect> = {};
    objects.forEach((m: any) => {
      if (m.get('type') !== 'sticky') return;
      const w = m.get('width');
      const h = m.get('height');
      out[m.get('id')] = {
        x: m.get('x'),
        y: m.get('y'),
        w: typeof w === 'number' ? w : 200,
        h: typeof h === 'number' ? h : 200,
        z: m.get('z'),
      };
    });
    return out;
  });
}

/**
 * Establish a multi-selection programmatically (test seam) instead of with a
 * marquee drag. A prior drag leaves headless Chromium in a state that
 * spuriously cancels the next pointer drag; selecting without a drag keeps the
 * transform drag that follows as the page's first (clean) drag.
 */
async function selectIds(page: Page, ids: string[]) {
  await page.evaluate((list) => (window as any).__VIDI_DEBUG__.select(list), ids);
  // Wait for the React re-render so the selection is actually applied.
  await page.waitForFunction(
    (n) => (window as any).__VIDI_DEBUG__.getSelection().length === n,
    ids.length,
    { timeout: 5000 },
  );
}

/**
 * Reset the headless-Chromium pointer state left behind by a previous drag,
 * then (re)establish the selection programmatically. A click (down+up, no
 * moves) resets the state without priming it; the programmatic select adds no
 * drag. The transform drag that follows is therefore the first real drag since
 * the reset and is not spuriously cancelled. Used between consecutive drags.
 */
async function resetAndSelect(page: Page, ids: string[]) {
  await page.mouse.move(50, 850);
  await page.mouse.down();
  await page.mouse.up();
  await selectIds(page, ids);
}

/** Drag from the current screen position of a testid element by (dx, dy). */
async function dragFromTestid(page: Page, testid: string, dx: number, dy: number) {
  const box = await page.getByTestId(testid).boundingBox();
  if (!box) throw new Error(`element ${testid} not found`);
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await resetCancelCounter(page);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
  }
  await page.mouse.up();
  await ensureNotCancelled(page);
}

/** Drag the SE corner of the given notes' bounding box by (dx, dy). */
async function dragSECorner(page: Page, ids: string[], dx: number, dy: number) {
  const rects = await getNoteRects(page);
  const all = ids.map((id) => rects[id]);
  const maxX = Math.max(...all.map((r) => r.x + r.w));
  const maxY = Math.max(...all.map((r) => r.y + r.h));
  await resetCancelCounter(page);
  await page.mouse.move(maxX, maxY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(maxX + (dx * i) / 10, maxY + (dy * i) / 10);
  }
  await page.mouse.up();
  await ensureNotCancelled(page);
}

/**
 * Run a board scenario with fresh-board retries. Headless Chromium sometimes
 * fires a spurious `pointercancel` on a pointer drag that follows a previous
 * drag on the same page. A fresh board (fresh page) is always clean, so we
 * retry the whole scenario on a new board whenever a cancel is detected.
 */
async function withFreshBoardRetries(
  browser: Browser,
  maxAttempts: number,
  scenario: (boardId: string, page: Page) => Promise<void>,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const boardId = await createBoard();
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    try {
      await openBoardInPage(page, boardId);
      await armCancelCounter(page);
      await scenario(boardId, page);
      return;
    } catch (e) {
      if (e === RETRY) continue; // cancelled → fresh board
      throw e;
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  throw new Error('scenario kept being cancelled by the browser');
}

const CLUSTER_POSITIONS = [
  { x: 100, y: 100 },
  { x: 400, y: 100 },
  { x: 700, y: 100 },
  { x: 100, y: 400 },
  { x: 400, y: 400 },
  { x: 700, y: 400 },
];

test.describe('TC-33: reorganise a cluster', () => {
  test('move 6 notes 300 units; corner resize scales sizes and gaps; notes stay square; shrink stops at the minimum', async ({ browser }) => {
    // Three consecutive transform drags (move → resize → shrink); each pair
    // risks a spurious pointercancel, so retry on a fresh board if cancelled.
    await withFreshBoardRetries(browser, 8, async (_boardId, page) => {
      const ids = await createNotes(page, CLUSTER_POSITIONS);
      // The "4th" note: outside the selection marquee, overlapping where the
      // cluster lands after the +300 move.
      const extra = (await createNotes(page, [{ x: 1100, y: 450 }]))[0];

      // --- Move: select the 3×2 cluster, then drag one note +300 in x; all
      // six follow.
      await resetAndSelect(page, ids);
      await dragFromTestid(page, `sticky-note-${ids[0]}`, 300, 0);

      let rects = await getNoteRects(page);
      const expectedX = [400, 700, 1000, 400, 700, 1000];
      const expectedY = [100, 100, 100, 400, 400, 400];
      ids.forEach((id, i) => {
        expect(rects[id].x).toBeCloseTo(expectedX[i], 3);
        expect(rects[id].y).toBeCloseTo(expectedY[i], 3);
      });
      // The dragged cluster now renders above the 4th note.
      ids.forEach((id) => {
        expect(rects[id].z, `z of ${id} above the 4th note`).toBeGreaterThan(rects[extra].z);
      });

      // --- Resize: drag the SE handle of the 400..1200 × 100..600 box by
      // (300, 150): sx = 1100/800 = 1.375 (dominant), sy = 650/500 = 1.3.
      // Reset + re-select first (this drag follows the move drag).
      await resetAndSelect(page, ids);
      await dragSECorner(page, ids, 300, 150);

      rects = await getNoteRects(page);
      // Every note scales by 1.375 and stays square.
      ids.forEach((id) => {
        expect(rects[id].w).toBeCloseTo(275, 1);
        expect(rects[id].h).toBeCloseTo(275, 1);
      });
      // Positions and gaps scale: offsets from the anchor (400, 100) × 1.375.
      const expectedRx = [400, 812.5, 1225, 400, 812.5, 1225];
      const expectedRy = [100, 100, 100, 512.5, 512.5, 512.5];
      ids.forEach((id, i) => {
        expect(rects[id].x).toBeCloseTo(expectedRx[i], 1);
        expect(rects[id].y).toBeCloseTo(expectedRy[i], 1);
      });

      // --- Shrink below the minimum: drag the SE corner far inside; the
      // group stops at STICKY_MIN_SIZE_WORLD. Reset + re-select first (this
      // drag follows the resize drag).
      await resetAndSelect(page, ids);
      await dragSECorner(page, ids, -1050, -637.5);

      rects = await getNoteRects(page);
      ids.forEach((id) => {
        expect(rects[id].w, `width of ${id} clamped`).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
        expect(rects[id].h, `height of ${id} clamped`).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
      });
    });
  });
});

test.describe('TC-34: keyboard nudge and delete', () => {
  test('ArrowRight ×3 + Shift+ArrowRight moves the selection; camera unchanged; Delete removes all 6', async ({ browser }) => {
    await withFreshBoardRetries(browser, 5, async (_boardId, page) => {
      const ids = await createNotes(page, CLUSTER_POSITIONS);
      const extra = (await createNotes(page, [{ x: 1100, y: 450 }]))[0];

      await selectIds(page, ids);

      const camBefore = await page.evaluate(() => (window as any).__vidi6.getCamera());

      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.keyboard.press('Shift+ArrowRight');
      const rects = await getNoteRects(page);
      // The cluster is 3 columns × 2 rows at x 100/400/700; the nudge moves
      // every selected note by the same delta.
      const nudgeDelta = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
      const expectedX = [100, 400, 700, 100, 400, 700].map((x) => x + nudgeDelta);
      ids.forEach((id, i) => {
        expect(rects[id].x).toBeCloseTo(expectedX[i], 3);
      });
      // The 4th note is untouched.
      expect(rects[extra].x).toBe(1100);

      const camAfter = await page.evaluate(() => (window as any).__vidi6.getCamera());
      expect(camAfter).toEqual(camBefore);
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBe(0);

      await page.keyboard.press('Delete');
      const after = await getNoteRects(page);
      expect(Object.keys(after)).toHaveLength(1);
      expect(after[extra]).toBeDefined();
    });
  });
});

test.describe('TC-36: full-capacity reorganisation', () => {
  test(`${MAX_CONCURRENT_EDITORS} contexts move different selections at the same time → identical final positions`, async ({ browser }) => {
    await withFreshBoardRetries(browser, 5, async (boardId, firstPage) => {
      // Seed 5 notes (one per context) in the first context.
      const ids = await createNotes(firstPage, [
        { x: 40, y: 100 },
        { x: 290, y: 100 },
        { x: 540, y: 100 },
        { x: 790, y: 100 },
        { x: 1040, y: 100 },
      ]);

      // Open the other 4 contexts on the same board.
      const pages: Page[] = [firstPage];
      const extraContexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        const ctx = await browser.newContext({ viewport: VIEWPORT });
        extraContexts.push(ctx);
        const page = await ctx.newPage();
        await openBoardInPage(page, boardId);
        await armCancelCounter(page);
        pages.push(page);
      }

      // Let every context see the notes.
      await pages[1].waitForFunction(
        () => (window as any).__VIDI_DEBUG__.doc.getMap('objects').size === 5,
        undefined,
        { timeout: 10_000 },
      );

      // Each context selects its own note and drags it by a unique delta —
      // all at (roughly) the same time. The drag is each page's first pointer
      // drag (selection is set programmatically), so no spurious cancel.
      const deltas = ids.map((_, i) => ({ dx: 50 + i * 20, dy: 30 + i * 10 }));
      await Promise.all(
        pages.map(async (page, i) => {
          await selectIds(page, [ids[i]]);
          await dragFromTestid(page, `sticky-note-${ids[i]}`, deltas[i].dx, deltas[i].dy);
        }),
      );

      // All contexts converge to the expected final positions (absolute
      // writes): poll until every context shows the target state.
      const expectedX = ids.map((_, i) => 40 + 250 * i + deltas[i].dx);
      const expectedY = ids.map((_, i) => 100 + deltas[i].dy);
      await expect
        .poll(
          async () => {
            const final = await getNoteRects(pages[0]);
            return ids.every((id, i) => {
              const r = final[id];
              return (
                Math.abs(r.x - expectedX[i]) < 0.5 && Math.abs(r.y - expectedY[i]) < 0.5
              );
            });
          },
          { timeout: 15_000 },
        )
        .toBe(true);

      // Every context sees the identical final state.
      const snapshots = await Promise.all(pages.map((p) => getNoteRects(p)));
      const reference = JSON.stringify(snapshots[0]);
      snapshots.forEach((s, i) => {
        expect(JSON.stringify(s), `context ${i} matches`).toBe(reference);
      });

      for (const ctx of extraContexts) {
        await ctx.close().catch(() => {});
      }
    });
  });
});
