import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { createParticipants, expectEventually } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** These tests require chromium (real layout for pixel-accurate assertions). */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium only');
}

/**
 * Create a note at a screen position with retry logic.
 * The viewport is 1280x800; camera (-640,-400,1) means world(0,0)=screen(640,400).
 * Visible world range: x [-640, 640], y [-400, 400].
 */
async function createNoteAt(page: Page, text: string, screenX: number, screenY: number): Promise<void> {
  const editing = page.locator('[data-testid="sticky-note"][data-editing="true"]');
  if (await editing.count() > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }

  const before = await page.locator('[data-testid="sticky-note"]').count();
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.dblclick(screenX, screenY);
    const textarea = page.getByTestId('sticky-textarea');
    const visible = await textarea.isVisible().catch(() => false);
    const after = await page.locator('[data-testid="sticky-note"]').count();
    if (visible && after > before) {
      await expect(textarea).toBeVisible({ timeout: 3000 });
      await textarea.fill(text);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="sticky-note"]').filter({ hasText: text })).toBeVisible({ timeout: 3000 });
      return;
    }
    if (visible && after === before) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`createNoteAt(${text}) failed at (${screenX},${screenY})`);
}

/**
 * Create 3 notes in a row, all within the visible viewport.
 * World positions: (-200,0), (0,0), (200,0) → screen (440,400), (640,400), (840,400)
 */
async function seed3Notes(page: Page): Promise<void> {
  await setCamera(page, { x: -640, y: -400, zoom: 1 });
  const positions = [
    { wx: -200, wy: 0 },
    { wx: 0, wy: 0 },
    { wx: 200, wy: 0 },
  ];
  for (let i = 0; i < 3; i++) {
    const sx = positions[i].wx + 640;
    const sy = positions[i].wy + 400;
    await createNoteAt(page, `Note${i}`, sx, sy);
  }
}

/**
 * Create 4 notes in a row, all within the visible viewport.
 * World positions: (-300,0), (-100,0), (100,0), (300,0) → screen (340,400), (540,400), (740,400), (940,400)
 */
async function seed4Notes(page: Page): Promise<void> {
  await setCamera(page, { x: -640, y: -400, zoom: 1 });
  const positions = [
    { wx: -300, wy: 0 },
    { wx: -100, wy: 0 },
    { wx: 100, wy: 0 },
    { wx: 300, wy: 0 },
  ];
  for (let i = 0; i < 4; i++) {
    const sx = positions[i].wx + 640;
    const sy = positions[i].wy + 400;
    await createNoteAt(page, `Note${i}`, sx, sy);
  }
}

test.describe('story 7: multi-select, move, resize, delete', () => {
  // ─── TC-32: marquee selection ─────────────────────────────────────────────
  test('TC-32: Shift+drag selects only fully-inside objects', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await seed3Notes(page);

    // Notes are 200px wide at zoom=1, centered at:
    // Note0: screen centre (440, 400), spans (340,300)-(540,500)
    // Note1: screen centre (640, 400), spans (540,300)-(740,500)
    // Note2: screen centre (840, 400), spans (740,300)-(940,500)
    //
    // Marquee from (330, 290) to (550, 510):
    //   - Fully contains Note0 (340-540 inside 330-550) ✓
    //   - Does NOT fully contain Note1 (540-740, right edge 740 > 550) ✓
    //   - Does NOT contain Note2 ✓
    // Click empty space first to clear any existing selection
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);

    await page.keyboard.down('Shift');
    await page.mouse.move(330, 290);
    await page.mouse.down();
    await page.mouse.move(440, 400, { steps: 3 });
    // Verify marquee rect is visible during drag
    await expect(page.getByTestId('marquee-rect')).toBeVisible({ timeout: 3000 });
    await page.mouse.move(550, 510, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Note0 should be selected
    await expect(page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note0' })).toHaveAttribute('data-selected', 'true');
    // Note1 and Note2 should not be selected
    await expect(page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note1' })).not.toHaveAttribute('data-selected');
    await expect(page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note2' })).not.toHaveAttribute('data-selected');
  });

  // ─── TC-33: group move ────────────────────────────────────────────────────
  test('TC-33: select 3 notes, drag one → all move together', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await seed3Notes(page);

    // Select all 3 with Ctrl+A
    await page.keyboard.press('Control+a');
    const selectedCount = await page.locator('[data-testid="sticky-note"][data-selected="true"]').count();
    expect(selectedCount).toBe(3);

    // Get initial position of Note0
    const note0Before = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note0' }).boundingBox())!;

    // Drag Note0 by (100, 50) screen pixels
    const cx = note0Before.x + note0Before.width / 2;
    const cy = note0Before.y + note0Before.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 50, { steps: 3 });
    await page.mouse.up();

    // All 3 notes should have moved by (100, 50)
    const note0After = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note0' }).boundingBox())!;
    const note1After = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note1' }).boundingBox())!;
    const note2After = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note2' }).boundingBox())!;

    expect(Math.abs(note0After.x - (note0Before.x + 100))).toBeLessThanOrEqual(2);
    expect(Math.abs(note0After.y - (note0Before.y + 50))).toBeLessThanOrEqual(2);
    // Spacing preserved (200px between note centres)
    const spacing01 = (note1After.x + note1After.width / 2) - (note0After.x + note0After.width / 2);
    const spacing02 = (note2After.x + note2After.width / 2) - (note0After.x + note0After.width / 2);
    expect(Math.abs(spacing01 - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(spacing02 - 400)).toBeLessThanOrEqual(3);
  });

  // ─── TC-34: nudge and delete ─────────────────────────────────────────────
  test('TC-34: arrow keys nudge without scroll; Delete removes all', async ({ page }) => {
    chromiumOnly();
    await gotoBoard(page);
    await seed3Notes(page);

    // Select all
    await page.keyboard.press('Control+a');
    const selectedCount = await page.locator('[data-testid="sticky-note"][data-selected="true"]').count();
    expect(selectedCount).toBe(3);

    // Record scroll position
    const scrollYBefore = await page.evaluate(() => window.scrollY);

    // ArrowRight × 3
    const note0Before = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note0' }).boundingBox())!;
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    const note0AfterNudge = (await page.locator('[data-testid="sticky-note"]').filter({ hasText: 'Note0' }).boundingBox())!;
    // Moved 3 world units right (zoom=1, so 3 screen pixels)
    expect(note0AfterNudge.x - note0Before.x).toBeGreaterThanOrEqual(2);
    expect(note0AfterNudge.x - note0Before.x).toBeLessThanOrEqual(4);

    // Page should not have scrolled
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBe(scrollYBefore);

    // Delete all
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
  });

  // ─── TC-35: colleague deletes one of my selected notes ────────────────────
  test('TC-35: Sam deletes one of Lee\'s selected notes → Lee\'s count drops', async ({ browser }) => {
    chromiumOnly();
    const [lee, sam] = await createParticipants(browser, 2);
    try {
      // Lee creates 4 notes
      await seed4Notes(lee.page);

      // Lee selects all 4 with Ctrl+A
      await lee.page.keyboard.press('Control+a');
      await expect(lee.page.getByTestId('selection-count')).toHaveText('4 selected');

      // Sam selects Note1 and deletes it
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });
      await sam.selectNote('Note1');
      await sam.page.keyboard.press('Delete');

      // Lee's selection should drop to 3
      await expectEventually("Lee's selection drops to 3", async () => {
        const text = await lee.page.getByTestId('selection-count').textContent().catch(() => '');
        return text === '3 selected';
      });

      // Lee can still delete the remaining 3
      await lee.page.keyboard.press('Delete');
      await expect(lee.page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
    } finally {
      await lee.close();
      await sam.close();
    }
  });

  // ─── TC-36: full-capacity reorganisation ──────────────────────────────────
  test('TC-36: MAX_CONCURRENT_EDITORS move different selections simultaneously', async ({ browser }) => {
    chromiumOnly();
    const n = MAX_CONCURRENT_EDITORS;
    const participants = await createParticipants(browser, n);
    try {
      // First participant creates 10 notes in a 5×2 grid
      // World positions: x in {-400,-200,0,200,400}, y in {-100, 100}
      // Screen: x in {240,440,640,840,1040}, y in {300, 500}
      const p0 = participants[0];
      await setCamera(p0.page, { x: -640, y: -400, zoom: 1 });

      const gridX = [-400, -200, 0, 200, 400];
      const gridY = [-100, 100];
      let idx = 0;
      for (const wy of gridY) {
        for (const wx of gridX) {
          const sx = wx + 640;
          const sy = wy + 400;
          await createNoteAt(p0.page, `N${idx}`, sx, sy);
          idx++;
        }
      }

      // Wait for all participants to see the notes
      for (const p of participants) {
        await setCamera(p.page, { x: -640, y: -400, zoom: 1 });
        await expect(p.page.locator('[data-testid="sticky-note"]')).toHaveCount(10, { timeout: 10000 });
      }

      // Each participant selects and moves a different note
      const deltas = [
        [50, 0], [0, 50], [-50, 0], [0, -50], [50, 50],
      ];

      const promises = participants.map(async (p, i) => {
        const noteText = `N${i * 2}`;
        const note = p.page.locator('[data-testid="sticky-note"]').filter({ hasText: noteText });
        const box = (await note.boundingBox())!;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Click to select, then drag
        await p.page.mouse.click(cx, cy);
        await p.page.mouse.move(cx, cy);
        await p.page.mouse.down();
        await p.page.mouse.move(cx + deltas[i][0], cy + deltas[i][1], { steps: 3 });
        await p.page.mouse.up();
      });

      await Promise.all(promises);

      // Wait for Yjs to converge across all participants
      await new Promise((r) => setTimeout(r, 1000));

      // All participants should see the same final state
      const snapshots = await Promise.all(participants.map((p) => p.boardSnapshot()));
      for (let i = 1; i < n; i++) {
        expect(snapshots[i]).toEqual(snapshots[0]);
      }
    } finally {
      for (const p of participants) await p.close();
    }
  });
});
