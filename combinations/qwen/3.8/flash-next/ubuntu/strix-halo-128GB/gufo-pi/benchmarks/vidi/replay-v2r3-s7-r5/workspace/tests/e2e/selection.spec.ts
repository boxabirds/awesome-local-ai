import { test, expect, type Page } from '@playwright/test';
import {
  getBoard,
  getNote,
  noteBox,
  createNoteAt,
  selectNote,
  dragNote,
  setCamera,
  getOriginMarkerPosition,
  shiftClickNote,
  getSelectedIds,
  getSelectionCountText,
  clickDeleteSelection,
  marqueeDrag,
  dragHandle,
  pressKey,
  nudgeSelection,
  endEditing,
  typeIntoNote,
} from './helpers/board';

test.describe('Story 7: Select, move, resize and delete several objects at once', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/boards');
    const { id } = await res.json();
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-32: drag note A by (60,40) screen px → doc x/y changes by 60/40', async ({ page }) => {
    // Create a note
    const note = await createNoteAt(page, 400, 300);
    await endEditing(page);
    const before = await getNote(page, note.id);
    expect(before).toBeDefined();

    // Drag it by 60px right, 40px down
    await dragNote(page, note.id, 60, 40);

    const after = await getNote(page, note.id);
    expect(after).toBeDefined();
    // At zoom=1, 1 screen px = 1 world unit
    expect(Math.abs(after!.x - before!.x - 60)).toBeLessThan(2);
    expect(Math.abs(after!.y - before!.y - 40)).toBeLessThan(2);
  });

  test('TC-33: drag one of two overlapping notes → only it moves', async ({ page }) => {
    // Create two notes, far apart first (200px world units = each note occupies 200px)
    const note1 = await createNoteAt(page, 300, 250);
    await endEditing(page);
    const note2 = await createNoteAt(page, 600, 250);
    await endEditing(page);

    // Drag note2
    await dragNote(page, note2.id, 30, 20);

    // Verify note2 moved
    const after2 = await getNote(page, note2.id);
    expect(Math.abs(after2!.x - note2.x - 30)).toBeLessThan(2);
    expect(Math.abs(after2!.y - note2.y - 20)).toBeLessThan(2);

    // Verify note1 did not move
    const after1 = await getNote(page, note1.id);
    expect(after1!.x).toBeCloseTo(note1.x, 1);
    expect(after1!.y).toBeCloseTo(note1.y, 1);
  });

  test('TC-34: shift-click toggles, Ctrl+A selects all, Delete removes', async ({ page }) => {
    // Create 3 notes
    const a = await createNoteAt(page, 200, 300);
    await endEditing(page);
    const b = await createNoteAt(page, 400, 300);
    await endEditing(page);
    const c = await createNoteAt(page, 600, 300);
    await endEditing(page);

    // Select a, then shift-click b → selection {a, b}
    await selectNote(page, a.id);
    await shiftClickNote(page, b.id);
    let sel = await getSelectedIds(page);
    expect(sel).toContain(a.id);
    expect(sel).toContain(b.id);
    expect(sel).not.toContain(c.id);

    // Shift-click b again → toggle off
    await shiftClickNote(page, b.id);
    sel = await getSelectedIds(page);
    expect(sel).toContain(a.id);
    expect(sel).not.toContain(b.id);

    // Ctrl+A → select all
    await pressKey(page, 'a', ['Control']);
    sel = await getSelectedIds(page);
    expect(sel.length).toBe(3);

    // Press Delete
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // All notes should be gone
    const board = await getBoard(page);
    expect(board.length).toBe(0);

    // Selection should be empty
    sel = await getSelectedIds(page);
    expect(sel.length).toBe(0);
  });

  test('TC-35: remote delete prunes selection', async ({ page, context }) => {
    // Create 2 notes
    const a = await createNoteAt(page, 200, 300);
    await endEditing(page);
    const b = await createNoteAt(page, 400, 300);
    await endEditing(page);

    // Select both via shift-click
    await selectNote(page, a.id);
    await shiftClickNote(page, b.id);
    let sel = await getSelectedIds(page);
    expect(sel.length).toBe(2);

    // Open second page to same board (remote collaborator)
    const page2 = await context.newPage();
    await page2.goto(page.url());
    await page2.waitForSelector('[data-testid="board-viewport"]');
    // Wait for sync
    await page2.waitForTimeout(500);

    // Delete note 'a' from page2
    await page2.evaluate((noteId) => {
      const doc = (window as any).__vidi6?.doc;
      if (doc) {
        const objects = doc.getMap('objects');
        objects.delete(noteId);
      }
    }, a.id);

    // Wait for sync to propagate
    await page.waitForTimeout(1000);

    // Verify a is deleted on page1
    const board = await getBoard(page);
    expect(board.find((n) => n.id === a.id)).toBeUndefined();

    // Selection should have pruned 'a', leaving only 'b'
    sel = await getSelectedIds(page);
    expect(sel).not.toContain(a.id);
    expect(sel).toContain(b.id);

    await page2.close();
  });

  test('TC-36: cluster of two notes → marquee, multi-select bar, delete', async ({ page }) => {
    // Create two notes near each other (but not overlapping for creation)
    const a = await createNoteAt(page, 200, 250);
    await endEditing(page);
    const b = await createNoteAt(page, 450, 300);
    await endEditing(page);

    // Shift+drag a marquee that covers both notes
    const boxA = await noteBox(page, a.id);
    const boxB = await noteBox(page, b.id);

    // Marquee from top-left to bottom-right, with some padding
    const fromX = Math.min(boxA.x, boxB.x) - 15;
    const fromY = Math.min(boxA.y, boxB.y) - 15;
    const toX = Math.max(boxA.x + boxA.width, boxB.x + boxB.width) + 15;
    const toY = Math.max(boxA.y + boxA.height, boxB.y + boxB.height) + 15;

    await marqueeDrag(page, { x: fromX, y: fromY }, { x: toX, y: toY });

    // Verify selection bar shows "2 selected"
    const countText = await getSelectionCountText(page);
    expect(countText).toBe('2 selected');

    // Verify aria-live
    const countEl = page.getByTestId('selection-count');
    await expect(countEl).toHaveAttribute('aria-live', 'polite');

    // Click Delete button
    await clickDeleteSelection(page);

    // Verify both notes are deleted
    await page.waitForTimeout(200);
    const board = await getBoard(page);
    expect(board.find((n) => n.id === a.id)).toBeUndefined();
    expect(board.find((n) => n.id === b.id)).toBeUndefined();

    // Verify selection is empty (no bar)
    const countAfter = await getSelectionCountText(page);
    expect(countAfter).toBeNull();
  });

  test('resize handle changes note dimensions', async ({ page }) => {
    // Create a single note
    const a = await createNoteAt(page, 400, 300);
    await endEditing(page);

    // Click to select it
    await selectNote(page, a.id);

    // Drag bottom-right handle to resize by (50,50)
    await dragHandle(page, 'bottom-right', 50, 50);

    // Get new dimensions
    const after = await getNote(page, a.id);
    expect(after!.width).toBeGreaterThan(200);
    expect(after!.height).toBeGreaterThan(200);
    expect(Math.abs(after!.width - 250)).toBeLessThan(3);
    expect(Math.abs(after!.height - 250)).toBeLessThan(3);
  });
});
