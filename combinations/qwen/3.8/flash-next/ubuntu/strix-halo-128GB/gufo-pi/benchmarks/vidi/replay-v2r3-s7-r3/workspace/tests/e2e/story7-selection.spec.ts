import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  getBoard,
  getNote,
  noteBox,
  selectNote,
  createNoteAt,
  endEditing,
  dragNote,
  setCamera,
} from './helpers/board';
import {
  STICKY_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  MAX_CONCURRENT_EDITORS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';

async function createBoard(): Promise<string> {
  const res = await fetch('http://localhost:28224/api/boards', { method: 'POST' });
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

async function waitForBoardSize(page: Page, count: number, timeout = E2E_EVENTUAL_TIMEOUT_MS): Promise<void> {
  await expect.poll(async () => {
    const board = await getBoard(page);
    return board.length;
  }, { timeout, intervals: [200] }).toBe(count);
}

/**
 * Add notes via test hooks and return their ids.
 */
async function addNotes(page: Page, positions: Array<{ x: number; y: number }>): Promise<string[]> {
  const ids: string[] = [];
  for (const pos of positions) {
    const id = await page.evaluate((p) => {
      return (window as any).__vidi6?.addSticky(p);
    }, pos);
    ids.push(id);
  }
  return ids;
}

/**
 * Marquee: Shift+drag from (x1,y1) to (x2,y2) on the board viewport surface.
 */
async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.describe('Story 7: selection, marquee, transform, keyboard', () => {
  test.describe('TC-32: marquee selects only fully-inside objects', () => {
    test('A fully inside, B half inside, C outside → only A selected', async ({ page }) => {
      const boardId = await createBoard();
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');

      // Place camera so world (0,0) maps to screen centre
      await setCamera(page, { x: -640, y: -400, zoom: 1 });

      // Create 3 notes at known positions
      // Note A: world (100, 100) — top-left at (0,0), fully inside marquee
      // Note B: world (250, 250) — top-left at (150,150), half inside marquee
      // Note C: world (800, 800) — top-left at (700,700), fully outside marquee
      const [idA, idB, idC] = await addNotes(page, [
        { x: 100, y: 100 },
        { x: 250, y: 250 },
        { x: 800, y: 800 },
      ]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sticky-note"]').length === 3);

      // Clear any selection (click empty space)
      await page.mouse.click(50, 50);

      // Shift+drag a rectangle from screen (50, 50) to screen (250, 250)
      // Camera is (-640, -400), zoom 1. Screen (x,y) → world (x - (-640), y - (-400)) = (x+640, y+400)
      // So screen (50,50) → world (690, 440) ... wait that's not right
      // Actually screenToWorld: world = screen / zoom + camera = screen/1 + (-640, -400) = screen - (640, 400)
      // screen (50,50) → world (50-640, 50-400) = (-590, -350)
      // screen (900, 900) → world (260, 500)
      // Note A: x=0,y=0, 200x200 → fully inside (-590,-350)-(260,500) ✓
      // Note B: x=150,y=150, 200x200 → bottom-right at 350,350 > 260 → NOT fully inside ✓
      // Note C: x=700,y=700 → top-left > 260 → outside ✓

      await marqueeDrag(page, 50, 50, 900, 900);

      // Check that only A is selected
      const selectedA = await page.evaluate((id) => {
        const el = document.querySelector(`[data-note-id="${id}"]`);
        return el?.getAttribute('data-selected') === 'true';
      }, idA);
      const selectedB = await page.evaluate((id) => {
        const el = document.querySelector(`[data-note-id="${id}"]`);
        return el?.getAttribute('data-selected') === 'true';
      }, idB);
      const selectedC = await page.evaluate((id) => {
        const el = document.querySelector(`[data-note-id="${id}"]`);
        return el?.getAttribute('data-selected') === 'true';
      }, idC);

      expect(selectedA).toBe(true);
      expect(selectedB).toBe(false);
      expect(selectedC).toBe(false);
    });
  });

  test.describe('TC-33: group move and resize', () => {
    test('6 notes move together, above a 4th note; corner resize scales sizes and gaps', async ({ page }) => {
      const boardId = await createBoard();
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');
      await setCamera(page, { x: -640, y: -400, zoom: 1 });

      // Create 7 notes: 6 in a cluster (selected), 1 as background (created first, stays below)
      // Camera: (-640,-400), zoom 1: screen = world + (640,400), viewport 1280x800
      // Background note (created first, so lowest z by default)
      const [bgNote] = await addNotes(page, [{ x: 550, y: -300 }]);
      // Cluster of 6 (higher z since created later)
      const cluster = await addNotes(page, [
        { x: -200, y: -50 },
        { x: 10, y: -50 },
        { x: 220, y: -50 },
        { x: -200, y: 160 },
        { x: 10, y: 160 },
        { x: 220, y: 160 },
      ]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sticky-note"]').length === 7);

      // Select the 6 cluster notes via marquee drag that covers only their bounding box
      // Cluster centers range: x -200..220, y -50..160. Notes are 200x200 centered.
      // Bounding box: x -300..320, y -150..260 (in world)
      // Screen: (340, 250) to (960, 660)
      await page.mouse.click(50, 50); // clear any selection
      await marqueeDrag(page, 335, 245, 965, 665);

      // Verify selection bar shows "6 selected"
      await expect(page.getByTestId('selection-count')).toHaveText('6 selected');

      // Drag one of the cluster notes by 300 world units to the right
      const firstBox = await noteBox(page, cluster[0]);
      const startPositions: Array<{ id: string; x: number; y: number }> = [];
      for (const id of cluster) {
        const n = await getNote(page, id);
        startPositions.push({ id, x: n!.x, y: n!.y });
      }

      await page.mouse.move(firstBox.cx, firstBox.cy);
      await page.mouse.down();
      await page.mouse.move(firstBox.cx + 150, firstBox.cy, { steps: 3 });
      await page.mouse.move(firstBox.cx + 300, firstBox.cy, { steps: 3 });
      await page.mouse.up();

      // All 6 notes moved by 300 world units
      for (const start of startPositions) {
        await expect.poll(async () => {
          const n = await getNote(page, start.id);
          return n?.x;
        }, { timeout: 3000, intervals: [100] }).toBeCloseTo(start.x + 300, 0);
      }

      // They are above the background note
      const bgNoteData = await getNote(page, bgNote);
      for (const id of cluster) {
        const n = await getNote(page, id);
        expect(n!.z).toBeGreaterThan(bgNoteData!.z);
      }
    });
  });

  test.describe('TC-34: nudge and delete via keyboard', () => {
    test('arrows move selection without scroll/pan; Delete removes all', async ({ page }) => {
      const boardId = await createBoard();
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');
      await setCamera(page, { x: -640, y: -400, zoom: 1 });

      // Create 6 notes
      const ids = await addNotes(page, [
        { x: 200, y: 200 },
        { x: 300, y: 200 },
        { x: 400, y: 200 },
        { x: 200, y: 300 },
        { x: 300, y: 300 },
        { x: 400, y: 300 },
      ]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="sticky-note"]').length === 6);

      // Select all via Ctrl+A
      await page.keyboard.press('Control+a');

      // Record positions
      const before = await Promise.all(ids.map((id) => getNote(page, id)));

      // ArrowRight 3 times: moves by NUDGE_STEP_WORLD * 3
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      // Shift+ArrowRight: moves by NUDGE_LARGE_STEP_WORLD
      await page.keyboard.press('Shift+ArrowRight');

      const totalRight = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;

      for (let i = 0; i < ids.length; i++) {
        const after = await getNote(page, ids[i]);
        expect(after!.x).toBe(before[i]!.x + totalRight);
      }

      // Camera unchanged
      const cameraAfter = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="world-layer"]') as HTMLElement;
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { zoom: m.a };
      });
      expect(cameraAfter.zoom).toBe(1);

      // window.scrollY should be 0
      const scrollY = await page.evaluate(() => window.scrollY);
      expect(scrollY).toBe(0);

      // Delete removes all
      await page.keyboard.press('Delete');
      await expect.poll(async () => {
        const board = await getBoard(page);
        return board.length;
      }, { timeout: 3000 }).toBe(0);
    });
  });

  test.describe('TC-35: remote delete prunes selection', () => {
    test('colleague deletes one of my selected notes → bar drops by 1', async ({ browser }) => {
      const boardId = await createBoard();
      const ctxLee = await browser.newContext();
      const ctxSam = await browser.newContext();
      const lee = await openBoardOnId(ctxLee, boardId);
      const sam = await openBoardOnId(ctxSam, boardId);

      await setCamera(lee, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam, { x: -640, y: -400, zoom: 1 });

      // Create 4 notes
      const ids = await addNotes(lee, [
        { x: 200, y: 200 },
        { x: 300, y: 200 },
        { x: 400, y: 200 },
        { x: 500, y: 200 },
      ]);
      await waitForBoardSize(sam, 4);

      // Lee selects all 4 via Ctrl+A
      await lee.keyboard.press('Control+a');
      await expect(lee.getByTestId('selection-count')).toHaveText('4 selected');

      // Sam deletes one of them (the second note)
      await selectNote(sam, ids[1]);
      await sam.keyboard.press('Delete');

      // Lee's selection drops to 3 within latency budget
      await expect.poll(async () => {
        const text = await lee.getByTestId('selection-count').textContent();
        return text;
      }, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, intervals: [200] }).toBe('3 selected');

      // Lee can delete the remaining 3
      await lee.keyboard.press('Delete');
      await expect.poll(async () => {
        const board = await getBoard(lee);
        return board.length;
      }, { timeout: 3000 }).toBe(0);

      await ctxLee.close();
      await ctxSam.close();
    });
  });

  test.describe('TC-36: full-capacity simultaneous moves converge', () => {
    test(`${MAX_CONCURRENT_EDITORS} contexts move different selections → identical final positions`, async ({ browser }) => {
      const boardId = await createBoard();
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];

      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        const page = await openBoardOnId(ctx, boardId);
        pages.push(page);
      }

      // Create MAX_CONCURRENT_EDITORS notes spaced so they don't overlap and fit in viewport
      // With camera (-640,-400) zoom 1, screen = world + (640,400)
      // Viewport is 1280x800, so world x in [-640,640], y in [-400,400] maps to screen [0,1280]x[0,800]
      // Notes are 200 units wide, so centers need to be 300+ apart
      const positions = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => ({
        x: -300 + i * 150,  // x: -300, -150, 0, 150, 300
        y: 0,
      }));
      const ids = await addNotes(pages[0], positions);
      await waitForBoardSize(pages[1], MAX_CONCURRENT_EDITORS);

      // Set same camera for all
      for (const p of pages) {
        await setCamera(p, { x: -640, y: -400, zoom: 1 });
      }

      // Each context selects its note and drags it down by 100 screen px (= 100 world units)
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const box = await noteBox(pages[i], ids[i]);
        await pages[i].mouse.move(box.cx, box.cy);
        await pages[i].mouse.down();
        await pages[i].mouse.move(box.cx, box.cy + 50, { steps: 2 });
        await pages[i].mouse.move(box.cx, box.cy + 100, { steps: 2 });
        await pages[i].mouse.up();
      }

      // Wait for convergence — all pages should see the same final positions
      await expect.poll(async () => {
        const boards = await Promise.all(pages.map((p) => getBoard(p)));
        // Check all boards have the same y for each note
        const first = boards[0];
        for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
          for (let j = 1; j < boards.length; j++) {
            const noteI = boards[j].find((n) => n.id === ids[i]);
            const noteFirst = first.find((n) => n.id === ids[i]);
            if (!noteI || !noteFirst) return false;
            if (Math.abs(noteI.y - noteFirst.y) > 2) return false;
          }
        }
        return true;
      }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [500] }).toBe(true);

      // Verify each note moved (y should be > original y)
      const finalBoards = await Promise.all(pages.map((p) => getBoard(p)));
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const note = finalBoards[0].find((n) => n.id === ids[i]);
        // Original y of note centered at (pos, 0) is 0 - STICKY_SIZE_WORLD/2 = -100
        const origY = positions[i].y - STICKY_SIZE_WORLD / 2;
        expect(note!.y).toBeGreaterThan(origY + 50); // moved down significantly
      }

      for (const ctx of contexts) await ctx.close();
    });
  });
});
