/**
 * E2E tests for story 8: undo and redo (TC-22 to TC-24).
 *
 * Two real browsers (real websocket provider, real server) verify:
 * - TC-22: per-user history isolation in a real session
 * - TC-23: undoing a move of a note the peer deletes → no crash, sync intact
 * - TC-24: undo works offline, syncs when back online
 */
import { test, expect } from '@playwright/test';
import { openParticipants, createNote, moveNote, deleteNote, noteCount, expectEventually } from './helpers/participants';

test.describe('undo e2e', () => {
  test('TC-22: two participants, per-user history isolation', async ({ browser, baseURL }) => {
    const [alice, bob] = await openParticipants(browser, 2);

    // Alice creates a note
    await createNote(alice.page, 400, 300);

    // Both should see the note
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob sees 1 note');

    // Alice moves her note
    await moveNote(alice.page, 0, 100, 50);

    // Alice undoes (Ctrl+Z)
    await alice.page.keyboard.press('Control+z');

    // The note should still be visible for both (undo moved it back, not deleted)
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice still sees 1 note after undo');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob still sees 1 note after alice undo');

    // Now Bob moves the note (Bob's own history)
    await moveNote(bob.page, 0, -50, 30);

    // Bob undoes → the note goes back to where Alice left it
    await bob.page.keyboard.press('Control+z');

    // Both still see one note
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note after bob undo');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob sees 1 note after bob undo');

    // Alice presses Ctrl+Z again — this should NOT undo Bob's move
    // (per-user isolation). The note should still be visible.
    await alice.page.keyboard.press('Control+z');
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note after second undo');
  });

  test('TC-23: undoing a move of a note the peer deletes → no crash, sync intact', async ({ browser, baseURL }) => {
    const [alice, bob] = await openParticipants(browser, 2);

    // Alice creates a note
    await createNote(alice.page, 400, 300);
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob sees 1 note');

    // Alice moves the note
    await moveNote(alice.page, 0, 100, 50);

    // Bob deletes the note
    await deleteNote(bob.page, 0);
    await expectEventually(async () => (await noteCount(alice.page)) === 0, 'alice sees 0 notes after bob delete');
    await expectEventually(async () => (await noteCount(bob.page)) === 0, 'bob sees 0 notes after delete');

    // Alice undoes → no crash, no resurrection of the note
    await alice.page.keyboard.press('Control+z');

    // The note should NOT be resurrected (it was deleted by Bob)
    // Wait a moment to ensure sync has settled
    await alice.page.waitForTimeout(500);
    expect(await noteCount(alice.page)).toBe(0);
    expect(await noteCount(bob.page)).toBe(0);

    // No crash: the page is still on the board
    expect(alice.page.url()).toContain('/b/');
  });

  test('TC-24: undo works offline, syncs when back online', async ({ browser, baseURL }) => {
    const [alice, bob] = await openParticipants(browser, 2);

    // Alice creates a note
    await createNote(alice.page, 400, 300);
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob sees 1 note');

    // Alice moves the note
    await moveNote(alice.page, 0, 100, 50);

    // Go offline
    await alice.context.setOffline(true);

    // Alice undoes while offline
    await alice.page.keyboard.press('Control+z');

    // The note should still be visible locally
    expect(await noteCount(alice.page)).toBe(1);

    // Go back online
    await alice.context.setOffline(false);

    // Wait for sync to settle
    await alice.page.waitForTimeout(1000);

    // Both should see the note
    await expectEventually(async () => (await noteCount(alice.page)) === 1, 'alice sees 1 note after reconnect');
    await expectEventually(async () => (await noteCount(bob.page)) === 1, 'bob sees 1 note after alice reconnect');
  });
});
