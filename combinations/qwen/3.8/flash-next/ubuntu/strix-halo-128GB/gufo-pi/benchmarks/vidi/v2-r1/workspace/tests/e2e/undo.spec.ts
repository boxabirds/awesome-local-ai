/**
 * E2E undo tests TC-22 to TC-24.
 *
 * Multi-user undo scenarios: each user undoes only their own changes while
 * colleagues' changes remain intact. Runs against wrangler dev.
 */
import { expect, test } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  closeParticipants,
  createNoteAndGetId,
  expectEventually,
  getDocSnapshot,
  noteCount,
  noteIds,
  openParticipants,
  type Participant,
} from './helpers/participants';
import {
  dragPointer,
  noteRects,
  selectNoteAt,
  settle,
} from './helpers/stickies';

test.describe('Undo — recover mistakes while colleagues work', () => {
  let participants: Participant[];

  test.beforeEach(async ({ browser }) => {
    participants = await openParticipants(browser, 2);
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  // TC-22: Mia deletes 8 notes; Raj adds note; Mia Ctrl+Z → 8 back on both, Raj's note remains;
  //         Redo removes 8 again.
  test('TC-22: recover accidental delete while colleague works', async () => {
    const [mia, raj] = participants;

    // Mia creates 8 notes
    const miaNoteIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await createNoteAndGetId(mia);
      miaNoteIds.push(id);
    }

    await expectEventually(
      'TC-22: Raj sees 8 notes',
      participants,
      async () => (await noteCount(raj.page)) >= 8,
    );

    // Mia selects all 8 and deletes them
    await mia.page.keyboard.press('Escape'); // ensure not editing
    await mia.page.keyboard.press('Control+a');
    await mia.page.waitForTimeout(50);
    await mia.page.keyboard.press('Delete');
    await mia.page.waitForTimeout(100);

    // Raj's view: notes gone
    await expectEventually(
      'TC-22: Raj sees 0 after delete',
      participants,
      async () => (await noteCount(raj.page)) === 0,
    );

    // Raj adds a note
    const rajNoteId = await createNoteAndGetId(raj);
    expect(rajNoteId).not.toBe('');

    await expectEventually(
      'TC-22: Mia sees Raj note',
      participants,
      async () => (await noteCount(mia.page)) >= 1,
    );

    // Mia presses Ctrl+Z → 8 notes restored on both screens
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(100);

    await expectEventually(
      'TC-22: Mia undo restores 8 notes on both',
      participants,
      async () => {
        const miaCount = await noteCount(mia.page);
        const rajCount = await noteCount(raj.page);
        return miaCount === 9 && rajCount === 9; // 8 restored + Raj's 1
      },
    );

    // Raj's note still exists on both screens
    const ids = await noteIds(raj.page);
    expect(ids).toContain(rajNoteId);

    // Mia clicks Redo → 8 notes deleted again on both screens
    const redoBtn = mia.page.getByLabel('Redo');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await mia.page.waitForTimeout(100);

    await expectEventually(
      'TC-22: Mia redo removes 8 on both',
      participants,
      async () => {
        const miaCount = await noteCount(mia.page);
        const rajCount = await noteCount(raj.page);
        return miaCount === 1 && rajCount === 1; // only Raj's note
      },
    );

    // Undo button is now enabled (since we undid the redo)
    const undoBtn = mia.page.getByLabel('Undo');
    await expect(undoBtn).toBeEnabled();
  });

  // TC-23: Mia moves note, Raj deletes it, Mia undoes → no error, note absent on both
  test('TC-23: colleague deleted my object → undo has no effect, no error', async () => {
    const [mia, raj] = participants;

    // Mia creates a note
    const noteId = await createNoteAndGetId(mia);

    await expectEventually(
      'TC-23: Raj sees note',
      participants,
      async () => (await noteCount(raj.page)) >= 1,
    );

    // Mia moves it
    const rects = await noteRects(mia.page);
    const rect = rects.find((r) => r.id === noteId)!;
    expect(rect).toBeDefined();
    await dragPointer(mia.page, { x: rect.centreX, y: rect.centreY }, { x: 80, y: 60 });
    await settle(mia.page);

    await expectEventually(
      'TC-23: Raj sees moved',
      participants,
      async () => {
        const rectsB = await noteRects(raj.page);
        const rB = rectsB.find((r) => r.id === noteId);
        if (!rB) return false;
        return rB.worldX !== rect.worldX || rB.worldY !== rect.worldY;
      },
    );

    // Raj deletes it
    await selectNoteAt(raj.page, { x: rect.centreX + 80, y: rect.centreY + 60 });
    await raj.page.waitForTimeout(50);
    const deleteBtn = raj.page.getByRole('button', { name: 'Delete note' });
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
    } else {
      await raj.page.keyboard.press('Delete');
    }
    await raj.page.waitForTimeout(100);

    await expectEventually(
      'TC-23: Mia sees note deleted',
      participants,
      async () => (await noteCount(mia.page)) === 0,
    );

    // Mia presses Ctrl+Z → no error, note stays deleted
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(200);

    // Note is still absent on both screens
    expect(await noteCount(mia.page)).toBe(0);
    expect(await noteCount(raj.page)).toBe(0);

    // Mia's next undo still works (no error)
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(100);
    expect(await noteCount(mia.page)).toBe(0);
  });
});

// TC-24: All MAX_CONCURRENT_EDITORS participants each make and undo own changes
test.describe('Undo — everyone undoing at once', () => {
  test('TC-24: each participant undoes only own changes, boards stay identical', async ({ browser }) => {
    const participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

    try {
      // Each participant creates a note at a distinct position using addNoteAt hook
      // Camera at reset: world (0,0) maps to screen (640, 400); world range visible: [-640,640] x [-400,400]
      const ownNoteIds: string[] = [];
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const id = await p.page.evaluate((pos) => {
          const hooks = window.__vidi6;
          if (!hooks) throw new Error('no test hooks');
          return hooks.addNoteAt!(pos);
        }, { x: (i - 2) * 200, y: 0 });
        ownNoteIds.push(id);
      }

      // Wait for all notes to appear everywhere
      await expectEventually(
        'TC-24: all notes visible',
        participants,
        async () => {
          for (const p of participants) {
            if ((await noteCount(p.page)) < MAX_CONCURRENT_EDITORS) return false;
          }
          return true;
        },
      );

      // Each participant drags their own note to a different position
      const initialPositions: Map<string, { worldX: number; worldY: number }> = new Map();
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const id = ownNoteIds[i];
        const rects = await noteRects(p.page);
        const rect = rects.find((r) => r.id === id);
        if (!rect) continue;
        initialPositions.set(id, { worldX: rect.worldX, worldY: rect.worldY });
        // Drag right by (i+1)*20 pixels
        await dragPointer(p.page, { x: rect.centreX, y: rect.centreY }, { x: (i + 1) * 20, y: 0 });
        await settle(p.page);
      }

      // Wait for all boards to converge (sort keys: Y.Map iteration order varies)
      await expectEventually(
        'TC-24: moves converged',
        participants,
        async () => {
          const snapshots = await Promise.all(
            participants.map((p) => getDocSnapshot(p.page)),
          );
          const sorted = snapshots.map((s) =>
            JSON.stringify(Object.fromEntries(Object.entries(s).sort())),
          );
          return sorted.every((s) => s === sorted[0]);
        },
      );

      // Each participant undoes their own move
      for (const p of participants) {
        await p.page.click('[data-testid="viewport"]', { position: { x: 10, y: 10 } });
        await p.page.waitForTimeout(30);
        await p.page.keyboard.press('Control+z');
        await p.page.waitForTimeout(100);
      }

      // Wait for convergence (sorted keys)
      await expectEventually(
        'TC-24: after undo converge',
        participants,
        async () => {
          const snapshots = await Promise.all(
            participants.map((p) => getDocSnapshot(p.page)),
          );
          const sorted = snapshots.map((s) =>
            JSON.stringify(Object.fromEntries(Object.entries(s).sort())),
          );
          return sorted.every((s) => s === sorted[0]);
        },
      );

      // All notes still exist
      for (const p of participants) {
        expect(await noteCount(p.page)).toBe(MAX_CONCURRENT_EDITORS);
      }

      // Verify positions: each participant's move was undone on all boards.
      // addNoteAt({ x: (i-2)*200, y: 0 }) stores at ((i-2)*200 - HALF, 0 - HALF)
      const finalSnapshot = await getDocSnapshot(participants[0].page);
      for (let i = 0; i < participants.length; i++) {
        const id = ownNoteIds[i];
        const entry = finalSnapshot[id] as Record<string, number> | undefined;
        expect(entry).toBeDefined();
        const expectedX = (i - 2) * 200 - STICKY_SIZE_WORLD / 2;
        const expectedY = 0 - STICKY_SIZE_WORLD / 2;
        expect(entry!.x).toBe(expectedX);
        expect(entry!.y).toBe(expectedY);
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});
