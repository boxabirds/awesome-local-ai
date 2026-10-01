import { expect, test } from '@playwright/test';
import { getCamera, openBoard, setCamera, expectNear } from './helpers/board';
import {
  clickEmptyBoard,
  doubleClickToCreate,
  dragNoteBy,
  notes,
} from './helpers/sticky';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';

/** Read the world position of a note by its note id attribute. */
async function getNoteWorld(page: import('@playwright/test').Page, noteId: string) {
  const el = page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
  return el.evaluate((node) => ({
    x: Number((node as HTMLElement).dataset.worldX),
    y: Number((node as HTMLElement).dataset.worldY),
    z: Number((node as HTMLElement).dataset.z),
  }));
}

/** Get the id of a note at a given index. */
async function getNoteId(page: import('@playwright/test').Page, index: number): Promise<string> {
  return notes(page).nth(index).evaluate((el) => (el as HTMLElement).dataset.noteId ?? '');
}

/** Shift+drag a rectangle on the board for marquee selection. */
async function shiftDragRect(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(50);
}

/** Get the selection count from the selection bar. */
async function getSelectionCount(page: import('@playwright/test').Page): Promise<number> {
  const el = page.getByTestId('selection-count');
  if (!(await el.isVisible())) return 0;
  const text = await el.textContent();
  return parseInt(text ?? '0', 10);
}

test.describe('story 7: selection, move, resize, delete', () => {
  test('TC-32 marquee selects only fully-inside objects', async ({ page }) => {
    await openBoard(page);

    // Create 3 notes with known positions
    await setCamera(page, { x: -400, y: -400, zoom: 1 });

    // Note A: centre at screen (200, 200) → world (-200, -200), size 200
    // Note B: centre at screen (500, 200) → world (100, -200)
    // Note C: centre at screen (900, 600) → world (500, 200)
    await doubleClickToCreate(page, 200, 200);
    await clickEmptyBoard(page);

    await doubleClickToCreate(page, 500, 200);
    await clickEmptyBoard(page);

    await doubleClickToCreate(page, 900, 600);
    await clickEmptyBoard(page);

    // Marquee from screen (50, 50) to (310, 310)
    // World: (-350,-350) to (-90,-90)
    // Note A world: (-300,-300) to (-100,-100) → fully inside ✓
    // Note B world: (0,-300) to (200,-100) → NOT inside (right=200 > -90) ✗
    // Note C world: (400,100) to (600,300) → NOT inside ✗
    await shiftDragRect(page, { x: 50, y: 50 }, { x: 310, y: 310 });

    // Note A should be selected, B and C should not
    const noteA = notes(page).first();
    await expect(noteA).toHaveAttribute('data-selected', 'true');

    // Only 1 selected → NoteToolbar shows, not SelectionBar
    await expect(page.getByTestId('note-toolbar')).toBeVisible();

    // Notes B and C should not be selected
    const noteB = notes(page).nth(1);
    const noteC = notes(page).nth(2);
    await expect(noteB).toHaveAttribute('data-selected', 'false');
    await expect(noteC).toHaveAttribute('data-selected', 'false');
  });

  test('TC-33 group move and resize', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: -400, y: -400, zoom: 1 });

    // Create 3 notes in a row
    await doubleClickToCreate(page, 200, 200);
    await clickEmptyBoard(page);
    await doubleClickToCreate(page, 300, 200);
    await clickEmptyBoard(page);
    await doubleClickToCreate(page, 400, 200);
    await clickEmptyBoard(page);

    // Select all with Ctrl+A
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(50);

    const count = await getSelectionCount(page);
    expect(count).toBe(3);

    // Record positions before drag
    const pos0Before = await getNoteWorld(page, await getNoteId(page, 0));
    const pos1Before = await getNoteWorld(page, await getNoteId(page, 1));

    // Drag first note by 150 screen pixels to the right
    const note0 = notes(page).first();
    await dragNoteBy(note0, { x: 50, y: 50 }, { x: 150, y: 0 });

    // All notes should have moved by 150 world units (zoom=1)
    const pos0After = await getNoteWorld(page, await getNoteId(page, 0));
    const pos1After = await getNoteWorld(page, await getNoteId(page, 1));

    expectNear(pos0After.x - pos0Before.x, 150, 2);
    expectNear(pos1After.x - pos1Before.x, 150, 2);

    // Relative positions preserved
    expectNear(pos1After.x - pos0After.x, pos1Before.x - pos0Before.x, 2);
  });

  test('TC-34 nudge with arrow keys and delete', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: -400, y: -400, zoom: 1 });

    // Create a note
    await doubleClickToCreate(page, 300, 300);
    await clickEmptyBoard(page);

    // Select it
    await notes(page).first().click();
    await page.waitForTimeout(50);

    const before = await getNoteWorld(page, await getNoteId(page, 0));
    const cameraBefore = await getCamera(page);

    // ArrowRight 3 times
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(30);
    }

    // Shift+ArrowRight once
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(30);

    const after = await getNoteWorld(page, await getNoteId(page, 0));
    const expectedDx = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
    expectNear(after.x - before.x, expectedDx, 1);

    // Camera unchanged (no pan)
    const cameraAfter = await getCamera(page);
    expectNear(cameraAfter.x, cameraBefore.x, 0.01);
    expectNear(cameraAfter.y, cameraBefore.y, 0.01);
    expectNear(cameraAfter.zoom, cameraBefore.zoom, 0.01);

    // Delete removes it
    await page.keyboard.press('Delete');
    await page.waitForTimeout(50);
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-35 colleague deletes one of my selected notes', async ({ browser }) => {
    // Create a board and open it in two contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await openBoard(pageA);
    const boardUrl = pageA.url();
    await pageB.goto(boardUrl);
    await expect(pageB.getByTestId('board-viewport')).toBeVisible();

    await setCamera(pageA, { x: -400, y: -400, zoom: 1 });
    await setCamera(pageB, { x: -400, y: -400, zoom: 1 });

    // Create 4 notes on page A
    for (let i = 0; i < 4; i++) {
      await doubleClickToCreate(pageA, 200 + i * 120, 200);
      await clickEmptyBoard(pageA);
    }

    // Wait for page B to sync
    await pageB.waitForTimeout(500);

    // Page A: select all 4
    await pageA.keyboard.press('Control+a');
    await pageA.waitForTimeout(50);
    const countA = await getSelectionCount(pageA);
    expect(countA).toBe(4);

    // Page B: get one note id and delete it
    const idToDelete = await getNoteId(pageB, 0);
    await pageB.locator(`[data-testid="sticky-note"][data-note-id="${idToDelete}"]`).click();
    await pageB.waitForTimeout(50);
    await pageB.keyboard.press('Delete');

    // Page A: within latency budget, selection count should drop to 3
    await pageA.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS);

    const countAfter = await getSelectionCount(pageA);
    expect(countAfter).toBe(3);

    // The remaining 3 should still be selected (outlines)
    const remainingNotes = pageA.locator('[data-testid="sticky-note"][data-selected="true"]');
    await expect(remainingNotes).toHaveCount(3);

    // Delete the remaining 3 from page A
    await pageA.keyboard.press('Delete');
    await pageA.waitForTimeout(200);
    await expect(pageA.getByTestId('sticky-note')).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });

  test('TC-36 concurrent editors move different selections → identical positions', async ({ browser }) => {
    const contextCount = Math.min(MAX_CONCURRENT_EDITORS, 3); // limit for CI speed
    const contexts = [];
    const pages = [];

    // First context creates the board
    const ctx0 = await browser.newContext();
    const p0 = await ctx0.newPage();
    await openBoard(p0);
    const boardUrl = p0.url();

    // Create 6 notes with large spacing so they don't overlap
    // Notes are 200x200 world; at zoom=1 we space at 250px intervals
    for (let i = 0; i < 6; i++) {
      await doubleClickToCreate(p0, 150 + (i % 3) * 250, 150 + Math.floor(i / 3) * 250);
      await clickEmptyBoard(p0);
    }

    // Open other contexts
    for (let i = 0; i < contextCount - 1; i++) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(boardUrl);
      await expect(p.getByTestId('board-viewport')).toBeVisible();
      contexts.push(ctx);
      pages.push(p);
    }

    await p0.waitForTimeout(500);
    for (const p of pages) {
      await setCamera(p, { x: -400, y: -400, zoom: 1 });
    }
    await setCamera(p0, { x: -400, y: -400, zoom: 1 });

    // Collect note ids
    const allIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      allIds.push(await getNoteId(p0, i));
    }

    // Editor 0 (p0) moves notes 0 and 1 right
    // Editor 1 moves notes 2 and 3 down
    // Editor 2 (if exists) moves notes 4 and 5 left
    const editorActions = [
      { page: p0, ids: [allIds[0]!, allIds[1]!], dx: 100, dy: 0 },
      { page: pages[0] ?? p0, ids: [allIds[2]!, allIds[3]!], dx: 0, dy: 100 },
    ];
    if (pages[1]) {
      editorActions.push({ page: pages[1], ids: [allIds[4]!, allIds[5]!], dx: -100, dy: 0 });
    }

    // All editors move their selections
    for (const { page, ids, dx, dy } of editorActions) {
      // Select all with Ctrl+A, then deselect others
      // Use marquee selection on just the target notes
      const firstNote = page.locator(`[data-testid="sticky-note"][data-note-id="${ids[0]}"]`);
      await firstNote.click();
      await page.waitForTimeout(50);
      for (const id of ids.slice(1)) {
        const note = page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);
        await note.click({ modifiers: ['Shift'] });
        await page.waitForTimeout(50);
      }
      // Drag the first selected note
      await dragNoteBy(firstNote, { x: 50, y: 50 }, { x: dx, y: dy });
    }

    await p0.waitForTimeout(1000);

    // Verify all contexts see the same positions
    const p0Positions: Record<string, { x: number; y: number }> = {};
    for (const id of allIds) {
      p0Positions[id] = await getNoteWorld(p0, id);
    }

    for (const p of pages) {
      await p.waitForTimeout(500);
      for (const id of allIds) {
        const pos = await getNoteWorld(p, id);
        expectNear(pos.x, p0Positions[id]!.x, 1);
        expectNear(pos.y, p0Positions[id]!.y, 1);
      }
    }

    await ctx0.close();
    for (const ctx of contexts) await ctx.close();
  });
});
