import { test, expect } from '@playwright/test';
import { getNoteIds, getNoteWorldPos, setCamera } from './helpers/sticky';
import { createAndGotoBoard } from './helpers/create-board';
import { openParticipants, closeParticipants, expectWithin, newE2eBoardId } from './helpers/participants';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';

/** Create a note by double-clicking at screen (x,y) and pressing Escape. */
async function createNote(page: import('@playwright/test').Page, x: number, y: number): Promise<string> {
  const before = await getNoteIds(page);
  await page.mouse.dblclick(x, y);
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length > prev,
    before.length,
  );
  const ids = await getNoteIds(page);
  const id = ids.find((i) => !before.includes(i))!;
  await page.keyboard.press('Escape');
  return id;
}

/**
 * Camera: cam.x=-100, cam.y=-100, zoom=1.
 * screenToWorld(sx, sy) = (sx - 100, sy - 100)  [world center]
 * worldToScreen(wx, wy) = (wx + 100, wy + 100)
 * Note created at screen (sx, sy) has world center (sx-100, sy-100), top-left (sx-200, sy-200)
 * because default note size is 200x200.
 */
async function setupCamera(page: import('@playwright/test').Page) {
  await setCamera(page, { x: -100, y: -100, zoom: 1 });
  await page.waitForTimeout(100);
}

test.describe('Selection e2e', () => {
  test('TC-32: marquee selects only fully-inside notes', async ({ page }) => {
    await createAndGotoBoard(page);
    await setupCamera(page);

    // Create 3 notes at known screen positions (center of each note):
    // Note A: screen (250, 250) → world center (150,150), top-left (50,50), bottom-right (250,250)
    // Note B: screen (400, 250) → world center (300,150), top-left (200,50), bottom-right (400,250)
    // Note C: screen (700, 700) → world center (600,600), top-left (500,500), bottom-right (700,700)
    // (C is far away, outside marquee rect)
    await createNote(page, 250, 250); // Note A
    await createNote(page, 400, 250); // Note B (partially overlaps marquee edge)
    await createNote(page, 700, 650); // Note C (outside)

    // Draw marquee: shift+drag from screen (80, 80) to screen (320, 320)
    // That covers world (0..220, 0..220) (screenToWorld subtracts 100)
    // Wait: screenToWorld(sx, sy) = (sx/zoom + cam.x) = sx + (-100) = sx - 100
    // world (0, 0) to (220, 220). Note A world bounds: (50,50)..(250,250) → NOT fully inside (250 > 220).
    // Hmm, need to recalculate.
    // Actually: screenToWorld({x: 80, y: 80}) = ({ x: 80*1 + (-100), y: 80*1 + (-100) }) = (-20, -20)
    // screenToWorld({x: 320, y: 320}) = (220, 220)
    // Marquee world rect: (-20, -20, 240, 240). Note A bounds: (50,50)..(250,250) → right edge 250 > 220, NOT fully inside!
    // I need to make the marquee cover Note A fully.
    // Note A world bounds: top-left (50,50), bottom-right (250,250).
    // Marquee must go from at least world (-∞, -∞) to (250+, 250+).
    // Screen: w2s(50, 50) = (150, 150), w2s(250, 250) = (350, 350)
    // So marquee: start at screen (140, 140) → end at screen (360, 360)
    // This covers world (40, 40) to (260, 260). Note A (50..250) fully inside. ✓
    // Note B world: (200..400). Right edge 400 > 260, so NOT fully inside. ✓
    // Note C world: (500..700). Completely outside. ✓

    const start = { x: 140, y: 140 };
    const end = { x: 360, y: 360 };

    await page.keyboard.down('Shift');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Only A fully inside → 1 outline
    await page.waitForTimeout(200);
    const outlines = page.locator('[data-testid="selection-outline"]');
    await expect(outlines).toHaveCount(1);
  });

  test('TC-33: select multiple notes, move together', async ({ page }) => {
    await createAndGotoBoard(page);
    await setupCamera(page);

    // Create 4 notes well within viewport (1280x800):
    // A: screen (200, 200) → world center (100,100), top-left (0,0), bottom-right (200,200)
    // B: screen (450, 200) → world center (350,100), top-left (250,0), bottom-right (450,200)
    // C: screen (200, 450) → world center (100,350), top-left (0,250), bottom-right (200,450)
    // D: screen (700, 600) → far away (should NOT move)
    await createNote(page, 200, 200);  // A
    await createNote(page, 450, 200);  // B
    await createNote(page, 200, 450);  // C
    const idD = await createNote(page, 700, 600); // D

    // Select A, B, C: click A, then shift-click B and C
    await page.mouse.click(200, 200);
    await page.keyboard.down('Shift');
    await page.mouse.click(450, 200);
    await page.mouse.click(200, 450);
    await page.keyboard.up('Shift');

    // Bar shows "3 selected"
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('3 selected');

    // Get positions before move
    const allIds = await getNoteIds(page);
    const selectedIds = allIds.filter((id) => id !== idD);
    expect(selectedIds.length).toBe(3);
    const [idA, idB, idC] = selectedIds;

    const beforeA = await getNoteWorldPos(page, idA);
    const beforeB = await getNoteWorldPos(page, idB);
    const beforeC = await getNoteWorldPos(page, idC);
    const beforeD = await getNoteWorldPos(page, idD);

    // Drag note A by 150 screen pixels to the right (= 150 world units at zoom 1)
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(350, 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // All 3 should have moved by ~150 units
    const afterA = await getNoteWorldPos(page, idA);
    const afterB = await getNoteWorldPos(page, idB);
    const afterC = await getNoteWorldPos(page, idC);
    const afterD = await getNoteWorldPos(page, idD);

    expect(afterA.x - beforeA.x).toBeCloseTo(150, -1);
    expect(afterB.x - beforeB.x).toBeCloseTo(150, -1);
    expect(afterC.x - beforeC.x).toBeCloseTo(150, -1);

    // D unchanged
    expect(afterD.x).toBeCloseTo(beforeD.x, 0);
    expect(afterD.y).toBeCloseTo(beforeD.y, 0);

    // Selected notes should now be above D (bringToFront)
    expect(afterA.z).toBeGreaterThan(beforeD.z);
    expect(afterB.z).toBeGreaterThan(beforeD.z);
    expect(afterC.z).toBeGreaterThan(beforeD.z);
  });

  test('TC-34: nudge with arrows and delete', async ({ page }) => {
    await createAndGotoBoard(page);
    await setupCamera(page);

    // Create 2 notes
    const idA = await createNote(page, 300, 300);
    await createNote(page, 550, 300);

    // Select all: Ctrl+A
    await page.keyboard.press('Control+a');
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('2 selected');

    // Get initial position
    const beforeA = await getNoteWorldPos(page, idA);

    // ArrowRight x3 → 3 * NUDGE_STEP_WORLD
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    // Shift+ArrowRight → 1 * NUDGE_LARGE_STEP_WORLD
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(50);

    const afterNudgeA = await getNoteWorldPos(page, idA);
    const totalNudge = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    expect(afterNudgeA.x - beforeA.x).toBeCloseTo(totalNudge, 0);

    // Camera should be unchanged (no pan)
    const worldLayer = page.locator('[data-testid="world-layer"]');
    const camX = parseFloat((await worldLayer.getAttribute('data-camera-x'))!);
    expect(camX).toBeCloseTo(-100, 0);

    // Delete all selected
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    const ids = await getNoteIds(page);
    expect(ids.length).toBe(0);
  });
});

test.describe('Selection e2e - remote delete', () => {
  test('TC-35: colleague deletes one of my selected notes', async ({ browser }) => {
    const participants = await openParticipants(browser, newE2eBoardId(), 2);
    const lee = participants[0];
    const sam = participants[1];

    try {
      await setupCamera(lee.page);
      await setupCamera(sam.page);

      // Lee creates 4 notes
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = await createNote(lee.page, 200 + i * 250, 300);
        ids.push(id);
      }

      // Wait for Sam to see the notes
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(async () =>
        (await getNoteIds(sam.page)).length
      ).toBe(4);

      // Lee selects all 4 (Ctrl+A)
      await lee.page.keyboard.press('Control+a');
      await expect(lee.page.locator('[data-testid="selection-count"]')).toHaveText('4 selected');

      // Sam deletes one note: click on the first note, then press Delete
      await sam.page.mouse.click(200, 300); // center of first note
      await sam.page.keyboard.press('Delete');

      // Lee's selection should drop to 3
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(async () => {
        const el = lee.page.locator('[data-testid="selection-count"]');
        if (await el.count() === 0) return '';
        return await el.textContent();
      }).toBe('3 selected');

      // Lee deletes the remaining 3
      await lee.page.keyboard.press('Delete');
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(async () =>
        (await getNoteIds(lee.page)).length
      ).toBe(0);
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('Workflow: Full-capacity reorganisation', () => {
  test('TC-36: MAX_CONCURRENT_EDITORS contexts each move a different selection — all converge identically', async ({ browser }) => {
    test.setTimeout(150_000);
    const board = newE2eBoardId();
    const parts = await openParticipants(browser, board, MAX_CONCURRENT_EDITORS);

    const ZOOM = 0.5;
    const NOTES_PER_USER = 3;
    // Grid positions (screen px) well within viewport 1280x800
    const gridX = (j: number) => 100 + j * 250;
    const gridY = (j: number) => 200 + j * 250;

    const deselect = async (page: import('@playwright/test').Page) => {
      await page.mouse.click(1250, 40);
    };

    try {
      // Each participant sets a camera that makes their grid region visible and
      // puts other participants' notes off-screen.
      const created = await Promise.all(
        parts.map(async (p, i) => {
          await p.page.evaluate(
            (cam) => (window as any).__vidi6!.setCamera(cam),
            { x: -i * 5000, y: 0, zoom: ZOOM },
          );
          await p.page.waitForTimeout(100);
          const own: string[] = [];
          for (let j = 0; j < NOTES_PER_USER; j++) {
            await deselect(p.page);
            await p.page.mouse.dblclick(gridX(j), gridY(j));
            const ta = p.page.locator('[data-testid="sticky-textarea"]').first();
            await ta.waitFor({ state: 'attached', timeout: 3000 });
            await p.page.keyboard.press('Escape');
            const ids = await getNoteIds(p.page);
            const newId = ids.find((id) => !own.includes(id))!;
            own.push(newId);
          }
          return own;
        }),
      );

      const total = MAX_CONCURRENT_EDITORS * NOTES_PER_USER;
      // Wait for all participants to see all notes
      for (const p of parts) {
        await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(async () =>
          (await getNoteIds(p.page)).length
        ).toBe(total);
      }

      // Each participant selects all their own notes (Ctrl+A selects all on their view)
      // then drags them by a unique offset using nudge (reliable for concurrent edits).
      await Promise.all(
        parts.map(async (p, i) => {
          // Select all visible notes
          await p.page.keyboard.press('Control+a');
          await p.page.waitForTimeout(100);
          // Nudge right by (i+1)*2 steps so each user moves a different amount
          for (let s = 0; s < (i + 1) * 2; s++) {
            await p.page.keyboard.press('ArrowRight');
          }
          // Nudge down by (i+1)*2 steps
          for (let s = 0; s < (i + 1) * 2; s++) {
            await p.page.keyboard.press('ArrowDown');
          }
          await p.page.waitForTimeout(200);
        }),
      );

      // Wait for convergence: all participants should see the same note positions
      const signature = async (page: import('@playwright/test').Page) => {
        return page.$$eval('[data-testid="sticky-note-wrapper"]', (els) =>
          els.map((e) => {
            const h = e as HTMLElement;
            return `${h.dataset.noteId}|${h.dataset.x}|${h.dataset.y}`;
          }).sort().join('\n'),
        );
      };

      const first = await signature(parts[0].page);
      for (const p of parts) {
        await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(async () =>
          await signature(p.page)
        ).toBe(first);
      }
    } finally {
      await closeParticipants(parts);
    }
  });
});
