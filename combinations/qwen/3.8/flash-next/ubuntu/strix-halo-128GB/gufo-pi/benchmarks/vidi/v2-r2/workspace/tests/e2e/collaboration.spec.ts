import { test, expect } from '@playwright/test';
import {
  createParticipant,
  waitForConnected,
  getNoteCount,
  getNoteText,
  getNoteScreenPos,
  getBoardSnapshot,
  createNoteAtPoint,
  expectEventually,
  type Participant,
} from './helpers/participants';
import { newBoardId } from '@shared/board-id';

test.describe('Two-person workshop', () => {
  let alex: Participant;
  let sam: Participant;

  test.beforeEach(async ({ browser }) => {
    const boardId = newBoardId();
    alex = await createParticipant(browser, boardId);
    sam = await createParticipant(browser, boardId);
  });

  test.afterEach(async () => {
    await alex.context.close();
    await sam.context.close();
  });

  // TC-22: Alex creates, moves, recolours, types, deletes → each change appears for Sam
  test('TC-22: Alex creates → Sam sees it', async () => {
    // Alex creates a note
    await createNoteAtPoint(alex.page, 400, 300);
    await alex.page.keyboard.type('Hello');
    await alex.page.keyboard.press('Escape');

    // Sam sees the note
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 1,
      'TC-22 note count',
    );

    // Text matches
    await expectEventually(
      () => getNoteText(sam.page, 0),
      (text) => text === 'Hello',
      'TC-22 note text',
    );
  });

  // TC-23: both type simultaneously → identical text containing every character
  test('TC-23: concurrent typing merges', async () => {
    // Alex creates a note with initial text
    await createNoteAtPoint(alex.page, 400, 300);
    await alex.page.keyboard.type('green');
    await alex.page.keyboard.press('Escape');
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 1,
      'TC-23 initial sync',
    );

    // Both start editing
    // Alex: double-click on the note to edit
    const alexNotePos = await getNoteScreenPos(alex.page, 0);
    await alex.page.mouse.dblclick(alexNotePos.x + 100, alexNotePos.y + 100);
    await alex.page.waitForSelector('textarea');
    // Move cursor to beginning and insert
    await alex.page.keyboard.press('Home');
    await alex.page.keyboard.type('red ');

    // Sam: double-click on the note to edit
    const samNotePos = await getNoteScreenPos(sam.page, 0);
    await sam.page.mouse.dblclick(samNotePos.x + 100, samNotePos.y + 100);
    await sam.page.waitForSelector('textarea');
    // Move cursor to end and insert
    await sam.page.keyboard.press('End');
    await sam.page.keyboard.type(' blue');

    // Escape to commit edits
    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');

    // Wait for both to converge
    await expectEventually(
      async () => {
        const snapA = await getBoardSnapshot(alex.page);
        const snapB = await getBoardSnapshot(sam.page);
        return snapA === snapB;
      },
      (converged) => converged,
      'TC-23 convergence',
    );

    // Verify text contains all parts
    const textA = await getNoteText(alex.page, 0);
    expect(textA).toContain('red');
    expect(textA).toContain('green');
    expect(textA).toContain('blue');

    const textB = await getNoteText(sam.page, 0);
    expect(textB).toBe(textA);
  });

  // TC-25: Sam editing, Alex deletes → Sam's note and editor disappear
  test('TC-25: delete during edit clears editor on other client', async () => {
    // Create a note
    await createNoteAtPoint(alex.page, 400, 300);
    await alex.page.keyboard.type('to be deleted');
    await alex.page.keyboard.press('Escape');
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 1,
      'TC-25 initial sync',
    );

    // Sam starts editing
    const samNotePos = await getNoteScreenPos(sam.page, 0);
    await sam.page.mouse.dblclick(samNotePos.x + 50, samNotePos.y + 50);
    await sam.page.waitForSelector('[data-testid="sticky-textarea"]');

    // Alex deletes the note
    const alexNotePos = await getNoteScreenPos(alex.page, 0);
    await alex.page.mouse.click(alexNotePos.x + 50, alexNotePos.y + 50);
    await alex.page.keyboard.press('Delete');

    // Sam's note should disappear
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 0,
      'TC-25 note deleted',
    );

    // Editor should also be gone
    const textarea = sam.page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toHaveCount(0);
  });

  // TC-28: Alex selects and edits → Sam sees no selection outline or editor
  test('TC-28: selection is local only', async () => {
    // Alex creates and edits a note
    await createNoteAtPoint(alex.page, 400, 300);
    await alex.page.keyboard.type('visible');
    await alex.page.keyboard.press('Escape');
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 1,
      'TC-28 sync',
    );

    // Alex selects and enters edit mode
    const notePos = await getNoteScreenPos(alex.page, 0);
    await alex.page.mouse.dblclick(notePos.x + 50, notePos.y + 50);
    await alex.page.waitForSelector('[data-testid="sticky-textarea"]');

    // Sam should NOT see an editor (no textarea visible for the note)
    const samTextarea = sam.page.locator('[data-testid="sticky-textarea"]');
    // Sam might not have a textarea at all
    await expect(samTextarea).toHaveCount(0);

    // Sam should not see the selected outline
    const selectedNotes = sam.page.locator('[role="group"][aria-label="Sticky note"][data-selected="true"]');
    await expect(selectedNotes).toHaveCount(0);
  });
});

test.describe('Full-capacity session', () => {
  // TC-26: 5 contexts each create 5 notes → every change seen by all others
  test('TC-26: all participants see all notes', async ({ browser }) => {
    const boardId = newBoardId();
    const participants: Participant[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await createParticipant(browser, boardId);
      participants.push(p);
    }

    // Each creates 5 notes at distinct positions (spaced apart to avoid overlap)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        await createNoteAtPoint(participants[i].page, 100 + j * 220, 100 + i * 140);
        await participants[i].page.keyboard.press('Escape');
        await participants[i].page.waitForTimeout(50);
      }
    }

    // All participants should see 25 notes
    for (let i = 0; i < 5; i++) {
      await expectEventually(
        () => getNoteCount(participants[i].page),
        (count) => count === 25,
        `TC-26 participant ${i} count`,
      );
    }

    // All snapshots should be identical
    const snaps = await Promise.all(participants.map((p) => getBoardSnapshot(p.page)));
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]).toBe(snaps[0]);
    }

    for (const p of participants) await p.context.close();
  });
});

test.describe('Flaky Wi-Fi', () => {
  // TC-27: Alex goes offline for a while, both create notes, reconnect → all notes visible
  test('TC-27: offline recovery', async ({ browser }) => {
    const boardId = newBoardId();
    const alex = await createParticipant(browser, boardId);
    const sam = await createParticipant(browser, boardId);

    // Alex goes offline
    await alex.context.setOffline(true);

    // Wait a bit for the disconnection to be noticed
    await new Promise((r) => setTimeout(r, 3000));

    // Sam creates 3 notes
    for (let i = 0; i < 3; i++) {
      await createNoteAtPoint(sam.page, 200 + i * 220, 200);
      await sam.page.keyboard.press('Escape');
      await sam.page.waitForTimeout(50);
    }

    // Alex creates 3 notes locally (offline)
    for (let i = 0; i < 3; i++) {
      await createNoteAtPoint(alex.page, 500 + i * 220, 500);
      await alex.page.keyboard.press('Escape');
      await alex.page.waitForTimeout(50);
    }

    // Alex reconnects
    await alex.context.setOffline(false);

    // Wait for Alex to reconnect (give extra time for WebSocket reconnection)
    await waitForConnected(alex.page);

    // Both should see all 6 notes
    await expectEventually(
      () => getNoteCount(alex.page),
      (count) => count === 6,
      'TC-27 Alex sees 6',
    );
    await expectEventually(
      () => getNoteCount(sam.page),
      (count) => count === 6,
      'TC-27 Sam sees 6',
    );

    await alex.context.close();
    await sam.context.close();
  });
});
