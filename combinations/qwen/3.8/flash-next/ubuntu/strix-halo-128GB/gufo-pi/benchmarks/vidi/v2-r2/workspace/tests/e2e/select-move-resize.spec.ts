import { test, expect } from '@playwright/test';
import {
  gotoBoard,
  getNoteScreenPos,
  getNoteCount,
  setCamera,
} from './helpers/board';
import {
  createBoardViaUi,
  createParticipant,
  getBoardSnapshot,
  expectEventually,
} from './helpers/participants';

const STICKY_SIZE = 200; // STICKY_SIZE_WORLD

/**
 * Get note positions keyed by data-object-id.
 */
async function getAllNotePositions(page: import('@playwright/test').Page): Promise<Map<string, { x: number; y: number }>> {
  const arr = await page.evaluate(() => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    return Array.from(notes).map((n) => {
      const el = n as HTMLElement;
      return {
        id: el.getAttribute('data-object-id') ?? 'unknown',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
      };
    });
  });
  return new Map(arr.map((o) => [o.id, { x: o.x, y: o.y }]));
}

/**
 * Get selected note IDs.
 */
async function getSelectedIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[data-selected="true"]');
    return Array.from(notes).map((n) => (n as HTMLElement).getAttribute('data-object-id') ?? '');
  });
}

// TC-32: Shift+drag marquee - only fully-inside objects selected
test.describe('TC-32: Marquee select', () => {
  test('selects only fully-inside objects', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Place notes:
    // A at screen (50,50) - occupies (50,50)-(250,250) - fully inside (0,0)-(300,300)
    // B at screen (250,250) - occupies (250,250)-(450,450) - half outside
    // C at screen (500,500) - fully outside
    await page.mouse.dblclick(50 + STICKY_SIZE / 2, 50 + STICKY_SIZE / 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.mouse.dblclick(250 + STICKY_SIZE / 2, 250 + STICKY_SIZE / 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.mouse.dblclick(500 + STICKY_SIZE / 2, 500 + STICKY_SIZE / 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    expect(await getNoteCount(page)).toBe(3);

    // Click empty space to clear selection, then marquee
    await page.mouse.click(1200, 700);

    // Shift+drag from (10,10) to (300,300) - should only select A (which is at 50-250)
    await page.keyboard.down('Shift');
    await page.mouse.move(10, 10);
    await page.mouse.down();
    await page.mouse.move(300, 300, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Only A should be selected (has data-selected="true")
    const selectedIds = await getSelectedIds(page);
    expect(selectedIds.length).toBe(1);
  });
});

// TC-33: Group move 6 notes together
test.describe('TC-33: Group move', () => {
  test('6 notes move together by same delta', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Create 6 notes in a grid (3x2, 250 apart) + 1 unselected at (1000,100)
    const positions = [
      { x: 50, y: 50 }, { x: 300, y: 50 }, { x: 550, y: 50 },
      { x: 50, y: 300 }, { x: 300, y: 300 }, { x: 550, y: 300 },
    ];
    for (const pos of positions) {
      await page.mouse.dblclick(pos.x + STICKY_SIZE / 2, pos.y + STICKY_SIZE / 2);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
    // 7th note far away
    await page.mouse.dblclick(1000 + STICKY_SIZE / 2, 100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    expect(await getNoteCount(page)).toBe(7);

    // Click empty space to clear selection
    await page.mouse.click(1200, 700);

    // Select first 6 by marquee (Shift+drag around them but not the 7th at x=1000)
    await page.keyboard.down('Shift');
    await page.mouse.move(0, 0);
    await page.mouse.down();
    await page.mouse.move(780, 530, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Verify 6 selected
    await expect(page.getByText('6 selected')).toBeVisible();

    // Get the IDs of selected notes
    const selectedIds = await getSelectedIds(page);
    expect(selectedIds.length).toBe(6);

    // Record positions BEFORE move (keyed by id)
    const beforePos = await getAllNotePositions(page);

    // Drag one selected note by 300px right
    // Get screen position of the first selected note
    const firstSelectedPos = await page.evaluate(() => {
      const notes = document.querySelectorAll('[data-selected="true"]');
      const el = notes[0] as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });

    await page.mouse.move(firstSelectedPos.x + 50, firstSelectedPos.y + 50);
    await page.mouse.down();
    await page.mouse.move(firstSelectedPos.x + 50 + 300, firstSelectedPos.y + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Check all 6 moved by the same delta
    const afterPos = await getAllNotePositions(page);

    for (const id of selectedIds) {
      const before = beforePos.get(id)!;
      const after = afterPos.get(id)!;
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      // All deltas should be approximately the same
      if (id === selectedIds[0]) {
        // The dragged note - check it moved approximately 300 right
        expect(dx).toBeGreaterThan(250);
        expect(Math.abs(dy)).toBeLessThan(5);
      } else {
        // Others moved same delta as first
        const firstDx = afterPos.get(selectedIds[0])!.x - beforePos.get(selectedIds[0])!.x;
        const firstDy = afterPos.get(selectedIds[0])!.y - beforePos.get(selectedIds[0])!.y;
        expect(Math.abs(dx - firstDx)).toBeLessThan(2);
        expect(Math.abs(dy - firstDy)).toBeLessThan(2);
      }
    }

    // Verify 7th note did NOT move
    const allPositions = await getAllNotePositions(page);
    const allIds = [...allPositions.keys()];
    const unselectedId = allIds.find((id) => !selectedIds.includes(id))!;
    const unBefore = beforePos.get(unselectedId)!;
    const unAfter = allPositions.get(unselectedId)!;
    expect(unBefore.x).toBeCloseTo(unAfter.x, 0);
    expect(unBefore.y).toBeCloseTo(unAfter.y, 0);
  });
});

// TC-34: Arrow key nudging and Delete
test.describe('TC-34: Nudge and Delete', () => {
  test('arrows move without scroll; Delete removes all', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Create 6 notes
    const positions = [
      { x: 50, y: 50 }, { x: 300, y: 50 }, { x: 550, y: 50 },
      { x: 50, y: 300 }, { x: 300, y: 300 }, { x: 550, y: 300 },
    ];
    for (const pos of positions) {
      await page.mouse.dblclick(pos.x + STICKY_SIZE / 2, pos.y + STICKY_SIZE / 2);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    expect(await getNoteCount(page)).toBe(6);

    // Click empty space to clear selection
    await page.mouse.click(1200, 700);

    // Select all 6
    await page.keyboard.down('Shift');
    await page.mouse.move(0, 0);
    await page.mouse.down();
    await page.mouse.move(780, 530, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByText('6 selected')).toBeVisible();

    // Record initial position by ID
    const selectedIds = await getSelectedIds(page);
    const beforePos = await getAllNotePositions(page);
    const firstId = selectedIds[0];

    // ArrowRight x3 = NUDGE_STEP_WORLD * 3 = 3
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Shift+ArrowRight = NUDGE_LARGE_STEP_WORLD = 10
    await page.keyboard.press('Shift+ArrowRight');

    const afterPos = await getAllNotePositions(page);
    const totalNudge = 3 + 10; // NUDGE_STEP_WORLD*3 + NUDGE_LARGE_STEP_WORLD
    expect(afterPos.get(firstId)!.x - beforePos.get(firstId)!.x).toBeCloseTo(totalNudge, 0);

    // Verify no page scroll
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Delete removes all selected
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    expect(await getNoteCount(page)).toBe(0);
  });
});

// TC-35: Remote delete prunes selection
test.describe('TC-35: Remote delete prunes selection', () => {
  test('colleague deletes one note, selection count drops', async ({ browser }) => {
    // Create board with stickies
    const leePage = await browser.newPage();
    const boardId = await createBoardViaUi(leePage);

    await setCamera(leePage, { x: 0, y: 0, zoom: 1 });
    // Create 4 notes
    for (let i = 0; i < 4; i++) {
      await leePage.mouse.dblclick(50 + i * 250 + STICKY_SIZE / 2, 200 + STICKY_SIZE / 2);
      await leePage.keyboard.press('Escape');
      await leePage.waitForTimeout(100);
    }

    // Click empty space to clear selection
    await leePage.mouse.click(1200, 700);

    await leePage.keyboard.down('Shift');
    await leePage.mouse.move(0, 0);
    await leePage.mouse.down();
    await leePage.mouse.move(1200, 500, { steps: 10 });
    await leePage.mouse.up();
    await leePage.keyboard.up('Shift');

    await expect(leePage.getByText('4 selected')).toBeVisible();

    // Sam joins the same board
    const sam = await createParticipant(browser, boardId);

    // Sam clicks the first note and deletes it
    const firstNoteScreen = await getNoteScreenPos(sam.page, 0);
    await sam.page.mouse.click(firstNoteScreen.x + 50, firstNoteScreen.y + 50);
    await sam.page.keyboard.press('Delete');

    // Lee should see "3 selected"
    await expectEventually(
      async () => leePage.getByText('3 selected').isVisible().catch(() => false),
      (v) => v === true,
      'Lee sees 3 selected after Sam deletes one',
    );

    // Now Lee deletes remaining 3
    await leePage.keyboard.press('Delete');
    await leePage.waitForTimeout(500);
    expect(await getNoteCount(leePage)).toBe(0);

    await sam.context.close();
    await leePage.close();
  });
});

// TC-36: Full-capacity reorganisation
test.describe('TC-36: Full-capacity concurrent moves', () => {
  test('multiple concurrent editors move different selections -> identical final positions', async ({ browser }) => {
    const MAX_EDITORS = 5;

    // Create board
    const initPage = await browser.newPage();
    const boardId = await createBoardViaUi(initPage);

    // Create 5 notes (one per editor)
    await setCamera(initPage, { x: 0, y: 0, zoom: 1 });
    for (let i = 0; i < MAX_EDITORS; i++) {
      await initPage.mouse.dblclick(50 + i * 250 + STICKY_SIZE / 2, 300 + STICKY_SIZE / 2);
      await initPage.keyboard.press('Escape');
      await initPage.waitForTimeout(100);
    }
    await initPage.close();

    // Create MAX_CONCURRENT_EDITORS contexts
    const participants = [];
    for (let i = 0; i < MAX_EDITORS; i++) {
      const p = await createParticipant(browser, boardId);
      participants.push(p);
      await setCamera(p.page, { x: 0, y: 0, zoom: 1 });
    }

    // Each editor clicks their note (index i) to select it
    const selectPromises = participants.map(async (p, i) => {
      const screenPos = await getNoteScreenPos(p.page, i);
      await p.page.mouse.click(screenPos.x + 50, screenPos.y + 50);
      await p.page.waitForTimeout(100);
    });
    await Promise.all(selectPromises);

    // Drag each note 100px right
    const dragPromises = participants.map(async (p, i) => {
      const screenPos = await getNoteScreenPos(p.page, i);
      await p.page.mouse.move(screenPos.x + 50, screenPos.y + 50);
      await p.page.mouse.down();
      await p.page.mouse.move(screenPos.x + 150, screenPos.y + 50, { steps: 3 });
      await p.page.mouse.up();
    });
    await Promise.all(dragPromises);

    // Wait for convergence
    await new Promise((r) => setTimeout(r, 3000));

    // All participants should see the same final state
    const snapshots = await Promise.all(
      participants.map((p) => getBoardSnapshot(p.page)),
    );

    // All snapshots should be identical
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBe(snapshots[0]);
    }

    // Cleanup
    for (const p of participants) {
      await p.context.close();
    }
  });
});
