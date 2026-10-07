import { expect, test, type Page } from '@playwright/test';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  boardId,
  closeScreens,
  connectionState,
  createNote,
  dropConnection,
  expectNoBadge,
  expectNoteText,
  expectNotesOn,
  expectSameBoard,
  gotoNewBoard,
  liveNoteIds,
  networkLog,
  noteText,
  openScreen,
  openSecondScreen,
  resumeConnection,
  waitForConfirmedBadge,
  waitForSynced,
} from './helpers/sync';

/**
 * Story 3 — "See other people's edits appear live on the same board".
 *
 * Every test here needs at least two screens, and each screen lives in its own
 * browser context: nothing may travel between them except through the Worker and
 * its BoardRoom (design: "Two browser contexts"). Assertions are about what a
 * person sees on *the other screen*, never about the other screen's internals.
 */

/** Screen positions for notes: none stacked, all clear of the toolbars. */
const SPOTS = [
  { x: 380, y: 280 },
  { x: 660, y: 280 },
  { x: 380, y: 560 },
  { x: 660, y: 560 },
  { x: 520, y: 420 },
];

/** Start editing the note with this id (a real double-click on it). */
async function editNote(page: Page, id: string): Promise<void> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} is not on screen`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('sticky-note-input')).toBeVisible();
}

/** What the focused editor holds, and where its caret sits. */
function editorState(page: Page): Promise<{ value: string; caretStart: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="sticky-note-input"]') as HTMLTextAreaElement;
    return { value: el.value, caretStart: el.selectionStart ?? -1 };
  });
}

/** Screen box of a note (left/top rounded, so two screens can be compared). */
async function noteScreenBox(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} is not on screen`);
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

const sortedChars = (text: string): string => [...text].sort().join('');

test.describe('the board URL is the board (TC-22)', () => {
  test('opening / becomes /b/<id>; that address is shared, a new one is empty', async ({
    page,
  }) => {
    const extra: Page[] = [];
    const id = await gotoNewBoard(page);
    try {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(new URL(page.url()).pathname).toBe(`/b/${id}`);
      await waitForSynced(page);

      const note = await createNote(page, SPOTS[0]!, 'retro item 4');
      expect(await boardId(page)).toBe(id);

      // A second browser at the same address joins the same board...
      const other = await openSecondScreen(page);
      extra.push(other);
      await waitForSynced(other);
      await expectNoteText(other, note, 'retro item 4');

      // ...and it joins *that* board rather than a copy of it.
      const otherNote = await createNote(other, SPOTS[1]!, 'from the second screen');
      await expectNoteText(page, otherNote, 'from the second screen');
      await expectSameBoard(page, other);

      // A fresh address is a fresh board.
      const fresh = await openScreen(page, '/');
      extra.push(fresh);
      expect(new URL(fresh.url()).pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
      expect(await boardId(fresh)).not.toBe(id);
      await expect.poll(() => liveNoteIds(fresh)).toEqual([]);

      // Nothing went peer-to-peer: two tabs of one browser never talk directly.
      expect((await networkLog(page)).broadcastChannels).toBe(0);
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('edits appear on the other screen (TC-23)', () => {
  test('create, colour, move, edit and delete all land on the other screen', async ({ page }) => {
    const extra: Page[] = [];
    await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    await Promise.all([waitForSynced(page), waitForSynced(other)]);
    try {
      // -- create and type
      const note = await createNote(page, SPOTS[0]!, 'quarterly review');
      await expectNoteText(other, note, 'quarterly review');

      // -- colour
      await page.locator(`[data-note-id="${note}"]`).click();
      await page.getByTestId('color-pink').click();
      await expect
        .poll(() => other.locator(`[data-note-id="${note}"]`).getAttribute('data-color'))
        .toBe('pink');

      // -- move: a drag on one screen moves the note on the other
      await page.mouse.down();
      await page.mouse.move(SPOTS[0]!.x + 120, SPOTS[0]!.y + 80, { steps: 10 });
      await page.mouse.up();
      await expect
        .poll(() => noteScreenBox(other, note), { timeout: 5_000 })
        .toEqual(await noteScreenBox(page, note));

      // -- text editing, in a note the other screen is also showing
      await editNote(page, note);
      await page.keyboard.type(' (draft)');
      await expectNoteText(other, note, 'quarterly review (draft)');

      // -- delete: the note disappears there, editor and all
      await page.keyboard.press('Escape');
      await page.locator(`[data-note-id="${note}"]`).click();
      await page.keyboard.press('Delete');
      await expect
        .poll(() => other.locator(`[data-note-id="${note}"]`).count(), { timeout: 5_000 })
        .toBe(0);
    } finally {
      await closeScreens(extra);
    }
  });

  test('two people typing in the same note keep every character and their own caret', async ({
    page,
  }) => {
    const extra: Page[] = [];
    await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    await Promise.all([waitForSynced(page), waitForSynced(other)]);
    try {
      const note = await createNote(page, SPOTS[0]!, 'quarterly');
      await expectNoteText(other, note, 'quarterly');

      // Both open the same note for editing, then both keep typing in it.
      await editNote(page, note);
      await editNote(other, note);
      await page.keyboard.type(' review');
      await other.keyboard.type(' Q3', { delay: 20 });
      await page.keyboard.type('!');

      // A's characters arrive inside the editor A is still holding: editing is not
      // frozen for anybody, and neither person's text is thrown away.
      await expect.poll(() => editorState(page).then((s) => s.value.includes('Q3'))).toBe(true);

      // A's own text is still there, in order, even though B's characters landed
      // in the middle of it, and A's caret was never dragged backwards past the
      // last character A typed.
      await expect
        .poll(() => editorState(page).then((s) => s.value.slice(0, s.caretStart).includes('!')))
        .toBe(true);
      expect((await editorState(page)).value).toContain('review');

      // Nothing lost, nothing duplicated: what both screens hold is exactly the
      // characters that were typed, whatever order they merged into.
      const typed = 'quarterly review Q3!';
      for (const screen of [page, other]) {
        await expect
          .poll(() => noteText(screen, note).then((t) => sortedChars(t ?? '')), { timeout: 5_000 })
          .toBe(sortedChars(typed));
      }

      // The caret rule itself: A clicks to put the caret at the very start of the
      // text, B keeps typing at the end, and A's caret stays exactly where A put it
      // rather than being jumped to the end of somebody else's sentence.
      const input = await page.locator('[data-testid="sticky-note-input"]').boundingBox();
      await page.mouse.click(input!.x + 4, input!.y + 6);
      expect((await editorState(page)).caretStart).toBe(0);
      await other.keyboard.type('?');
      await expect.poll(() => editorState(page).then((s) => s.value.includes('?'))).toBe(true);
      expect((await editorState(page)).caretStart).toBe(0);
      // And B's editor shows every character too, including the one it just typed.
      expect((await editorState(other)).value).toContain('?');
    } finally {
      await closeScreens(extra);
    }
  });

  test('a note deleted on another screen closes here without wiping local work', async ({
    page,
  }) => {
    const extra: Page[] = [];
    await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    await Promise.all([waitForSynced(page), waitForSynced(other)]);
    try {
      const note = await createNote(page, SPOTS[0]!, 'shared');
      const survivor = await createNote(page, SPOTS[1]!, 'survivor');
      await expectNotesOn([other], [note, survivor]);

      // This screen is typing in `note` when the other screen deletes it.
      await editNote(page, note);
      await page.keyboard.type(' (typing here)');
      await other.locator(`[data-note-id="${note}"]`).click();
      await other.keyboard.press('Delete');

      // The editor vanishes here rather than lingering over a note that is gone,
      // the deleted note is not resurrected by this screen's typing, and the rest
      // of this screen's work is untouched.
      await expect
        .poll(() => page.locator('[data-testid="sticky-note-input"]').count(), { timeout: 5_000 })
        .toBe(0);
      await expectNotesOn([page], [survivor]);
      await expectNoteText(page, survivor, 'survivor');
      await expect
        .poll(() => page.evaluate(() => window.__vidi6!.getSelection()))
        .toEqual({ selectedId: null, editingId: null });
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('the connection badge is about this connection (TC-24)', () => {
  test('warns on a drop, confirms the rejoin, then says nothing', async ({ page }) => {
    await gotoNewBoard(page);
    await waitForSynced(page);
    const before = await createNote(page, SPOTS[0]!, 'before the drop');

    // A network cut on one screen: the warning appears and the board keeps
    // working, edits and all.
    await dropConnection(page);
    const offline = await createNote(page, SPOTS[1]!, 'typed while offline');
    await expectNoteText(page, before, 'before the drop');
    expect((await connectionState(page)) === 'reconnecting').toBe(true);

    // The warning turns into a confirmation, which then gets out of the way.
    await resumeConnection(page);
    const confirmedAt = Date.now();
    await waitForConfirmedBadge(page);
    await expect
      .poll(() => connectionState(page), { timeout: CONNECTED_CONFIRMATION_MS + 5_000 })
      .toBe('connected');
    const shownFor = Date.now() - confirmedAt;
    // At least the configured window (minus clock slop), and not far beyond it.
    expect(shownFor).toBeGreaterThanOrEqual(CONNECTED_CONFIRMATION_MS - 200);
    expect(shownFor).toBeLessThan(CONNECTED_CONFIRMATION_MS + 2_500);
    await expectNoBadge(page);

    // What was typed while disconnected reached the room exactly once, and a
    // screen that joins now sees both notes.
    const late = await openSecondScreen(page);
    try {
      await waitForSynced(late);
      await expectNotesOn([late], [before, offline]);
    } finally {
      await closeScreens([late]);
    }
  });

  test('a second screen is unaffected while this one warns', async ({ page }) => {
    const extra: Page[] = [];
    await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    await Promise.all([waitForSynced(page), waitForSynced(other)]);
    try {
      const quiet = await createNote(other, SPOTS[0]!, 'quiet neighbour');

      await dropConnection(page);

      // The surviving screen says nothing at all and is a normal board.
      await expectNoBadge(other);
      const mine = await createNote(other, SPOTS[1]!, 'still live');
      await expectNotesOn([other], [quiet, mine]);
      await expectNotesOn([page], [quiet]); // it cannot hear the room any more

      // And when the dropped screen returns, it catches up.
      await resumeConnection(page);
      await waitForConfirmedBadge(page);
      await expectNotesOn([page], [quiet, mine]);
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('reconnection merges rather than replaces (TC-25)', () => {
  test('offline edits and remote edits end up as one board, with nothing doubled', async ({
    page,
  }) => {
    const extra: Page[] = [];
    await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    extra.push(other);
    await Promise.all([waitForSynced(page), waitForSynced(other)]);
    try {
      const before = await createNote(other, SPOTS[0]!, 'made before the drop');
      await expectNoteText(page, before, 'made before the drop');

      await dropConnection(page);
      const mine = await createNote(page, SPOTS[1]!, 'made while disconnected');
      // The other screen carries on, and its work lands while we are away.
      const theirs = await createNote(other, SPOTS[2]!, 'made while we were away');
      await expectNoteText(other, theirs, 'made while we were away');

      await resumeConnection(page);
      await waitForConfirmedBadge(page);
      await expectNotesOn([page, other], [before, mine, theirs]);
      expect(new Set(await liveNoteIds(page)).size).toBe(3);

      // Reloading a screen shows the same three, not a doubled set.
      await page.reload();
      await page.waitForSelector('[data-testid="board-viewport"]');
      await waitForSynced(page);
      await expectNotesOn([page, other], [before, mine, theirs]);
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('leaving and rejoining a board (TC-26)', () => {
  test('leaving one board and joining another keeps each board to itself', async ({ page }) => {
    const extra: Page[] = [];
    const firstBoard = await gotoNewBoard(page);
    const mine = await createNote(page, SPOTS[0]!, 'board one');
    try {
      // Join another board by a fresh address: nothing comes along.
      const second = await openScreen(page, '/');
      extra.push(second);
      await waitForSynced(second);
      expect(await boardId(second)).not.toBe(firstBoard);
      await expect.poll(() => liveNoteIds(second)).toEqual([]);

      const theirs = await createNote(second, SPOTS[1]!, 'board two');

      // And the board that was left is as it was left.
      const reopened = await openScreen(page, `/b/${firstBoard}`);
      extra.push(reopened);
      await waitForSynced(reopened);
      await expectNoteText(reopened, mine, 'board one');
      await expectNotesOn([reopened], [mine]);
      expect((await liveNoteIds(second)).includes(mine)).toBe(false);
      expect((await liveNoteIds(reopened)).includes(theirs)).toBe(false);
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('two users at the same address start the same way (TC-27)', () => {
  test('both start empty, each creates one note, and both end up with exactly two', async ({
    page,
  }) => {
    const extra: Page[] = [];
    const id = await gotoNewBoard(page);
    const other = await openScreen(page, `/b/${id}`);
    extra.push(other);
    try {
      // Independent screens at one address, one starting state: empty.
      await expect.poll(() => liveNoteIds(page)).toEqual([]);
      await expect.poll(() => liveNoteIds(other)).toEqual([]);
      await Promise.all([waitForSynced(page), waitForSynced(other)]);

      const mine = await createNote(page, SPOTS[0]!, 'first user');
      const theirs = await createNote(other, SPOTS[1]!, 'second user');

      await expectNotesOn([page, other], [mine, theirs]);
      await expectSameBoard(page, other);
      // No duplicates: each note exists once, under one id, on both screens.
      expect(new Set(await liveNoteIds(page)).size).toBe(2);
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('boards are isolated (TC-28)', () => {
  test('five boards in five screens never cross-talk', async ({ page }) => {
    const extra: Page[] = [];
    const screens: Page[] = [page];
    const ids = new Set<string>([await gotoNewBoard(page)]);
    const notes: string[] = [];
    try {
      for (let board = 1; board < 5; board += 1) {
        const screen = await openScreen(page, '/');
        extra.push(screen);
        screens.push(screen);
        ids.add(await boardId(screen));
        // Each note says which board it belongs to; it must arrive nowhere else.
        notes.push(await createNote(screen, SPOTS[board]!, `board ${board}`));
        await expectNoteText(screen, notes[notes.length - 1]!, `board ${board}`);
      }
      expect(ids.size).toBe(5);
      expect(new Set(notes).size).toBe(4);

      // Cross-talk would show up as somebody else's note on some screen.
      for (const [index, screen] of screens.entries()) {
        await expect
          .poll(() => liveNoteIds(screen), { timeout: 5_000 })
          .toHaveLength(index === 0 ? 0 : 1);
      }
    } finally {
      await closeScreens(extra);
    }
  });
});

test.describe('the room is the only path (TC-29 network proof, reused by TC-22)', () => {
  test('every board message goes to a room socket, and there is no other peer', async ({
    page,
  }) => {
    const id = await gotoNewBoard(page);
    const other = await openSecondScreen(page);
    try {
      await Promise.all([waitForSynced(page), waitForSynced(other)]);
      const note = await createNote(page, SPOTS[0]!, 'room only');
      await expectNoteText(other, note, 'room only');

      for (const screen of [page, other]) {
        const log = await networkLog(screen);
        expect(log.sockets.length).toBeGreaterThan(0);
        for (const url of log.sockets) {
          expect(new URL(url).pathname).toBe(`/api/rooms/${id}`);
        }
        // No BroadcastChannel: two tabs of one browser do not sync around the room.
        expect(log.broadcastChannels).toBe(0);
        expect(log.received).toBeGreaterThan(0);
        expect(log.sent).toBeGreaterThan(0);
      }
    } finally {
      await closeScreens([other]);
    }
  });
});
