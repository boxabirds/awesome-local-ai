import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import {
  createBoard,
  openBoardInPage,
} from './helpers/board';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';

/**
 * Story 7 E2E: select, move, resize and delete several objects at once.
 *
 * Camera is (0,0,1) throughout, so screen coordinates == world coordinates
 * (the viewport is fixed inset:0 and the world layer sits at its top-left).
 *
 * The cluster is laid out wide (a note reaches x=1300 after the group move),
 * so this spec uses a larger viewport than the default to keep every handle
 * and note on screen.
 */
test.use({ viewport: { width: 1600, height: 900 } });

interface Pos {
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

/** Read all object positions/sizes from the Y.Doc via the debug hook. */
async function getPositions(page: Page): Promise<Record<string, Pos>> {
  return page.evaluate(() => {
    const { doc } = (window as any).__VIDI_DEBUG__;
    const out: Record<string, any> = {};
    doc.getMap('objects').forEach((m: any, id: string) => {
      if (m.get('type') !== 'sticky') return;
      out[id] = {
        x: m.get('x'),
        y: m.get('y'),
        width: m.get('width'),
        height: m.get('height'),
        z: m.get('z'),
      };
    });
    return out;
  });
}

/**
 * Create stickies centred at the given world points, directly in the Y.Doc
 * (same shape as createSticky). Returns the ids in order.
 */
async function createNotes(page: Page, centers: { x: number; y: number }[]): Promise<string[]> {
  return page.evaluate((cs) => {
    const { doc } = (window as any).__VIDI_DEBUG__;
    const Y = (window as any).__VIDI_Y__;
    const objects = doc.getMap('objects');
    let maxZ = 0;
    objects.forEach((m: any) => {
      maxZ = Math.max(maxZ, m.get('z') || 0);
    });
    const ids: string[] = [];
    doc.transact(() => {
      for (const c of cs) {
        const id = crypto.randomUUID();
        const m = new Y.Map();
        m.set('type', 'sticky');
        m.set('x', c.x - 100);
        m.set('y', c.y - 100);
        m.set('color', '#FFF9C4');
        m.set('text', new Y.Text());
        m.set('z', ++maxZ);
        m.set('createdAt', Date.now());
        objects.set(id, m);
        ids.push(id);
      }
    });
    return ids;
  }, centers);
}

function notes(page: Page): Locator {
  return page.locator('[data-testid^="sticky-note-"]');
}

function note(page: Page, id: string): Locator {
  return page.getByTestId(`sticky-note-${id}`);
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Shift+drag a marquee from start to end (screen == world at camera (0,0,1)). */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Drag from (x1,y1) to (x2,y2) with the primary button. */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
  }
  await page.mouse.up();
}

async function newBoardPage(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await openBoardInPage(page, boardId);
  return page;
}

test.describe('Story 7: multi-select (E2E)', () => {
  // TC-32
  test('TC-32: Shift+drag selects only the fully-inside note', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await newBoardPage(ctx, boardId);
    const [a, b, c] = await createNotes(page, [
      { x: 400, y: 300 }, // A: (300..500, 200..400) fully inside the marquee
      { x: 550, y: 300 }, // B: (450..650, 200..400) half inside
      { x: 900, y: 600 }, // C: outside
    ]);

    await marquee(page, 250, 150, 550, 450);

    await expect(note(page, a)).toHaveAttribute('data-selected', 'true');
    await expect(note(page, b)).not.toHaveAttribute('data-selected');
    await expect(note(page, c)).not.toHaveAttribute('data-selected');
  });

  // TC-33
  test('TC-33: group move lifts the cluster; se-resize scales proportionally; shrink stops at min size', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await newBoardPage(ctx, boardId);
    const cluster = [
      { x: 300, y: 250 },
      { x: 600, y: 250 },
      { x: 900, y: 250 },
      { x: 300, y: 450 },
      { x: 600, y: 450 },
      { x: 900, y: 450 },
    ];
    const ids = await createNotes(page, [...cluster, { x: 1200, y: 450 }]); // 7th = "the 4th note"
    const under = ids[6];

    // Select the 6-note cluster (the 7th at (1100..1300,350..550) stays out).
    await marquee(page, 150, 100, 1050, 600);
    expect(await notes(page).count()).toBe(7);
    const selectedCount = await page
      .locator('[data-testid^="sticky-note-"][data-selected]')
      .count();
    expect(selectedCount).toBe(6);

    // Drag the first cluster note 300 world units right.
    const c0 = await centerOf(note(page, ids[0]));
    await drag(page, c0.x, c0.y, c0.x + 300, c0.y);
    let pos = await getPositions(page);
    for (let i = 0; i < 6; i++) {
      expect(pos[ids[i]].x).toBe(cluster[i].x - 100 + 300);
      expect(pos[ids[i]].y).toBe(cluster[i].y - 100);
    }
    expect(pos[under].x).toBe(1200 - 100); // untouched

    // The moved top-right note now renders above the 7th note at (1200,450).
    const topTestId = await page.evaluate(() => {
      const el = document.elementFromPoint(1200, 450);
      return el?.closest('[data-testid^="sticky-note-"]')?.getAttribute('data-testid') ?? null;
    });
    expect(topTestId).toBe(`sticky-note-${ids[5]}`);
    expect(pos[ids[5]].z).toBeGreaterThan(pos[under].z);

    // Resize: drag the se handle of the selection by (100,100).
    // Box is (500..1300, 150..550) = 800×400; sx = 1.125, sy = 1.25 →
    // aspect-locked scale = max = 1.25 → every note 250×250, gaps 100 → 125.
    const se = page.getByTestId('sel-handle-se');
    const seBox = (await se.boundingBox())!;
    await drag(page, seBox.x + seBox.width / 2, seBox.y + seBox.height / 2, seBox.x + seBox.width / 2 + 100, seBox.y + seBox.height / 2 + 100);
    pos = await getPositions(page);
    for (let i = 0; i < 6; i++) {
      expect(pos[ids[i]].width).toBeCloseTo(250, 0);
      expect(pos[ids[i]].height).toBeCloseTo(250, 0); // notes stay square
    }
    // Gaps scaled: note0 right edge → note1 left edge = 125
    expect(pos[ids[1]].x - (pos[ids[0]].x + pos[ids[0]].width!)).toBeCloseTo(125, 0);

    // Shrink hard: notes stop at STICKY_MIN_SIZE_WORLD (50×50).
    const se2 = page.getByTestId('sel-handle-se');
    const se2Box = (await se2.boundingBox())!;
    // Box is now (500..1500, 150..650); drag se to (500,150) → scale → 0, clamped.
    await drag(page, se2Box.x + se2Box.width / 2, se2Box.y + se2Box.height / 2, 500, 150);
    pos = await getPositions(page);
    for (let i = 0; i < 6; i++) {
      expect(pos[ids[i]].width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
      expect(pos[ids[i]].height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
    }
  });

  // TC-34
  test('TC-34: select all, nudge with arrows, delete the selection', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await newBoardPage(ctx, boardId);
    const centers = [
      { x: 300, y: 250 },
      { x: 600, y: 250 },
      { x: 900, y: 250 },
      { x: 300, y: 450 },
      { x: 600, y: 450 },
      { x: 900, y: 450 },
    ];
    const ids = await createNotes(page, centers);

    await page.keyboard.press('Control+a');
    expect(
      await page.locator('[data-testid^="sticky-note-"][data-selected]').count(),
    ).toBe(6);

    const camBefore = await page.evaluate(() => (window as any).__vidi6.getCamera());
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');

    let pos = await getPositions(page);
    const dx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (let i = 0; i < 6; i++) {
      expect(pos[ids[i]].x).toBe(centers[i].x - 100 + dx);
      expect(pos[ids[i]].y).toBe(centers[i].y - 100);
    }
    // No page scroll and no camera change.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const camAfter = await page.evaluate(() => (window as any).__vidi6.getCamera());
    expect(camAfter).toEqual(camBefore);

    await page.keyboard.press('Delete');
    await expect.poll(() => notes(page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
  });

  // TC-35
  test('TC-35: colleague deletes one of my selected notes → I see 3 selected and can delete them', async ({ browser }) => {
    const boardId = await createBoard();
    const leeCtx = await browser.newContext();
    const samCtx = await browser.newContext();
    const lee = await newBoardPage(leeCtx, boardId);
    const sam = await newBoardPage(samCtx, boardId);

    // 20 notes: 5 columns × 4 rows.
    const centers: { x: number; y: number }[] = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        centers.push({ x: 200 + c * 300, y: 200 + r * 300 });
      }
    }
    const ids = await createNotes(lee, centers);

    // Lee selects the first 4 notes (row 0, columns 0..3) with a marquee.
    await marquee(lee, 50, 50, 1250, 350);
    await expect(lee.getByTestId('selection-bar-count')).toHaveText('4 selected', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Sam selects and deletes one of Lee's selected notes.
    const victim = ids[1];
    const vCenter = await centerOf(note(sam, victim));
    await drag(sam, vCenter.x, vCenter.y, vCenter.x, vCenter.y); // click
    await sam.keyboard.press('Delete');

    // Lee's screen prunes the id within the live-update budget.
    await expect
      .poll(
        () => lee.getByTestId('selection-bar-count').textContent(),
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
      )
      .toBe('3 selected');
    const leePos = await getPositions(lee);
    expect(leePos[victim]).toBeUndefined();
    const selectedLeft = await lee
      .locator('[data-testid^="sticky-note-"][data-selected]')
      .count();
    expect(selectedLeft).toBe(3);

    // Lee deletes the remaining 3.
    await lee.keyboard.press('Delete');
    await expect.poll(async () => Object.keys(await getPositions(lee)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBe(16);
  });

  // TC-36
  test('TC-36: full-capacity reorganisation — 5 editors move 5 selections at once', async ({ browser }) => {
    const boardId = await createBoard();
    const targets: { x: number; y: number }[] = [];
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      contexts.push(await browser.newContext());
    }
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      pages.push(await newBoardPage(contexts[i], boardId));
    }
    // 5 notes in a row, 250 apart (no overlap).
    const startX = 250;
    const y = 300;
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      targets.push({ x: startX + i * 250 + 60, y: y + 150 });
    }
    const ids = await createNotes(pages[0], Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => ({
      x: startX + i * 250,
      y,
    })));

    // Every editor drags a different note to a different target, at the same time.
    await Promise.all(
      pages.map(async (page, i) => {
        const c = await centerOf(note(page, ids[i]));
        await drag(page, c.x, c.y, targets[i].x, targets[i].y);
      }),
    );

    // Every context converges to the same absolute positions.
    for (const page of pages) {
      await expect
        .poll(async () => {
          const pos = await getPositions(page);
          return ids.every(
            (id, i) =>
              Math.abs(pos[id].x - (targets[i].x - 100)) < 1 &&
              Math.abs(pos[id].y - (targets[i].y - 100)) < 1,
          );
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBeTruthy();
    }
  });
});
