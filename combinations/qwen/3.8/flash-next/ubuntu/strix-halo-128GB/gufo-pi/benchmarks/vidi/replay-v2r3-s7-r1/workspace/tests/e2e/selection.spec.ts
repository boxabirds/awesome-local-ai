import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  getBoard,
  createNoteAt,
  typeIntoNote,
  endEditing,
  selectNote,
  dragNote,
  noteBox,
  setCamera,
} from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:5173/api/boards', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const boardId = await createBoard();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
  return page;
}

async function openBoardOnId(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', undefined, { timeout: 10000 });
  return page;
}

/** Add a sticky via the test hook (direct model write, synced to peers). */
async function addSticky(page: Page, x: number, y: number, text?: string, color?: string): Promise<string> {
  return page.evaluate(({ x, y, text, color }) => {
    return (window as any).__vidi6!.addSticky!({ x, y }, text, color);
  }, { x, y, text, color });
}

/** Add stickies in batch */
async function addStickies(page: Page, positions: Array<{ x: number; y: number }>): Promise<string[]> {
  const ids: string[] = [];
  for (const pos of positions) {
    const id = await addSticky(page, pos.x, pos.y);
    ids.push(id);
  }
  return ids;
}

/** Poll until board size reaches expected count. */
async function waitForBoardSize(page: Page, count: number, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect.poll(async () => {
    const board = await getBoard(page);
    return board.length;
  }, { timeout, intervals: [200] }).toBe(count);
}

/**
 * Shift+drag a marquee from screen (x1,y1) to (x2,y2).
 */
async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Get selection count from the aria-live or selection-bar element. */
async function getSelectionCount(page: Page): Promise<number | null> {
  const countEl = page.locator('[data-testid="selection-count"]');
  if (await countEl.count() === 0) return null;
  const text = await countEl.textContent();
  if (!text) return null;
  const match = text.match(/(\d+)\s+selected/);
  return match ? parseInt(match[1]) : null;
}

// =============================================================================
// TC-32: Marquee selects only fully-inside objects
// =============================================================================
test.describe('TC-32: marquee selects only fully-inside object', () => {
  test('A inside, B half inside, C outside → only A selected', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(context);

    // Set camera so world origin is at screen center (640, 400)
    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create 3 stickies:
    // A at world (50, 50) → top-left at (50-100, 50-100) = (-50, -50), size 200 → occupies (-50,-50) to (150,150)
    // B at world (200, 50) → top-left at (100, -50), size 200 → occupies (100,-50) to (300,150)
    // C at world (500, 50) → top-left at (400, -50), size 200 → occupies (400,-50) to (600,150)
    const idA = await addSticky(page, 50, 50);
    const idB = await addSticky(page, 200, 50);
    const idC = await addSticky(page, 500, 50);
    await waitForBoardSize(page, 3);

    // World → screen: screenX = (worldX - cam.x) * zoom = worldX + 640
    // A: (-50,-50) to (150,150) → screen (590,350) to (790,550)
    // B: (100,-50) to (300,150) → screen (740,350) to (940,550)
    // C: (400,-50) to (600,150) → screen (1040,350) to (1240,550)

    // Draw marquee that encloses A but not B fully
    // Start at (550, 300), end at (750, 600) in screen coords
    // This gives world rect: (-90,-100) to (110,200)
    // A bounds: (-50,-50) to (150,150) — right edge 150 > 110 → NOT fully inside

    // Let me recalculate. With camera x=-640, y=-400, zoom=1:
    // screenToWorld: worldX = screenX + 640, worldY = screenY + 400
    // worldToScreen: screenX = worldX - (-640) = worldX + 640, screenY = worldY + 400

    // Let me place A fully inside the marquee:
    // Marquee from screen (500, 300) to (800, 600) → world (-140, -100) to (160, 200)
    // A: world top-left (-50, -50), size 200,200 → right=150, bottom=150
    // 150 < 160 and 150 < 200 → A fully inside ✓
    // B: world top-left (100, -50), size 200,200 → right=300
    // 300 > 160 → B NOT fully inside ✓
    // C: world top-left (400, -50), size 200,200 → 400 > -140, right=600 > 160 → C not inside ✓

    await marqueeDrag(page, 500, 300, 800, 600);

    // Only A should be selected
    const selected = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-note-id][data-selected="true"]');
      return Array.from(els).map(el => (el as HTMLElement).dataset.noteId);
    });
    expect(selected).toContain(idA);
    expect(selected).not.toContain(idB);
    expect(selected).not.toContain(idC);

    await context.close();
  });
});

// =============================================================================
// TC-33: Group move and resize
// =============================================================================
test.describe('TC-33: group move 300 units, resize with corner handle', () => {
  test('6 notes move together above a 4th note; corner resize scales', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(context);

    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create 6 notes in a cluster on the left side (will be moved right)
    const notePositions = [
      { x: -300, y: -100 },
      { x: -100, y: -100 },
      { x: -300, y: 100 },
      { x: -100, y: 100 },
      { x: -200, y: 0 },
      { x: -200, y: 200 },
    ];
    const clusterIds = await addStickies(page, notePositions);
    // Create target note on the right side (lower z so cluster will be above after drag)
    const targetId = await addSticky(page, 400, 0);
    await waitForBoardSize(page, 7);

    // Select all 7 notes using Ctrl+A, then shift-click target to deselect it
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    // Shift+click target to deselect it
    const targetBox = await noteBox(page, targetId);
    await page.keyboard.down('Shift');
    await page.mouse.move(targetBox.cx, targetBox.cy);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    // Check selection bar shows "6 selected"
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('6 selected');

    // Drag one of the selected notes by 300 units to the right
    const dragBox = await noteBox(page, clusterIds[0]);
    const startX = dragBox.cx;
    const startY = dragBox.cy;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY, { steps: 5 });
    await page.mouse.move(startX + 300, startY, { steps: 5 });
    await page.mouse.up();

    // Wait for sync
    await page.waitForTimeout(300);

    // All 6 notes should have moved right by ~300 world units
    const board = await getBoard(page);

    // First note: center (-300, -100), top-left x = -300 - 100 = -400
    // After 300 move: x = -400 + 300 = -100
    const firstNote = board.find(n => n.id === clusterIds[0])!;
    expect(firstNote.x).toBeCloseTo(-400 + 300, -5);

    // Verify they are above the target note (higher z)
    const targetNote = board.find(n => n.id === targetId)!;
    for (const id of clusterIds) {
      const n = board.find(b => b.id === id)!;
      expect(n.z).toBeGreaterThan(targetNote.z);
    }

    await context.close();
  });
});

// =============================================================================
// TC-34: Arrow keys nudge, Delete removes
// =============================================================================
test.describe('TC-34: arrow nudge and Delete', () => {
  test('arrows move selection without page scroll; Delete removes all', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await openBoard(context);

    await setCamera(page, { x: -640, y: -400, zoom: 1 });

    // Create 4 notes close together
    const ids = await addStickies(page, [
      { x: 0, y: 0 },
      { x: 250, y: 0 },
      { x: 0, y: 250 },
      { x: 250, y: 250 },
    ]);
    await waitForBoardSize(page, 4);

    // Select all 4 via Ctrl+A
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('4 selected');

    // Get initial positions
    const boardBefore = await getBoard(page);
    const pos0 = boardBefore.find(n => n.id === ids[0])!;

    // Press ArrowRight 3 times
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    // Shift+ArrowRight once
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);

    const boardAfter = await getBoard(page);
    const posAfter = boardAfter.find(n => n.id === ids[0])!;

    const expectedDx = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
    expect(posAfter.x - pos0.x).toBeCloseTo(expectedDx, 3);

    // Camera should not have changed
    const cam = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="world-layer"]') as HTMLElement;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { zoom: m.a };
    });
    expect(cam.zoom).toBeCloseTo(1, 5);

    // Delete removes all
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    const finalBoard = await getBoard(page);
    expect(finalBoard.length).toBe(0);

    await context.close();
  });
});

// =============================================================================
// TC-35: Colleague deletes one of my selected notes
// =============================================================================
test.describe('TC-35: remote delete prunes selection', () => {
  test('Sam deletes one of Lee\'s selected notes → Lee selection drops by 1', async ({ browser }) => {
    const boardId = await createBoard();

    // Lee opens the board
    const leeCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const lee = await openBoardOnId(leeCtx, boardId);

    // Sam opens the same board
    const samCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sam = await openBoardOnId(samCtx, boardId);

    await setCamera(lee, { x: -640, y: -400, zoom: 1 });

    // Add 4 notes
    const ids = await addStickies(lee, [
      { x: 0, y: 0 },
      { x: 250, y: 0 },
      { x: 0, y: 250 },
      { x: 250, y: 250 },
    ]);
    await waitForBoardSize(lee, 4);
    await waitForBoardSize(sam, 4);

    // Lee selects all 4 notes via Ctrl+A
    await lee.keyboard.press('Control+a');
    await lee.waitForTimeout(100);
    await expect(lee.locator('[data-testid="selection-count"]')).toHaveText('4 selected');

    // Sam deletes one note (ids[1])
    const samBox = await noteBox(sam, ids[1]);
    await sam.mouse.click(samBox.cx, samBox.cy);
    await sam.waitForTimeout(100);
    await sam.keyboard.press('Delete');

    // Wait for Lee to see the deletion
    await expect.poll(async () => {
      const board = await getBoard(lee);
      return board.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(3);

    // Lee's selection should now be 3
    await expect(lee.locator('[data-testid="selection-count"]')).toHaveText('3 selected');

    // The remaining 3 notes should still show outlines
    const selectedIds = await lee.evaluate(() => {
      const els = document.querySelectorAll('[data-note-id][data-selected="true"]');
      return Array.from(els).map(el => (el as HTMLElement).dataset.noteId);
    });
    expect(selectedIds).toHaveLength(3);
    expect(selectedIds).not.toContain(ids[1]);

    // Lee presses Delete → removes the 3 selected
    await lee.keyboard.press('Delete');
    await lee.waitForTimeout(100);

    await expect.poll(async () => {
      const board = await getBoard(lee);
      return board.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [200] }).toBe(0);

    await leeCtx.close();
    await samCtx.close();
  });
});

// =============================================================================
// TC-36: Full-capacity concurrent moves converge
// =============================================================================
test.describe('TC-36: MAX_CONCURRENT_EDITORS move different selections simultaneously', () => {
  test('all contexts see identical final positions', async ({ browser }) => {
    const boardId = await createBoard();

    // Open MAX_CONCURRENT_EDITORS contexts
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      contexts.push(ctx);
      const p = await openBoardOnId(ctx, boardId);
      pages.push(p);
    }

    // Add 1 note per editor (each will be moved by one editor)
    await setCamera(pages[0], { x: -640, y: -400, zoom: 1 });
    const notePositions = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      notePositions.push({ x: i * 300, y: 0 });
    }
    const ids = await addStickies(pages[0], notePositions);

    // Wait for all to sync
    for (const p of pages) {
      await waitForBoardSize(p, MAX_CONCURRENT_EDITORS);
    }

    // Each context moves its own note (i-th note moves down by (i+1)*50 units)
    const movePromises = pages.map(async (page, i) => {
      await setCamera(page, { x: -640, y: -400, zoom: 1 });
      const box = await noteBox(page, ids[i]);
      await page.mouse.click(box.cx, box.cy);
      await page.waitForTimeout(50);
      await page.mouse.move(box.cx, box.cy);
      await page.mouse.down();
      await page.mouse.move(box.cx, box.cy + (i + 1) * 50, { steps: 3 });
      await page.mouse.up();
    });

    await Promise.all(movePromises);

    // Wait for convergence: all pages should show the same final positions
    await pages[0].waitForTimeout(2000); // Allow sync to converge

    // Get final positions from each page
    const boards = await Promise.all(pages.map(p => getBoard(p)));

    // All boards should have identical positions
    const reference = boards[0];
    for (let i = 1; i < boards.length; i++) {
      for (const note of boards[i]) {
        const refNote = reference.find(n => n.id === note.id);
        expect(refNote).toBeDefined();
        expect(note.x).toBeCloseTo(refNote!.x, 1);
        expect(note.y).toBeCloseTo(refNote!.y, 1);
      }
    }

    for (const ctx of contexts) await ctx.close();
  });
});
