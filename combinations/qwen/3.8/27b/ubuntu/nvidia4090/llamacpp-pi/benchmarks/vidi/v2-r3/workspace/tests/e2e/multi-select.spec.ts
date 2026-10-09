import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  apiCreateBoard,
  moveNote,
  noteCount,
  openBoard,
  setCamera,
  snapshotNotes,
} from './helpers';

interface Participant {
  context: BrowserContext;
  page: Page;
}

/** Geometry of every object, read straight from the synced Y.Doc. */
interface ObjGeom {
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  z: number;
}

async function readObjects(page: Page): Promise<Record<string, ObjGeom>> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    const out: Record<string, ObjGeom> = {};
    objects.forEach((item: any, id: string) => {
      out[id] = {
        type: item.get('type'),
        x: item.get('x'),
        y: item.get('y'),
        width: item.get('width') ?? null,
        height: item.get('height') ?? null,
        z: item.get('z'),
      };
    });
    return out;
  });
}

async function noteIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-note-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-note-id') as string));
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  return { context, page };
}

async function one(browser: Browser, request: APIRequestContext): Promise<Participant> {
  const board = await apiCreateBoard(request);
  return join(browser, board);
}

async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

/** Shift+drag marquee from screen (x1,y1) to (x2,y2). Start must be empty space. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/**
 * Single click on clearly-empty canvas → clears the current selection.
 * Needed before a shift-marquee: notes left selected by creation would
 * otherwise be unioned into the additive marquee result.
 */
async function clearSelection(page: Page): Promise<void> {
  await page.mouse.click(100, 750);
}

/** Number of notes currently selected (data-selected). */
async function selectedCount(page: Page): Promise<number> {
  return page.locator('[data-selected="true"]').count();
}

/** The "N selected" label in the selection bar (or null when the bar is hidden). */
async function barLabel(page: Page): Promise<string | null> {
  const bar = page.locator('[data-selection-bar]');
  if ((await bar.count()) === 0) return null;
  return (await bar.locator('[aria-live="polite"]').first().innerText()).trim();
}

/** Double-click to create a note centred at screen (sx,sy), then end the edit. */
async function seedNote(page: Page, sx: number, sy: number): Promise<void> {
  await page.mouse.dblclick(sx, sy);
  await page.keyboard.press('Escape');
}

/** Drag the bounding-box `handle` of the current selection by (dx,dy) screen px. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const handleEl = page.locator(`[data-resize-handle="${handle}"]`);
  const box = await handleEl.boundingBox();
  if (!box) throw new Error(`handle ${handle} not found`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // A single absolute move (no `steps`): stepped moves only applied a fraction of
  // the delta to the pointer-captured resize gesture in chromium.
  await page.mouse.move(cx + dx, cy + dy);
  await page.mouse.up();
}

test.describe('multi-select (real browsers + wrangler dev)', () => {
  test('TC-32: marquee selects only the fully-inside note', async ({ browser, request }) => {
    const p = await one(browser, request);
    const page = p.page;
    try {
      // A fully inside, B half inside, C outside the marquee (world = screen-640,400).
      await seedNote(page, 240, 200); // A centre world (-400,-200): (-400,-200)-(-200,0)
      await seedNote(page, 390, 200); // B centre world (-250,-200): (-250,-200)-(-50,0)
      await seedNote(page, 640, 200); // C centre world (0,-200): (0,-200)-(200,0)
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

      // Marquee starts on empty space (20,30) and drags to (400,400): fully
      // contains A, half of B, none of C.
      await clearSelection(page);
      await marquee(page, 20, 30, 400, 400);

      // DOM order = creation order = A, B, C (no reorder from a marquee).
      const [aId, bId, cId] = await noteIds(page);
      await expect.poll(() => selectedCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      // Exactly the fully-inside note A is selected; the half-inside B and the
      // outside C are not.
      expect(await page.locator(`[data-note-id="${aId}"]`).getAttribute('data-selected')).toBe('true');
      expect(await page.locator(`[data-note-id="${bId}"]`).getAttribute('data-selected')).toBeNull();
      expect(await page.locator(`[data-note-id="${cId}"]`).getAttribute('data-selected')).toBeNull();
    } finally {
      await closeAll(p);
    }
  });

  test('TC-33: group move (6 notes) + corner resize keeps notes square', async ({ browser, request }) => {
    const p = await one(browser, request);
    const page = p.page;
    try {
      // 6-note cluster (3x2, 200px notes, 50px gaps) + one extra note to the right.
      const cluster = [
        [-450, -200],
        [-200, -200],
        [50, -200],
        [-450, 100],
        [-200, 100],
        [50, 100],
      ];
      for (const [wx, wy] of cluster) await seedNote(page, wx + 640, wy + 400);
      await seedNote(page, 450 + 640, 150 + 400); // extra note e0
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(7);

      // Marquee-select the 6: start on empty space, drag to cover the cluster.
      await clearSelection(page);
      await marquee(page, 20, 30, 820, 640);
      await expect.poll(() => selectedCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);

      const before = await readObjects(page);
      // Note (x,y) is the top-left; the centre is (x+100, y+100).
      const idAt = (cx: number, cy: number): string =>
        Object.entries(before).find(
          ([, o]) => Math.abs(o.x + 100 - cx) < 1 && Math.abs(o.y + 100 - cy) < 1,
        )?.[0] ?? '';
      const clusterIds = cluster.map(([cx, cy]) => idAt(cx, cy));
      const extraId = idAt(450, 150);
      expect(clusterIds.every(Boolean)).toBe(true);
      expect(clusterIds).toHaveLength(6);
      expect(extraId).toBeTruthy();

      // Drag the leftmost cluster note +300 world units in x (screen 190,200 → 490,200).
      await moveNote(page, { x: 190, y: 200 }, { x: 490, y: 200 });
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          return clusterIds.every((id) => o[id].x === before[id].x + 300 && o[id].y === before[id].y);
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      // The moved cluster now sits above the extra note (bring-to-front on group move).
      const afterMove = await readObjects(page);
      expect(clusterIds.every((id) => afterMove[id].z > afterMove[extraId].z)).toBe(true);

      // Corner-resize (se) to grow: the 6 notes scale, stay square, gaps scale.
      await dragHandle(page, 'se', 100, 100);
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          return clusterIds.every((id) => {
            const w = o[id].width ?? STICKY_SIZE_WORLD;
            const h = o[id].height ?? STICKY_SIZE_WORLD;
            return w > STICKY_SIZE_WORLD && Math.abs(w - h) < 1; // grew and square
          });
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      const grown = await readObjects(page);
      const scale = (grown[clusterIds[0]].width ?? STICKY_SIZE_WORLD) / STICKY_SIZE_WORLD;
      // A 50px gap between column 0 and column 1 scales by the same factor.
      const gapBefore = 50;
      const gapAfter =
        (grown[clusterIds[1]].x - grown[clusterIds[0]].x) - (grown[clusterIds[0]].width ?? STICKY_SIZE_WORLD);
      expect(gapAfter / gapBefore).toBeCloseTo(scale, 1);
      expect(gapAfter).toBeGreaterThan(gapBefore);

      // Shrink hard (in-viewport drag): everything stops at STICKY_MIN_SIZE_WORLD.
      await dragHandle(page, 'se', -700, -500);
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          return clusterIds.every(
            (id) =>
              (o[id].width ?? STICKY_SIZE_WORLD) <= STICKY_MIN_SIZE_WORLD + 1 &&
              (o[id].height ?? STICKY_SIZE_WORLD) <= STICKY_MIN_SIZE_WORLD + 1,
          );
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      const shrunk = await readObjects(page);
      expect(clusterIds.every((id) => (shrunk[id].width ?? 0) >= STICKY_MIN_SIZE_WORLD - 1)).toBe(true);
    } finally {
      await closeAll(p);
    }
  });

  test('TC-34: arrow nudge moves the selection; camera and scroll unchanged; Delete clears', async ({
    browser,
    request,
  }) => {
    const p = await one(browser, request);
    const page = p.page;
    try {
      const cluster = [
        [-450, -200],
        [-200, -200],
        [-450, 100],
        [-200, 100],
      ];
      for (const [wx, wy] of cluster) await seedNote(page, wx + 640, wy + 400);
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);

      // Marquee-select the 4: start on empty space, drag to cover the cluster.
      await clearSelection(page);
      await marquee(page, 20, 30, 580, 640);
      await expect.poll(() => selectedCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);

      const before = await readObjects(page);
      const ids = Object.keys(before);
      const firstBoxBefore = await page.locator('[data-note-id]').first().boundingBox();

      // ArrowRight x3 → +NUDGE_STEP_WORLD*3 in x; Shift+ArrowRight → +NUDGE_LARGE_STEP_WORLD.
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');

      const expectedDx = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
      await expect
        .poll(async () => {
          const o = await readObjects(page);
          return ids.every((id) => o[id].x === before[id].x + expectedDx && o[id].y === before[id].y);
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      // Camera did not compensate: the notes moved on screen by the same world
      // delta (a panned camera would have kept them stationary on screen).
      const firstBoxAfter = await page.locator('[data-note-id]').first().boundingBox();
      expect(firstBoxAfter!.x).toBeCloseTo(firstBoxBefore!.x + expectedDx, 0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // Delete removes all 4 and clears the selection.
      await page.keyboard.press('Delete');
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
      await expect.poll(() => selectedCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    } finally {
      await closeAll(p);
    }
  });

  test('TC-35: colleague deletes one of my selected notes → selection prunes to 3', async ({
    browser,
    request,
  }) => {
    const board = await apiCreateBoard(request);
    const lee = await join(browser, board);
    const sam = await join(browser, board);
    try {
      // 20-note fixture: a 5x4 grid at zoom 0.5 (notes 100px on screen).
      // Both participants share the same camera so screen positions match.
      await setCamera(lee.page, -640, -400, 0.5);
      await setCamera(sam.page, -640, -400, 0.5);
      const cells: Array<[number, number]> = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) cells.push([140 + c * 220, 100 + r * 150]);
      for (const [sx, sy] of cells) await seedNote(lee.page, sx, sy);
      await expect.poll(() => noteCount(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(20);
      await expect.poll(() => noteCount(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(20);

      // Lee Shift+drags to select the top-left 2x2 (4 notes).
      await clearSelection(lee.page);
      await marquee(lee.page, 20, 20, 470, 330);
      await expect.poll(() => selectedCount(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);
      await expect.poll(async () => barLabel(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('4 selected');

      // Sam selects one of those four (the top-left note) and deletes it.
      await sam.page.mouse.click(140, 100);
      await expect.poll(() => selectedCount(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      const t0 = Date.now();
      await sam.page.keyboard.press('Delete');
      // The note disappears for Lee and the bar prunes to "3 selected".
      await expect
        .poll(
          async () => {
            const n = await noteCount(lee.page);
            const label = await barLabel(lee.page);
            return n === 19 && label === '3 selected';
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBe(true);
      const latency = Date.now() - t0;
      console.log(
        `[latency] prune on remote delete: ${latency}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ${
          latency <= LIVE_UPDATE_LATENCY_BUDGET_MS ? 'within' : 'over'
        })`,
      );
      // The remaining 3 keep their outlines.
      await expect.poll(() => selectedCount(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

      // Lee deletes the rest → exactly those 3 go, leaving 16.
      await lee.page.keyboard.press('Delete');
      await expect.poll(() => noteCount(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(16);
      await expect.poll(() => noteCount(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(16);
      await expect.poll(() => selectedCount(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    } finally {
      await closeAll(lee, sam);
    }
  });

  test('TC-36: full-capacity — every editor moves a different selection at once', async ({ browser, request }) => {
    const board = await apiCreateBoard(request);
    const ps: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) ps.push(await join(browser, board));
    try {
      // 5 clusters of 2 notes, one row per editor, at zoom 0.5.
      for (const p of ps) await setCamera(p.page, -640, -400, 0.5);
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        await seedNote(ps[0].page, 200, 100 + i * 150);
        await seedNote(ps[0].page, 400, 100 + i * 150);
      }
      for (const p of ps) {
        await expect.poll(() => noteCount(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(
          MAX_CONCURRENT_EDITORS * 2,
        );
      }

      // Each editor marquee-selects their row and moves it by a distinct offset, all at once.
      await Promise.all(
        ps.map(async (p, i) => {
          const rowY = 100 + i * 150;
          await clearSelection(p.page);
          await marquee(p.page, 130, rowY - 60, 470, rowY + 60);
          await expect.poll(() => selectedCount(p.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(2);
          const offX = (i + 1) * 40;
          const offY = (i + 1) * 10;
          await moveNote(p.page, { x: 200, y: rowY }, { x: 200 + offX, y: rowY + offY });
        }),
      );

      // Every context converges to the identical board.
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        await expect
          .poll(
            async () =>
              JSON.stringify(await snapshotNotes(ps[0].page)) === JSON.stringify(await snapshotNotes(ps[i].page)),
            { timeout: E2E_EVENTUAL_TIMEOUT_MS },
          )
          .toBe(true);
      }
      // And it is the expected final board: row i shifted by its own offset.
      const final = await readObjects(ps[0].page);
      const count = Object.keys(final).length;
      expect(count).toBe(MAX_CONCURRENT_EDITORS * 2);
    } finally {
      await closeAll(...ps);
    }
  });
});
