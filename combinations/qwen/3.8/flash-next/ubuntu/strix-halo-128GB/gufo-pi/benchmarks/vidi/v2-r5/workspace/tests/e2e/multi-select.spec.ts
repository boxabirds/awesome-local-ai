import { expect, test, type Page } from '@playwright/test';
import {
  STICKY_SIZE_WORLD,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  noteLocator,
  noteCentre,
  openBoard,
  readCamera,
  readNotes,
  setCamera,
  waitForSettled,
} from './helpers/board';
import {
  openPair,
  openParticipants,
  closeParticipants,
  readBoardNotes,
  expectEventually,
  createNoteViaToolbar,
} from './helpers/participants';
import { newBoardId } from '../../src/shared/board-id';

/* ---- Multi-selection helpers ---- */

/** Create a note at a specific screen position by double-clicking. */
async function createNoteAt(page: Page, screenX: number, screenY: number): Promise<string> {
  const before = await readNotes(page);
  await page.mouse.dblclick(screenX, screenY);
  await expect(page.getByTestId('sticky-note-editor')).toBeVisible();
  // Dismiss the editor by pressing Escape
  await page.keyboard.press('Escape');
  await waitForSettled(page);
  const after = await readNotes(page);
  const created = after.find((n) => !before.some((b) => b.id === n.id));
  if (!created) throw new Error(`No note created at (${screenX},${screenY})`);
  return created.id;
}

/** Shift-click a note to toggle it in the selection. */
async function shiftClickNote(page: Page, id: string): Promise<void> {
  const at = await noteCentre(page, id);
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
  await waitForSettled(page);
}

/** Shift+drag a marquee rectangle on the viewport. */
async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await waitForSettled(page);
}

/** Read the selection count from the SelectionBar (visible when 2+ selected). */
async function getSelectionCount(page: Page): Promise<number | null> {
  const bar = page.getByTestId('selection-bar');
  if (!(await bar.isVisible().catch(() => false))) return null;
  const text = await page.getByTestId('selection-count').textContent();
  const match = /(\d+)\s+selected/.exec(text ?? '');
  return match ? Number(match[1]) : null;
}

/** Check if a note is selected via data-selected attribute. */
async function isSelected(page: Page, id: string): Promise<boolean> {
  return (await noteLocator(page, id).getAttribute('data-selected')) === 'true';
}

/** Drag a note by (dx, dy) screen pixels from its centre. */
async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  await waitForSettled(page);
}

test.describe('Multi-select: marquee (TC-32)', () => {
  test('TC-32: Shift+drag selects only fully-inside notes', async ({ page }) => {
    await openBoard(page);

    // Camera default: x=-640, y=-400, zoom=1 (1280x800 viewport)
    // World to screen: screen = (world - camera) * zoom = world + 640, world + 400
    // Note size: 200 world units (STICKY_SIZE_WORLD)

    // Note A: fully inside the marquee → center at screen (400, 300)
    const noteA = await createNoteAt(page, 400, 300);

    // Note B: partially inside → position so its left edge is just inside marquee
    // Create at screen (700, 300) → center at world (60, -100), bounds (60,-100) to (260,100) world → screen (700,300) to (900,500)
    const noteB = await createNoteAt(page, 700, 300);

    // Note C: fully outside → center at screen (1100, 600)
    const noteC = await createNoteAt(page, 1100, 600);

    // Dismiss any selection
    await page.mouse.click(50, 50);
    await waitForSettled(page);

    // Marquee: drag a rectangle that fully contains note A but only partially covers note B
    // Note A bounds in screen: center (400,300), size 200x200 → (300, 200) to (500, 400)
    // We draw marquee from (250, 150) to (550, 450) → A fully inside, B starts at 700 so B outside
    await marqueeDrag(page, 250, 150, 550, 450);

    expect(await isSelected(page, noteA)).toBe(true);
    expect(await isSelected(page, noteB)).toBe(false);
    expect(await isSelected(page, noteC)).toBe(false);
  });
});

test.describe('Multi-select: group drag and resize (TC-33)', () => {
  test('TC-33: select 6 notes, drag one → all move; resize handle → proportional', async ({ page }) => {
    await openBoard(page);

    // Create 6 notes in a cluster
    const notes: string[] = [];
    const positions = [
      { x: 300, y: 250 }, { x: 520, y: 250 }, { x: 740, y: 250 },
      { x: 300, y: 470 }, { x: 520, y: 470 }, { x: 740, y: 470 },
    ];
    for (const pos of positions) {
      const id = await createNoteAt(page, pos.x, pos.y);
      notes.push(id);
    }

    // Dismiss selection
    await page.mouse.click(50, 700);
    await waitForSettled(page);

    // Select all 6 using Ctrl+A
    await page.keyboard.press('Control+a');
    await waitForSettled(page);

    // Verify selection count is 6
    const count = await getSelectionCount(page);
    expect(count).toBe(6);

    // Record positions before drag
    const before = await readNotes(page);
    const beforeMap = new Map(before.map((n) => [n.id, { x: n.x, y: n.y }]));

    // Drag one note by 300 screen pixels right (= 300 world units at zoom 1)
    await dragNote(page, notes[0]!, 300, 0);

    // All 6 should have moved by approximately 300 world units
    const after = await readNotes(page);
    for (const id of notes) {
      const b = beforeMap.get(id)!;
      const a = after.find((n) => n.id === id)!;
      expect(a.x - b.x).toBeCloseTo(300, -1);
      expect(a.y - b.y).toBeCloseTo(0, -1);
    }

    // Test resize: select all again, then use SE handle
    await page.keyboard.press('Control+a');
    await waitForSettled(page);

    // Find SE resize handle
    const seHandle = page.getByLabel('Resize bottom-right');
    await expect(seHandle).toBeVisible();

    // Record dimensions before resize (use readBoardNotes which includes width/height)
    const beforeResize = await readBoardNotes(page);
    const origWidth = beforeResize[0]!.width ?? STICKY_SIZE_WORLD;

    // Drag SE handle outward by 100px in both directions
    const handleBox = await seHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 100, handleBox!.y + handleBox!.height / 2 + 100, { steps: 5 });
    await page.mouse.up();
    await waitForSettled(page);

    // After resize, notes should be larger (aspect-locked → both dims increase equally)
    const afterResize = await readBoardNotes(page);
    const newWidth = afterResize[0]!.width ?? STICKY_SIZE_WORLD;
    expect(newWidth).toBeGreaterThan(origWidth);
  });
});

test.describe('Multi-select: keyboard (TC-34)', () => {
  test('TC-34: ArrowRight ×3 + Shift+ArrowRight + Delete', async ({ page }) => {
    await openBoard(page);

    // Create 6 notes
    const notes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await createNoteAt(page, 300 + i * 120, 300);
      notes.push(id);
    }

    // Dismiss selection
    await page.mouse.click(50, 700);
    await waitForSettled(page);

    // Select all
    await page.keyboard.press('Control+a');
    await waitForSettled(page);
    expect(await getSelectionCount(page)).toBe(6);

    // Record positions
    const cameraBefore = await readCamera(page);
    const before = await readNotes(page);
    const x0 = new Map(before.map((n) => [n.id, n.x]));
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // ArrowRight ×3
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await waitForSettled(page);

    // Shift+ArrowRight (large nudge)
    await page.keyboard.press('Shift+ArrowRight');
    await waitForSettled(page);

    // All notes should have moved by 3*NUDGE_STEP + 1*NUDGE_LARGE_STEP in x
    const expectedDx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    const after = await readNotes(page);
    for (const id of notes) {
      const x = after.find((n) => n.id === id)!.x;
      expect(x).toBeCloseTo(x0.get(id)! + expectedDx, 5);
    }

    // Camera and scroll unchanged
    expect(await readCamera(page)).toEqual(cameraBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Delete removes all 6
    await page.keyboard.press('Delete');
    await waitForSettled(page);
    const remaining = await readNotes(page);
    expect(remaining).toHaveLength(0);
    expect(await getSelectionCount(page)).toBeNull();
  });
});

test.describe('Multi-select: remote delete (TC-35)', () => {
  test('TC-35: colleague deletes one of my selected notes → selection pruned', async ({ browser }) => {
    const boardId = newBoardId();
    const [lee, sam] = await openPair(browser, boardId);

    try {
      // Create 4 notes on Lee's page
      const noteIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = await createNoteViaToolbar(lee.page);
        noteIds.push(id);
      }

      // Move notes apart so they are clickable
      await setCamera(lee.page, { x: -640, y: -400, zoom: 0.5 });
      await waitForSettled(lee.page);

      // Select all 4 with Ctrl+A
      await lee.page.keyboard.press('Control+a');
      await waitForSettled(lee.page);

      // Selection bar shows "4 selected"
      const count = await getSelectionCount(lee.page);
      expect(count).toBe(4);

      // Sam selects and deletes one of the notes
      const targetId = noteIds[1]!;
      await setCamera(sam.page, { x: -640, y: -400, zoom: 0.5 });
      await waitForSettled(sam.page);

      // Click the note and delete it
      const noteEl = noteLocator(sam.page, targetId);
      await expect(noteEl).toBeVisible({ timeout: 5000 });
      await noteEl.click();
      await waitForSettled(sam.page);
      await sam.page.keyboard.press('Delete');
      await waitForSettled(sam.page);

      // Lee's selection bar should update to "3 selected" (pruned)
      await expectEventually('TC-35 selection pruned to 3', async () => {
        const c = await getSelectionCount(lee.page);
        expect(c).toBe(3);
      });

      // The 3 remaining notes should still be selected
      for (const id of noteIds.filter((n) => n !== targetId)) {
        expect(await isSelected(lee.page, id)).toBe(true);
      }
      // The deleted note should not exist
      const notes = await readBoardNotes(lee.page);
      expect(notes.find((n) => n.id === targetId)).toBeUndefined();

      // Lee presses Delete → removes the remaining 3
      await lee.page.keyboard.press('Delete');
      await waitForSettled(lee.page);
      const remaining = await readBoardNotes(lee.page);
      expect(remaining).toHaveLength(0);
    } finally {
      await closeParticipants([lee, sam]);
    }
  });
});

test.describe('Multi-select: concurrent group moves (TC-36)', () => {
  test('TC-36: multiple editors move different selections simultaneously → converge', async ({ browser }) => {
    const boardId = newBoardId();
    const numEditors = Math.min(MAX_CONCURRENT_EDITORS, 3); // Use 3 for practical test time
    const participants = await openParticipants(browser, boardId, numEditors);

    try {
      // Set up camera for all
      for (const p of participants) {
        await setCamera(p.page, { x: -640, y: -400, zoom: 1 });
      }

      // Create enough notes for each editor: numEditors * 2 notes
      const allNotes: string[] = [];
      for (let i = 0; i < numEditors * 2; i++) {
        const id = await createNoteAt(participants[0]!.page, 200 + (i % 4) * 220, 150 + Math.floor(i / 4) * 220);
        allNotes.push(id);
      }

      // Sync all editors
      for (const p of participants) {
        await waitForSettled(p.page);
        await expectEventually(`${p.label} sees all notes`, async () => {
          const notes = await readBoardNotes(p.page);
          expect(notes.length).toBe(allNotes.length);
        });
      }

      // Record starting positions
      const startNotes = await readBoardNotes(participants[0]!.page);
      const startPositions = new Map(startNotes.map((n) => [n.id, { x: n.x, y: n.y }]));

      // Each editor moves their assigned pair in a different direction
      const moves = [
        { dx: 200, dy: 0 },
        { dx: 0, dy: 200 },
        { dx: -200, dy: 100 },
      ];

      const promises = participants.map(async (p, idx) => {
        const notesToMove = allNotes.slice(idx * 2, (idx + 1) * 2);
        const move = moves[idx]!;

        // Clear selection then shift-click each note to select them
        await p.page.mouse.click(50, 50);
        await waitForSettled(p.page);
        for (const noteId of notesToMove) {
          await shiftClickNote(p.page, noteId);
        }

        // Drag the first one to move the group
        await dragNote(p.page, notesToMove[0]!, move.dx, move.dy);
      });

      await Promise.all(promises);

      // All editors should converge to the same final state
      await expectEventually('All editors converge', async () => {
        const states = await Promise.all(
          participants.map((p) => readBoardNotes(p.page)),
        );
        const first = states[0]!;
        for (let s = 1; s < states.length; s++) {
          const other = states[s]!;
          expect(other.length).toBe(first.length);
          for (const n of first) {
            const match = other.find((o) => o.id === n.id);
            expect(match).toBeTruthy();
            expect(match!.x).toBeCloseTo(n.x, 0);
            expect(match!.y).toBeCloseTo(n.y, 0);
          }
        }
      });

      // Verify each note moved the expected amount
      const finalNotes = await readBoardNotes(participants[0]!.page);
      for (let i = 0; i < participants.length; i++) {
        const notesToMove = allNotes.slice(i * 2, (i + 1) * 2);
        const move = moves[i]!;
        for (const noteId of notesToMove) {
          const start = startPositions.get(noteId)!;
          const final = finalNotes.find((n) => n.id === noteId)!;
          expect(final.x).toBeCloseTo(start.x + move.dx, -1);
          expect(final.y).toBeCloseTo(start.y + move.dy, -1);
        }
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});
