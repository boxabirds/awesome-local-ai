import { test, expect } from '@playwright/test';
import {
  openBoardPath,
  createNotesAt,
  getNotesState,
  dragScreen,
} from './helpers/board';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/**
 * Story 8 — Undo and redo E2E (TC-22, TC-23, TC-24).
 *
 * At the default camera (0,0,1) world coordinates equal screen coordinates,
 * so notes created at world (x, y) are centred on screen (x, y).
 * Note size is 200×200, so centres must be ≥ 200px apart to avoid overlap.
 */
test.describe('undo and redo my own changes (story 8, e2e)', () => {
  test('TC-22: recover an accidental delete while a colleague works', async ({ browser }) => {
    // Create a board
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const boardId = await openBoardPath(ctx1.request, page1);

    // Create a second context (Raj) on the same board
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`/b/${boardId}`);
    await expect(page2.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    // Mia creates 4 notes in a grid (spaced 250px apart to avoid overlap)
    const notes = await createNotesAt(page1, [
      { x: 200, y: 200 },
      { x: 450, y: 200 },
      { x: 200, y: 450 },
      { x: 450, y: 450 },
    ]);
    expect(notes).toHaveLength(4);

    // Wait for Raj to see the notes
    await expect.poll(async () => (await getNotesState(page2)).length, { timeout: 5000 }).toBe(4);

    // Mia selects all 4 notes (click first, shift-click others)
    await page1.mouse.click(200, 200);
    for (const pos of [{ x: 450, y: 200 }, { x: 200, y: 450 }, { x: 450, y: 450 }]) {
      await page1.keyboard.down('Shift');
      await page1.mouse.click(pos.x, pos.y);
      await page1.keyboard.up('Shift');
    }

    // Verify 4 selected
    await expect(page1.getByTestId('selection-count')).toHaveText('4 selected');

    // Mia deletes the selection
    await page1.getByTestId('delete-selection-button').click();

    // Wait for deletion to propagate
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(0);
    await expect.poll(async () => (await getNotesState(page2)).length, { timeout: 5000 }).toBe(0);

    // Raj adds a note
    await page2.mouse.dblclick(700, 700);
    await page2.getByTestId('sticky-textarea').waitFor();
    await page2.keyboard.type('Raj note');
    await page2.keyboard.press('Escape');

    // Wait for Raj's note to propagate to Mia
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(1);

    // Mia presses Ctrl+Z to undo the delete
    await page1.keyboard.press('Control+z');

    // The 4 notes should return on both screens (plus Raj's note = 5)
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(5);
    await expect.poll(async () => (await getNotesState(page2)).length, { timeout: 5000 }).toBe(5);

    // Raj's note should still exist
    const notes1 = await getNotesState(page1);
    const rajNote = notes1.find((n) => n.text === 'Raj note');
    expect(rajNote).toBeDefined();

    // Mia clicks the Redo button → the 4 disappear again
    await page1.getByTestId('redo-button').click();

    // The 4 notes should be gone again (only Raj's note remains)
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(1);
    await expect.poll(async () => (await getNotesState(page2)).length, { timeout: 5000 }).toBe(1);

    // Undo again to bring them back
    await page1.keyboard.press('Control+z');
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(5);

    // Mia's undo stack now has: [create 4 notes] (the delete was undone)
    // Redo stack has: [delete 4 notes]
    // Both buttons should be enabled
    await expect(page1.getByTestId('undo-button')).toBeEnabled();
    await expect(page1.getByTestId('redo-button')).toBeEnabled();

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-23: colleague deleted my object — undo shows no error', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const boardId = await openBoardPath(ctx1.request, page1);

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`/b/${boardId}`);
    await expect(page2.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    // Mia creates a note at center (300, 300) → top-left at (200, 200)
    const [a] = await createNotesAt(page1, [{ x: 300, y: 300 }]);

    // Wait for Raj to see it
    await expect.poll(async () => (await getNotesState(page2)).length, { timeout: 5000 }).toBe(1);

    // Mia moves the note by dragging from center (300, 300) to (380, 340)
    await dragScreen(page1, 300, 300, 80, 40);

    // Wait for the move to propagate (note top-left should be at 280, 240)
    await expect.poll(async () => {
      const notes = await getNotesState(page2);
      return notes.find((n) => n.id === a)?.x;
    }, { timeout: 5000 }).toBe(280);

    // Raj clicks the moved note (single note → note-toolbar appears) and deletes it
    await page2.waitForTimeout(200);
    const noteEl = page2.locator(`[data-note-id="${a}"]`);
    await noteEl.click();
    await expect(page2.getByTestId('note-toolbar')).toBeVisible({ timeout: 5000 });
    await page2.getByTestId('delete-note-button').click();

    // Wait for deletion to propagate
    await expect.poll(async () => (await getNotesState(page1)).length, { timeout: 5000 }).toBe(0);

    // Mia presses Ctrl+Z → no error, note stays absent
    const consoleErrors: string[] = [];
    page1.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page1.keyboard.press('Control+z');

    // Small wait to check for errors
    await page1.waitForTimeout(500);

    // No console errors
    expect(consoleErrors).toHaveLength(0);

    // Note is still absent on both screens
    expect((await getNotesState(page1)).length).toBe(0);
    expect((await getNotesState(page2)).length).toBe(0);

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-24: everyone undoing at once — each reverts only own changes', async ({ browser }) => {
    const contexts = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, async () => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        return { ctx, page };
      }),
    );

    // First context creates the board
    const boardId = await openBoardPath(contexts[0].ctx.request, contexts[0].page);

    // Other contexts navigate to the same board
    await Promise.all(
      contexts.slice(1).map(async ({ page }) => {
        await page.goto(`/b/${boardId}`);
        await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
      }),
    );

    // Each context creates its own note at a different position (spaced 300px apart)
    const positions = [
      { x: 200, y: 200 },
      { x: 500, y: 200 },
      { x: 800, y: 200 },
      { x: 200, y: 500 },
      { x: 500, y: 500 },
    ];

    const allNotes: string[][] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const notes = await createNotesAt(contexts[i].page, [positions[i]]);
      allNotes.push(notes);
    }

    // Wait for all notes to propagate to all contexts
    for (const { page } of contexts) {
      await expect.poll(async () => (await getNotesState(page)).length, { timeout: 10000 }).toBe(MAX_CONCURRENT_EDITORS);
    }

    // Record original positions (top-left = center - 100)
    const originalPositions = positions.map((p) => ({ x: p.x - 100, y: p.y - 100 }));

    // Each context moves its own note by dragging 60px right, 40px down
    await Promise.all(
      contexts.map(async ({ page }, i) => {
        await dragScreen(page, positions[i].x, positions[i].y, 60, 40);
      }),
    );

    // Wait for moves to propagate to all contexts
    for (const { page } of contexts) {
      await expect.poll(async () => {
        const notes = await getNotesState(page);
        // Check that at least one note has moved
        return notes.some((n) => {
          const idx = allNotes.findIndex((arr) => arr.includes(n.id));
          if (idx === -1) return false;
          return Math.abs(n.x - originalPositions[idx].x) > 10;
        });
      }, { timeout: 10000 }).resolves;
    }

    // All contexts press Ctrl+Z
    await Promise.all(
      contexts.map(async ({ page }) => {
        await page.keyboard.press('Control+z');
      }),
    );

    // Wait for undos to propagate
    await new Promise((r) => setTimeout(r, 1000));

    // Each context's own note should be reverted to original position
    // All boards should show the same notes
    const states = await Promise.all(contexts.map(({ page }) => getNotesState(page)));

    // All states should have the same notes
    for (let i = 1; i < states.length; i++) {
      expect(states[i].map((n) => n.id).sort()).toEqual(states[0].map((n) => n.id).sort());
    }

    // Each note should be back at its original position (within tolerance)
    const finalNotes = states[0];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const note = finalNotes.find((n) => n.id === allNotes[i][0]);
      expect(note).toBeDefined();
      // The note should be back at its original position (move was undone)
      // Allow 5px tolerance for CRDT concurrency
      expect(Math.abs(note!.x - originalPositions[i].x)).toBeLessThanOrEqual(5);
      expect(Math.abs(note!.y - originalPositions[i].y)).toBeLessThanOrEqual(5);
    }

    // Clean up
    await Promise.all(contexts.map(({ ctx }) => ctx.close()));
  });
});
