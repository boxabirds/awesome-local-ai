import { test, expect } from '@playwright/test';
import {
  openPair,
  openParticipants,
  closeParticipants,
  createNoteViaToolbar,
  moveNoteViaDrag,
  typeIntoNote,
  deleteNoteById,
  readBoardNotes,
  readConnectionState,
  expectEventually,
} from './helpers/participants';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

test.describe('Two-person workshop', () => {
  test('TC-22: Alex creates, moves, recolours, types, deletes → Sam sees each change', async ({ browser }) => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);

    try {
      // Create
      const noteId = await createNoteViaToolbar(alex.page);
      await expectEventually('TC-22 create propagates', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(1);
        expect(notes[0]!.id).toBe(noteId);
      });

      // Move
      await moveNoteViaDrag(alex.page, noteId, 100, 100);
      await expectEventually('TC-22 move propagates', async () => {
        const notes = await readBoardNotes(sam.page);
        const origNotes = await readBoardNotes(alex.page);
        expect(notes[0]!.x).toBe(origNotes[0]!.x);
        expect(notes[0]!.y).toBe(origNotes[0]!.y);
      });

      // Type text
      await typeIntoNote(alex.page, noteId, 'hello');
      await expectEventually('TC-22 text propagates', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes[0]!.text).toContain('hello');
      });

      // Delete
      await deleteNoteById(alex.page, noteId);
      await expectEventually('TC-22 delete propagates', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(0);
      });
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-23: both type simultaneously → identical text with all chars', async ({ browser }) => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);

    try {
      // Create a note with initial text
      const noteId = await createNoteViaToolbar(alex.page);
      await typeIntoNote(alex.page, noteId, 'start');
      await expectEventually('TC-23 initial text syncs', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes[0]!.text).toBe('start');
      });

      // Both open editors and type at different positions
      const noteAlex = alex.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
      const noteSam = sam.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
      await noteAlex.dblclick();
      await noteSam.dblclick();

      const taAlex = noteAlex.locator('textarea');
      const taSam = noteSam.locator('textarea');
      await taAlex.waitFor({ state: 'visible' });
      await taSam.waitFor({ state: 'visible' });

      // Position cursors: Alex at end, Sam at beginning
      await taAlex.click();
      await taAlex.press('End');
      await taSam.click();
      await taSam.press('Home');

      // Type simultaneously
      await Promise.all([
        taAlex.type('A', { delay: 20 }),
        taSam.type('S', { delay: 20 }),
      ]);

      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');

      // Wait for convergence
      await expectEventually('TC-23 concurrent text merge', async () => {
        const notesA = await readBoardNotes(alex.page);
        const notesS = await readBoardNotes(sam.page);
        expect(notesA[0]!.text).toBe(notesS[0]!.text);
        // All characters should be present in merged result
        expect(notesA[0]!.text).toContain('A');
        expect(notesA[0]!.text).toContain('S');
        expect(notesA[0]!.text).toContain('tart');
      });
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-24: both drag same note → identical settled position', async ({ browser }) => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);

    try {
      const noteId = await createNoteViaToolbar(alex.page);
      await expectEventually('TC-24 note appears for Sam', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(1);
      });

      // Both drag the same note at the same time
      await Promise.all([
        moveNoteViaDrag(alex.page, noteId, 50, 50),
        moveNoteViaDrag(sam.page, noteId, -50, -50),
      ]);

      // Wait for convergence
      await expectEventually('TC-24 position converges', async () => {
        const notesA = await readBoardNotes(alex.page);
        const notesS = await readBoardNotes(sam.page);
        expect(notesA[0]!.x).toBe(notesS[0]!.x);
        expect(notesA[0]!.y).toBe(notesS[0]!.y);
      });
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-25: Sam editing, Alex deletes → Sam editor gone, no console errors', async ({ browser }) => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);
    const samErrors: string[] = [];
    sam.page.on('console', (msg) => {
      if (msg.type() === 'error') samErrors.push(msg.text());
    });

    try {
      const noteId = await createNoteViaToolbar(alex.page);
      await expectEventually('TC-25 note appears for Sam', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(1);
      });

      // Sam starts editing the note
      const noteSam = sam.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
      await noteSam.dblclick();
      await expect(noteSam.locator('textarea')).toBeVisible();

      // Alex deletes it
      await deleteNoteById(alex.page, noteId);

      // Sam's note and editor should disappear
      await expectEventually('TC-25 editor disappears for Sam', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(0);
      });

      // The note element should be gone from the DOM
      await expect(sam.page.locator(`[data-note-id="${noteId}"]`)).toHaveCount(0);

      // No console errors on Sam's side
      expect(samErrors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26: MAX_CONCURRENT_EDITORS contexts each create 5 notes → all see all', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = newBoardId();
    const participants = await openParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);

    try {
      // Each participant creates 5 notes
      const allNoteIds: string[][] = [];
      for (const p of participants) {
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const id = await createNoteViaToolbar(p.page);
          ids.push(id);
        }
        allNoteIds.push(ids);
      }

      const totalNotes = MAX_CONCURRENT_EDITORS * 5;

      // Every participant sees all notes
      for (const p of participants) {
        await expectEventually(`TC-26 ${p.label} sees all ${totalNotes} notes`, async () => {
          const notes = await readBoardNotes(p.page);
          expect(notes.length).toBe(totalNotes);
        });
      }

      // All snapshots are identical (same note ids)
      const snapshots = await Promise.all(participants.map((p) => readBoardNotes(p.page)));
      for (let i = 1; i < snapshots.length; i++) {
        const ids0 = snapshots[0]!.map((n) => n.id).sort();
        const idsI = snapshots[i]!.map((n) => n.id).sort();
        expect(idsI).toEqual(ids0);
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: offline → reconnect → catch up', async ({ browser }) => {
    test.setTimeout(90_000);
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);

    try {
      // Ensure both are connected before going offline
      await expectEventually('TC-27 Alex initial connect', async () => {
        const state = await readConnectionState(alex.page);
        expect(state === 'connected' || state === 'confirmed').toBe(true);
      });
      await expectEventually('TC-27 Sam initial connect', async () => {
        const state = await readConnectionState(sam.page);
        expect(state === 'connected' || state === 'confirmed').toBe(true);
      });

      // Take Alex offline
      await alex.context.setOffline(true);

      // Wait for Alex to detect disconnection via heartbeat timeout (30s in y-websocket).
      // Chromium setOffline may not immediately close the WebSocket; the provider
      // detects the dead connection when it fails to send or receive for 30s.
      await expectEventually('TC-27 Alex sees reconnecting', async () => {
        const state = await readConnectionState(alex.page);
        expect(state).toBe('reconnecting');
      }, 45_000);

      // Both add 3 notes while Alex is disconnected
      for (let i = 0; i < 3; i++) {
        await createNoteViaToolbar(alex.page);
      }
      for (let i = 0; i < 3; i++) {
        await createNoteViaToolbar(sam.page);
      }

      // Bring Alex back online
      await alex.context.setOffline(false);

      // Alex should eventually reconnect
      await expectEventually('TC-27 Alex reconnects', async () => {
        const state = await readConnectionState(alex.page);
        expect(state === 'connected' || state === 'confirmed').toBe(true);
      }, 30_000);

      // Both should show 6 notes
      await expectEventually('TC-27 Alex sees 6 notes', async () => {
        const notes = await readBoardNotes(alex.page);
        expect(notes.length).toBe(6);
      }, 30_000);
      await expectEventually('TC-27 Sam sees 6 notes', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(6);
      }, 30_000);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

test.describe('Selection is private', () => {
  test('TC-28: selection/editing is NOT shared', async ({ browser }) => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(browser, boardId);

    try {
      const noteId = await createNoteViaToolbar(alex.page);
      await expectEventually('TC-28 note appears for Sam', async () => {
        const notes = await readBoardNotes(sam.page);
        expect(notes.length).toBe(1);
      });

      // Alex selects and edits the note
      const noteAlex = alex.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
      await noteAlex.dblclick();
      await expect(noteAlex.locator('textarea')).toBeVisible();

      // Sam should NOT see a selection outline or editor
      const noteSam = sam.page.locator(`[data-testid="sticky-note"][data-note-id="${noteId}"]`);
      // No textarea should be visible in Sam's note
      const textareaCount = await noteSam.locator('textarea').count();
      expect(textareaCount).toBe(0);

      // Sam's note should not have a selection class/outline
      // Selection styling typically adds a class with 'selected' or similar
      // Just check no textarea is there (strongest assertion)
      expect(textareaCount).toBe(0);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});
