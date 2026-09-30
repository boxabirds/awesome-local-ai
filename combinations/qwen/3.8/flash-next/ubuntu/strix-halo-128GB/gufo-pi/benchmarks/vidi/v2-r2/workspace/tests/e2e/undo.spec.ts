import { test, expect } from '@playwright/test';
import {
  createParticipant,
  createBoardViaUi,
  getNoteCount,
  getBoardSnapshot,
  createNoteAtPoint,
  expectEventually,
  type Participant,
} from './helpers/participants';

/**
 * Get note positions keyed by data-object-id.
 */
async function getAllNotePositions(page: import('@playwright/test').Page): Promise<Array<{ id: string; x: number; y: number; text: string }>> {
  return page.evaluate(() => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    return Array.from(notes).map((n) => {
      const el = n as HTMLElement;
      const textEl = el.querySelector('.sticky-note-text') || el.querySelector('.sticky-textarea');
      const text = textEl && 'value' in textEl ? (textEl as HTMLTextAreaElement).value : textEl?.textContent ?? '';
      return {
        id: el.getAttribute('data-object-id') ?? 'unknown',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        text,
      };
    });
  });
}

/**
 * Create N notes by double-clicking at given screen positions.
 */
async function createNotes(page: import('@playwright/test').Page, positions: Array<{ x: number; y: number }>, text?: string[]): Promise<void> {
  for (let i = 0; i < positions.length; i++) {
    await page.mouse.dblclick(positions[i].x, positions[i].y);
    await page.waitForSelector('[data-testid="sticky-textarea"]');
    if (text && text[i]) {
      await page.keyboard.type(text[i]);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
}

// ============================================================
// TC-22: Recover an accidental delete while a colleague works
// ============================================================
test.describe('TC-22: Undo delete while colleague adds note', () => {
  let mia: Participant;
  let raj: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    boardId = await createBoardViaUi(p);
    await ctx.close();
    mia = await createParticipant(browser, boardId);
    raj = await createParticipant(browser, boardId);
  });

  test.afterEach(async () => {
    await mia.context.close();
    await raj.context.close();
  });

  test('Mia deletes 8 notes, Raj adds 1, Mia undoes → all restored', async () => {
    // Create 8 notes on Mia's screen
    const positions = Array.from({ length: 8 }, (_, i) => ({
      x: 100 + (i % 4) * 220,
      y: 100 + Math.floor(i / 4) * 220,
    }));
    const texts = Array.from({ length: 8 }, (_, i) => `Note ${i + 1}`);
    await createNotes(mia.page, positions, texts);

    // Wait for all 8 to sync to Raj
    await expectEventually(
      () => getNoteCount(raj.page),
      (count) => count === 8,
      'TC-22 initial sync',
    );

    // Record positions before delete
    const beforeDelete = await getAllNotePositions(mia.page);
    expect(beforeDelete.length).toBe(8);

    // Mia selects all (Ctrl+A) and deletes
    await mia.page.mouse.click(800, 700); // click empty area first
    await mia.page.waitForTimeout(100);
    await mia.page.keyboard.press('Control+a');
    await mia.page.waitForTimeout(100);
    await mia.page.keyboard.press('Delete');
    await mia.page.waitForTimeout(200);

    // Verify notes are deleted on Mia
    expect(await getNoteCount(mia.page)).toBe(0);

    // Raj adds a note while notes are gone
    await createNoteAtPoint(raj.page, 500, 400);
    await raj.page.keyboard.type('Raj was here');
    await raj.page.keyboard.press('Escape');

    // Wait for Raj's note to sync to Mia
    await expectEventually(
      () => getNoteCount(mia.page),
      (count) => count === 1,
      'TC-22 Raj note syncs to Mia',
    );

    // Mia presses Ctrl+Z to undo
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(500);

    // 8 notes should be back on Mia (plus Raj's note = 9)
    await expectEventually(
      () => getNoteCount(mia.page),
      (count) => count === 9,
      'TC-22 undo restores notes on Mia',
    );

    // Raj also sees 9 notes
    await expectEventually(
      () => getNoteCount(raj.page),
      (count) => count === 9,
      'TC-22 undo visible to Raj',
    );

    // Raj's note remains
    const rajNotes = await getAllNotePositions(raj.page);
    const rajNote = rajNotes.find((n) => n.text === 'Raj was here');
    expect(rajNote).toBeDefined();

    // Mia clicks the Redo button → 8 notes disappear again
    const redoBtn = mia.page.locator('button[aria-label="Redo"]');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await mia.page.waitForTimeout(500);

    // Only Raj's note remains on Mia
    await expectEventually(
      () => getNoteCount(mia.page),
      (count) => count === 1,
      'TC-22 redo removes notes on Mia',
    );

    // Raj also sees just 1 note
    await expectEventually(
      () => getNoteCount(raj.page),
      (count) => count === 1,
      'TC-22 redo visible to Raj',
    );
  });
});

// ============================================================
// TC-23: Colleague deleted my object → no error
// ============================================================
test.describe('TC-23: Undo move of note deleted by colleague', () => {
  let mia: Participant;
  let raj: Participant;
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    boardId = await createBoardViaUi(p);
    await ctx.close();
    mia = await createParticipant(browser, boardId);
    raj = await createParticipant(browser, boardId);
  });

  test.afterEach(async () => {
    await mia.context.close();
    await raj.context.close();
  });

  test('Mia moves note, Raj deletes it, Mia undoes → no error', async () => {
    // Create 3 notes
    await createNotes(mia.page, [
      { x: 300, y: 300 },
      { x: 550, y: 300 },
      { x: 800, y: 300 },
    ], ['A', 'B', 'C']);

    await expectEventually(
      () => getNoteCount(raj.page),
      (count) => count === 3,
      'TC-23 initial sync',
    );

    // Mia selects first note and moves it
    await mia.page.mouse.click(300, 300);
    await mia.page.waitForTimeout(100);
    await mia.page.mouse.move(300, 300);
    await mia.page.mouse.down();
    await mia.page.mouse.move(450, 450, { steps: 5 });
    await mia.page.mouse.up();
    await mia.page.waitForTimeout(200);

    // Raj deletes the first note (select it and delete)
    await raj.page.keyboard.press('Escape');
    await raj.page.waitForTimeout(50);
    // Click center of first note (it may have moved, so use the latest pos)
    await raj.page.mouse.click(300 + 100, 300 + 100);
    await raj.page.waitForTimeout(100);
    await raj.page.keyboard.press('Delete');
    await raj.page.waitForTimeout(200);

    // Wait for deletion to sync to Mia
    await expectEventually(
      () => getNoteCount(mia.page),
      (count) => count === 2,
      'TC-23 deletion syncs to Mia',
    );

    // Mia presses Ctrl+Z → should not throw, deleted note stays absent
    const errors: string[] = [];
    mia.page.on('pageerror', (err) => errors.push(err.message));

    // First undo: may target the move of A (which was removed from stack by Yjs)
    // or the next available step. Either way, no error.
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(500);

    // No errors
    expect(errors.length).toBe(0);

    // The deleted note (A) should NOT reappear
    const notes = await getAllNotePositions(mia.page);
    const noteA = notes.find((n) => n.text === 'A');
    expect(noteA).toBeUndefined();

    // Next undo still works (no crash)
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(300);
    expect(errors.length).toBe(0);
  });
});

// ============================================================
// TC-24: Everyone undoing at once
// ============================================================
test.describe('TC-24: Multiple editors undo own changes', () => {
  let participants: Participant[];
  let boardId: string;

  test.beforeEach(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    boardId = await createBoardViaUi(p);
    await ctx.close();

    const MAX = 5;
    participants = [];
    for (let i = 0; i < MAX; i++) {
      participants.push(await createParticipant(browser, boardId));
    }
  });

  test.afterEach(async () => {
    for (const p of participants) {
      await p.context.close();
    }
  });

  test('each participant undoes only their own changes', async () => {
    const count = participants.length;

    // Create one note per participant (each at a unique position)
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      await createNotes(p.page, [{ x: 100 + i * 200, y: 300 }], [`Note by ${i}`]);
      await p.page.waitForTimeout(50);
    }

    // All see all notes
    for (const p of participants) {
      await expectEventually(
        () => getNoteCount(p.page),
        (c) => c === count,
        `TC-24 all notes visible`,
      );
    }

    // Each participant moves their note (first undo step)
    const moveOffsets = Array.from({ length: count }, (_, i) => ({ dx: 50 + i * 10, dy: 50 }));
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      const targetX = 100 + i * 200;
      await p.page.mouse.click(targetX, 300);
      await p.page.waitForTimeout(50);
      await p.page.mouse.move(targetX, 300);
      await p.page.mouse.down();
      await p.page.mouse.move(targetX + moveOffsets[i].dx, 300 + moveOffsets[i].dy, { steps: 3 });
      await p.page.mouse.up();
      await p.page.waitForTimeout(100);
    }

    // Each types in their note (second undo step)
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      const targetX = 100 + i * 200 + moveOffsets[i].dx;
      const targetY = 300 + moveOffsets[i].dy;
      await p.page.mouse.dblclick(targetX, targetY);
      await p.page.waitForSelector('[data-testid="sticky-textarea"]');
      await p.page.keyboard.type('XYZ');
      await p.page.keyboard.press('Escape');
      await p.page.waitForTimeout(50);
    }

    // Wait for all to sync
    for (const p of participants) {
      await expectEventually(
        () => getNoteCount(p.page),
        (c) => c === count,
        'TC-24 all notes still there before undo',
      );
    }

    // Each participant undoes TWICE (their typing then their move)
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      await p.page.click('[data-testid="board-viewport"]');
      await p.page.waitForTimeout(50);
      await p.page.keyboard.press('Control+z');
      await p.page.waitForTimeout(100);
      await p.page.keyboard.press('Control+z');
      await p.page.waitForTimeout(100);
    }

    // Wait for sync
    await new Promise((r) => setTimeout(r, 2000));

    // All boards should be identical
    const snapshots = await Promise.all(
      participants.map((p) => getBoardSnapshot(p.page)),
    );

    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toBe(snapshots[0]);
    }

    // Each participant's own typing was reverted
    for (let i = 0; i < count; i++) {
      const p = participants[i];
      const notes = await getAllNotePositions(p.page);
      // Each note should still exist (count unchanged)
      expect(notes.length).toBe(count);
      // Text should be reverted to original (no XYZ)
      const withXYZ = notes.find((n) => n.text.includes('XYZ'));
      expect(withXYZ).toBeUndefined();
    }
  });
});
