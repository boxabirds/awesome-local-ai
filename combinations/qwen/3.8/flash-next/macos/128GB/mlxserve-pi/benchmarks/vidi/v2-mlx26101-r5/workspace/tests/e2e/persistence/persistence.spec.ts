/**
 * Story 4: leaving and coming back to a board.
 *
 * Every test here throws a server away and starts another. That is the whole subject: the
 * promise is about the gap between two runs of the program, so the tests have to sit in it.
 * Each one gets a server of its own, in a directory of its own, on a port of its own — and
 * after it, whatever state the board is in has to have got there through the files, because
 * nothing else survives the gap.
 */

import { expect, test as base, type Browser } from '@playwright/test';

import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
} from '../../../src/shared/config';
import {
  badge,
  connectionState,
  EVENTUAL_TIMEOUT_MS,
  connectionStates,
  newBoard,
  openPersonPage,
  stopEditing,
  waitForConnected,
  noteCount,
  type Participant,
} from '../helpers/participants';
import {
  createNotesOnAGrid,
  expectNoteCount,
  noteStates,
  toolbarCreate,
  type NoteState,
} from '../helpers/board';
import {
  persistenceDir,
  resetPersistenceDir,
  restartRoomServer,
  startRoomServer,
  type RoomServer,
} from '../helpers/wrangler-process';
import { RoomClient } from '../helpers/room-client';

const COLORS = Object.keys(STICKY_COLORS);

/** A server a test can start, throw away and start again. */
interface RoomFixture {
  /** A server in a directory of its own, emptied first: the board has never been seen here. */
  start(name: string): Promise<RoomServer>;
  /** The same directory, in a process that has never met the board. */
  restart(server: RoomServer): Promise<RoomServer>;
}

const test = base.extend<{ room: RoomFixture }>({
  room: async ({}, use) => {
    const started: RoomServer[] = [];
    await use({
      start: async (name) => {
        const dir = persistenceDir(name);
        await resetPersistenceDir(dir);
        const server = await startRoomServer({ persistTo: dir, testHooks: true });
        started.push(server);
        return server;
      },
      restart: async (server) => {
        const again = await restartRoomServer(server);
        started.push(again);
        return again;
      },
    });
    // Every server this test touched goes with it, including one left running by a failure.
    for (const server of started) await server.stop().catch(() => undefined);
  },
});

/** A person on a board, in the room, on the server this test owns. */
async function openOn(
  browser: Browser,
  server: RoomServer,
  boardId: string,
  name: string,
): Promise<Participant> {
  const person = await openPersonPage(browser, name);
  await person.page.goto(server.boardAddress(boardId));
  await expect(person.page.getByTestId('app')).toBeVisible();
  await waitForConnected(person.page);
  return person;
}

/** Waits for the badge to go away, however long the board takes to come back. */
async function waitForBadgeGone(page: Participant['page'], timeoutMs: number): Promise<number> {
  const began = Date.now();
  await expect(badge(page), 'waiting for the board to come back').toHaveCount(0, { timeout: timeoutMs });
  return Date.now() - began;
}

test.describe('coming back to a board', () => {
  test(
    'overnight return: a board left and opened again is the board that was left',
    async ({ browser, room }) => {
    test.setTimeout(420_000);
    const server = await room.start('overnight');
    const boardId = newBoard();

    const alex = await openOn(browser, server, boardId, 'Alex');
    const before = await createNotesOnAGrid(alex.page, 25, COLORS);
    expect(before).toHaveLength(25);

    // Alex closes the tab and the browser goes with it.
    await alex.context.close();

    // And time passes, in the only way time can pass here: the process that was holding the
    // board is stopped and another one is started against the same files.
      const later = await room.restart(server);

      const back = await openOn(browser, later, boardId, 'Alex');
      await expectNoteCount(back.page, 25);
    const after = await noteStates(back.page);

    // Not "the same number of notes": the same board. Text, colour, position, stacking, and
    // the identity of every note, which is the part a rebuild from scratch would get wrong.
      expect(after).toEqual(before);
      expect(await connectionState(back.page)).toBe('connected');
    },
  );

  test('leave immediately: a change made and the browser closed at once is still there', async ({
    browser,
    room,
  }) => {
    test.setTimeout(420_000);
    const server = await room.start('leave-immediately');
    const boardId = newBoard();

    const alex = await openOn(browser, server, boardId, 'Alex');
    const sam = await openOn(browser, server, boardId, 'Sam');

    await toolbarCreate(alex.page);
    await alex.page.keyboard.type('Written down at the last moment');
    await stopEditing(alex.page);

    // The change is Sam's to see. That is the moment the board is required to have already
    // written it down, so this is the moment to stop everything — no graceful shutdown is
    // attempted after it, because there would be nothing left to flush.
    await expect
      .poll(() => noteCount(sam.page), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'waiting for Sam to see the note',
      })
      .toBe(1);

    await alex.context.close();
    await sam.context.close();
    await server.stop();

    const later = await room.restart(server);
    const back = await openOn(browser, later, boardId, 'Alex');
    await expectNoteCount(back.page, 1);
    const [only] = await noteStates(back.page);
    expect(only?.text).toBe('Written down at the last moment');
  });

  test('big board open: a board with thousands of notes arrives whole', async ({ browser, room }) => {
    test.setTimeout(600_000);
    const server = await room.start('large-board');
    const boardId = newBoard();

    // Written through the protocol rather than the interface, because clicking two thousand
    // times is not a test, it is an afternoon. What is asserted afterwards is in the interface.
    const writer = await RoomClient.connect(server.wsOrigin, boardId);
    const seeding = Date.now();
    writer.createNotes(PERSIST_TESTED_NOTES);
    await writer.settle();

    // A second client, asking the room from outside: proof the notes are in the room — and so,
    // since nothing is shown to anybody before it is written down, proof they are in storage.
    const stored = await RoomClient.connect(server.wsOrigin, boardId);
    await stored.waitForNotes(PERSIST_TESTED_NOTES);
    const seededIn = Date.now() - seeding;

    // The room is put where an idle period would have put it: the board is no longer in memory,
    // and the next person to open it is the reason it has to be read back.
    const hibernate = await fetch(server.hookAddress(boardId, 'hibernate'), { method: 'POST' });
    expect(hibernate.status).toBe(200);
    expect((await hibernate.json()).state).toBe('hibernated');

    await writer.close();
    await stored.close();

    const person = await openPersonPage(browser, 'Alex');
    const opening = Date.now();
    await person.page.goto(server.boardAddress(boardId));
    await expect(person.page.locator('.sticky-note'), 'waiting for the board to arrive').toHaveCount(
      PERSIST_TESTED_NOTES,
      { timeout: EVENTUAL_TIMEOUT_MS },
    );
    const renderedIn = Date.now() - opening;

    const notes = await noteStates(person.page);
    expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
    // Not a sample: every note is there, and each one says which of them it is.
    expect(new Set(notes.map((note) => note.text)).size).toBe(PERSIST_TESTED_NOTES);

    // Reported, not asserted — the budget is a scale, and this machine is a container.
    console.log(
      `big board: ${PERSIST_TESTED_NOTES} notes seeded in ${seededIn}ms; ` +
        `opened and rendered in ${renderedIn}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`,
    );

    await person.context.close();
  });

  test('broken board: says what is wrong, refuses to be edited, and recovers when it is mended', async ({
    browser,
    room,
  }) => {
    test.setTimeout(420_000);
    const server = await room.start('broken-board');
    const boardId = newBoard();

    const alex = await openOn(browser, server, boardId, 'Alex');
    const before = await createNotesOnAGrid(alex.page, 25, COLORS);

    // Fold the log into a snapshot, so that the thing damaged below is the bulk of the board
    // rather than one note's worth of log.
    const folded = await fetch(server.hookAddress(boardId, 'compact'), { method: 'POST' });
    expect(folded.status).toBe(200);
    expect(await folded.json()).toMatchObject({ ok: true, folded: true, chunks: 1 });

    // Damage it. The room finds out on its next look, and everybody on it is told.
    const damaged = await fetch(server.hookAddress(boardId, 'corrupt-snapshot'), { method: 'POST' });
    expect(damaged.status).toBe(200);
    expect((await damaged.json()).closedWith).toBe(4500);

    // The badge says what is wrong, in words a person can act on.
    await expect(badge(alex.page)).toHaveAttribute('data-state', 'load_failed');
    await expect(badge(alex.page)).toHaveText("This board couldn't be loaded. Retrying…");

    // Nothing on the board can be touched. The notes are still on screen — the page has not
    // forgotten them — but they are not editable, and no way in gets a change through.
    expect(await noteStates(alex.page)).toEqual(before);
    await expect(alex.page.getByTestId('create-sticky')).toBeDisabled();

    const beforeAttempt = await noteStates(alex.page);
    await alex.page.mouse.dblclick(640, 400);
    await expect(alex.page.locator('.sticky-editor')).toHaveCount(0);
    await alex.page.getByTestId('create-sticky').click({ force: true });
    expect(await noteStates(alex.page)).toEqual(beforeAttempt);

    // The state it went through, in order: it was told, it did not pretend otherwise.
    expect(await connectionStates(alex.page)).toContain('load_failed');

    // A sentinel on the window: if the page ever reloads itself, the number goes, and the test
    // below that says "without a reload" would be wrong to say it.
    await alex.page.evaluate(() => {
      (window as unknown as { sentinel: number }).sentinel = 1;
    });

    // Mend it.
    const repaired = await fetch(server.hookAddress(boardId, 'repair'), { method: 'POST' });
    expect(repaired.status).toBe(200);
    expect((await repaired.json()).repaired).toBeGreaterThanOrEqual(1);

    // And the board comes back on its own: the client keeps asking, the room keeps trying
    // again after a while, and when the bytes are whole again nobody has to do anything.
    const recoveredIn = await waitForBadgeGone(alex.page, 60_000);
    console.log(`broken board: recovered in ${recoveredIn}ms after the storage was mended`);

    expect(await alex.page.evaluate(() => (window as unknown as { sentinel: number }).sentinel)).toBe(1);
    expect(await noteStates(alex.page)).toEqual(before);
    expect(await connectionState(alex.page)).toBe('connected');

    // And it is a board again.
    await toolbarCreate(alex.page);
    await alex.page.keyboard.type('Twenty-six');
    await stopEditing(alex.page);
    const notes: NoteState[] = await noteStates(alex.page);
    expect(notes).toHaveLength(26);
    expect(notes.some((note) => note.text === 'Twenty-six')).toBe(true);
  });
});
