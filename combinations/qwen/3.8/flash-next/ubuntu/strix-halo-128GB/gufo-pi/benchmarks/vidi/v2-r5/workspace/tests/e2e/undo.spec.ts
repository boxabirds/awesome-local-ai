import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  waitForSettled,
} from './helpers/board';
import {
  openParticipants,
  closeParticipants,
  readBoardNotes,
  expectEventually,
  createNoteViaToolbar,
} from './helpers/participants';

/**
 * TC-22: Recover an accidental delete while a colleague works.
 * Mia selects 8 notes and deletes them; Raj adds a note; Mia presses Ctrl+Z →
 * 8 notes return on both screens, Raj's note remains; Redo removes them again.
 */
test.describe('undo.controls', () => {
  test('TC-22: undo accidental delete, colleague note survives', async ({ browser }) => {
    const participants = await openParticipants(browser, newBoardId(), 2);
    const [mia, raj] = participants;
    if (!mia || !raj) throw new Error('Expected 2 participants');

    // Create 8 notes via Mia's toolbar
    const noteIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await createNoteViaToolbar(mia.page);
      noteIds.push(id);
    }

    // Wait for Raj to see them
    await expectEventually('Raj sees 8 notes', async () => {
      const notes = await readBoardNotes(raj.page);
      expect(notes.length).toBe(8);
    });

    // Mia selects all and deletes
    await mia.page.keyboard.press('Control+a');
    await waitForSettled(mia.page);
    await mia.page.keyboard.press('Delete');
    await waitForSettled(mia.page);

    // Verify notes are gone from Mia's view
    await expectEventually('Mia sees 0 notes', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.length).toBe(0);
    });

    // Raj adds a note
    const rajNoteId = await createNoteViaToolbar(raj.page);

    // Verify Mia sees Raj's note
    await expectEventually('Mia sees Raj note', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.length).toBe(1);
      expect(notes[0]!.id).toBe(rajNoteId);
    });

    // Mia presses Ctrl+Z to undo the delete
    await mia.page.keyboard.press('Control+z');
    await waitForSettled(mia.page);

    // Verify 8 notes are back + Raj's note on Mia's screen
    await expectEventually('Mia sees 9 notes after undo', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.length).toBe(9);
    });

    // Verify 8 notes are back + Raj's note on Raj's screen
    await expectEventually('Raj sees 9 notes after Mia undo', async () => {
      const notes = await readBoardNotes(raj.page);
      expect(notes.length).toBe(9);
    });

    // Mia presses Redo button → 8 notes disappear again
    await mia.page.getByTestId('redo-button').click();
    await waitForSettled(mia.page);

    await expectEventually('Mia sees 1 note after redo', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.length).toBe(1);
      expect(notes[0]!.id).toBe(rajNoteId);
    });

    await expectEventually('Raj sees 1 note after Mia redo', async () => {
      const notes = await readBoardNotes(raj.page);
      expect(notes.length).toBe(1);
    });

    // Redo button should now be disabled (Mia's redo is exhausted)
    await expect(mia.page.getByTestId('redo-button')).toBeDisabled();

    await closeParticipants(participants);
  });

  /**
   * TC-23: Undo after a colleague deleted my object.
   * Mia moves a note, Raj deletes it, Mia presses Ctrl+Z → no error, note absent on both.
   */
  test('TC-23: undo move of remotely-deleted object is safe', async ({ browser }) => {
    const participants = await openParticipants(browser, newBoardId(), 2);
    const [mia, raj] = participants;
    if (!mia || !raj) throw new Error('Expected 2 participants');

    // Create a note via Mia
    const noteId = await createNoteViaToolbar(mia.page);

    // Wait for Raj to see it
    await expectEventually('Raj sees the note', async () => {
      const notes = await readBoardNotes(raj.page);
      expect(notes.length).toBe(1);
    });

    // Mia moves the note
    const noteEl = mia.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
    const box = await noteEl.boundingBox();
    if (!box) throw new Error(`Note ${noteId} not found`);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await mia.page.mouse.move(from.x, from.y);
    await mia.page.mouse.down();
    await mia.page.mouse.move(from.x + 50, from.y + 50, { steps: 4 });
    await mia.page.mouse.up();
    await waitForSettled(mia.page);

    // Wait for Raj to see the move
    await expectEventually('Raj sees moved note', async () => {
      const notes = await readBoardNotes(raj.page);
      const note = notes.find((n) => n.id === noteId);
      expect(note).toBeDefined();
    });

    // Raj deletes the note
    await raj.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`).click();
    await raj.page.keyboard.press('Delete');
    await waitForSettled(raj.page);

    // Wait for Mia to see it deleted
    await expectEventually('Mia sees note deleted', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.find((n) => n.id === noteId)).toBeUndefined();
    });

    // Mia presses Ctrl+Z — should not throw
    const consoleErrors: string[] = [];
    mia.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mia.page.keyboard.press('Control+z');
    await waitForSettled(mia.page);

    // Note stays absent on both screens
    await expectEventually('Note absent from Mia', async () => {
      const notes = await readBoardNotes(mia.page);
      expect(notes.find((n) => n.id === noteId)).toBeUndefined();
    });

    await expectEventually('Note absent from Raj', async () => {
      const notes = await readBoardNotes(raj.page);
      expect(notes.find((n) => n.id === noteId)).toBeUndefined();
    });

    // No console errors
    expect(consoleErrors.length).toBe(0);

    await closeParticipants(participants);
  });

  /**
   * TC-24: Everyone undoing at once.
   * MAX_CONCURRENT_EDITORS contexts each move a different note, then all press Ctrl+Z →
   * each context's own changes reverted, others' changes intact, all boards identical.
   */
  test('TC-24: concurrent undo in all editors', async ({ browser }) => {
    const count = MAX_CONCURRENT_EDITORS;
    const participants = await openParticipants(browser, newBoardId(), count);

    // Participant 0 creates a base note
    const baseNoteId = await createNoteViaToolbar(participants[0]!.page);

    // Wait for all to see it
    for (const p of participants) {
      await expectEventually(`${p.label} sees base note`, async () => {
        const notes = await readBoardNotes(p.page);
        expect(notes.length).toBe(1);
      });
    }

    // Each participant creates their own note
    const ownNoteIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = participants[i]!;
      const before = await readBoardNotes(p.page);
      await p.page.getByTestId('create-sticky-button').click();
      await waitForSettled(p.page);
      // Dismiss editor
      await p.page.keyboard.press('Escape');
      await waitForSettled(p.page);
      const after = await readBoardNotes(p.page);
      const newNote = after.find((n) => !before.some((b) => b.id === n.id));
      if (!newNote) throw new Error(`No note created for participant ${i}`);
      ownNoteIds.push(newNote.id);
    }

    // Wait for all to see all notes (base + count own = count+1)
    for (const p of participants) {
      await expectEventually(`${p.label} sees ${count + 1} notes`, async () => {
        const notes = await readBoardNotes(p.page);
        expect(notes.length).toBe(count + 1);
      });
    }

    // All press Ctrl+Z to undo their own note creation
    for (const p of participants) {
      await p.page.keyboard.press('Control+z');
      await waitForSettled(p.page);
    }

    // Wait for convergence: all participants should see identical boards
    await expectEventually('All boards converge', async () => {
      const boards: { id: string; x: number; y: number }[][] = [];
      for (const p of participants) {
        boards.push([...await readBoardNotes(p.page)]);
      }
      for (let i = 1; i < boards.length; i++) {
        expect(boards[i]!.length).toBe(boards[0]!.length);
        for (const note of boards[i]!) {
          const match = boards[0]!.find((n) => n.id === note.id);
          expect(match).toBeDefined();
          expect(note.x).toBe(match!.x);
          expect(note.y).toBe(match!.y);
        }
      }
    });

    // After each undoes their own creation, only the base note should remain
    await expectEventually('Only base note remains', async () => {
      const notes = await readBoardNotes(participants[0]!.page);
      expect(notes.length).toBe(1);
      expect(notes[0]!.id).toBe(baseNoteId);
    });

    await closeParticipants(participants);
  });
});
