/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * The BoardRoom Durable Object: real Y.Docs, real WebSockets, real y-protocols
 * framing, no mocks (design: "Mock vs real boundaries").
 *
 * Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
 * design.md, coverage table "unit and integration", section `sync.room`.
 */
// What had to change here because of story 4, with the assertions left exactly
// as they were: the room no longer keeps a `sockets` Set of its own (the runtime
// holds the connections now, through `ctx.getWebSockets()`, which is the list
// that survives the object being evicted), so TC-31's dead socket goes to the
// room's write directly and the connection count is read off the runtime's list; and
// TC-18's "the room has no document" is now what the room does on its own every
// time a board goes idle.
import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import {
  SyncClient,
  allText,
  awarenessBody,
  awarenessFrame,
  canonicalNotes,
  ensureBoard,
  seeSameBoard,
  tick,
  unknownTypeFrame,
  updateFrame,
  waitFor,
  waitForAsync,
} from './helpers/ws-client';
import { applyRandomOperations, createRandom } from './helpers/random-ops';

/** Two people on the same board, both past their initial sync. */
const connectPair = async (boardId: string): Promise<{ a: SyncClient; b: SyncClient }> => {
  const a = await SyncClient.connect(boardId);
  const b = await SyncClient.connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return { a, b };
};

describe('a live board (sync.room)', () => {
  // TC-07: create, single writer, 2 participants.
  it('shows the other person the note that was just created (TC-07)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    expect(a.notes.length).toBe(0);

    const noteId = a.addNote({ x: 500, y: 300 });
    await waitFor(() => b.notes.length === 1, 'B to see the note A created');

    expect(b.notes).toEqual(a.notes);
    // The one change arrived as one update, not as a resync of the board.
    expect(b.updates.length).toBe(1);
    expect(b.syncStep2s).toBe(1); // the initial one, nothing since
    expect(b.notes[0]?.id).toBe(noteId);
    expect(b.notes[0]?.x).toBe(500 - STICKY_SIZE_WORLD / 2);
    expect(b.notes[0]?.y).toBe(300 - STICKY_SIZE_WORLD / 2);

    a.close();
    b.close();
  });

  // TC-08: one test per kind of change; the sender must not see its own change
  // come back (negative scenario).
  const kindsOfChange: Array<[string, (client: SyncClient, noteId: string) => void]> = [
    ['move', (client, noteId) => client.move(noteId, 800, 900)],
    ['recolour', (client, noteId) => client.setColor(noteId, 'blue')],
    ['text insert', (client, noteId) => client.type(noteId, 'typed afterwards')],
    ['delete', (client, noteId) => client.remove(noteId)],
  ];
  for (const [kind, change] of kindsOfChange) {
    it(`gives the other person a ${kind} and no echo back (TC-08)`, async () => {
      const boardId = newBoardId();
      const { a, b } = await connectPair(boardId);
      const noteId = a.addNote({ x: 100, y: 100 });
      await waitFor(() => b.notes.length === 1, 'B to see A creation');

      // B may still be delivering its own initial state to A; only what comes
      // after the change counts as an echo.
      const before = a.updates.length;
      change(a, noteId);
      await waitFor(() => seeSameBoard(a, b), `B to have A ${kind}`);
      await tick(100); // long enough for an echo to have arrived if there was one

      expect(a.updates.length, `no echo of A ${kind}`).toBe(before);
      expect(a.syncStep2s).toBe(1); // still only the initial one
      expect(canonicalNotes(a.notes)).toBe(canonicalNotes(b.notes));

      a.close();
      b.close();
    });
  }

  // TC-09: text insert, same note same property, 2 participants.
  it('keeps both pieces of simultaneous typing in the same order for both (TC-09)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const noteId = a.addNote({ x: 0, y: 0 });
    a.type(noteId, 'green');
    await waitFor(() => b.textOf(noteId) === 'green', 'the word to be on both screens');

    // Neither knows about the other yet: one writes at the front, one at the back.
    a.type(noteId, 'red ', 0);
    b.type(noteId, ' blue');

    await waitFor(
      () => a.textOf(noteId) === 'red green blue' && b.textOf(noteId) === 'red green blue',
      'both screens to read "red green blue"',
    );
    expect(a.textOf(noteId)).toBe(b.textOf(noteId));

    a.close();
    b.close();
  });

  // TC-10: move, same note same property, 2 participants.
  it('settles two simultaneous drags of one note on one position (TC-10)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const noteId = a.addNote({ x: 0, y: 0 });
    await waitFor(() => b.notes.length === 1, 'the note to reach B');

    a.move(noteId, 100, 0);
    b.move(noteId, 300, 0);

    await waitFor(
      () => a.notes[0]?.x === b.notes[0]?.x && a.notes[0]?.x !== undefined,
      'both screens to agree on one position',
    );
    expect(new Set([a.notes[0]?.x, b.notes[0]?.x]).size).toBe(1);
    // It is one of the two positions somebody dragged to, not a mixture.
    expect([100, 300]).toContain(a.notes[0]?.x);
    expect(seeSameBoard(a, b)).toBe(true);

    a.close();
    b.close();
  });

  // TC-11: writer vs deleter. Also the integration half of the negative
  // scenario "a deleted note must not come back because of a simultaneous edit".
  it('leaves a note deleted even while the other person was typing in it (TC-11)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const noteId = a.addNote({ x: 0, y: 0 });
    await waitFor(() => b.notes.length === 1, 'the note to reach B');

    // B is mid-edit; A deletes the same note without knowing.
    getStickyText(b.doc, noteId)?.insert(0, 'typed during the delete');
    a.remove(noteId);

    await waitFor(() => a.notes.length === 0 && b.notes.length === 0, 'the delete to land on both');
    await tick(100);
    expect(a.notes.length).toBe(0);
    expect(b.notes.length).toBe(0);
    // The typing is not hiding anywhere in either document.
    expect(allText(b).join('\n')).not.toContain('typed during the delete');
    expect(allText(a).join('\n')).not.toContain('typed during the delete');

    // And the room does not have it either: whoever comes now sees an empty board.
    const late = await SyncClient.connect(boardId);
    await late.waitForSync();
    expect(late.notes.length).toBe(0);
    // Nothing threw inside the room on the way: both connections are still open.
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();

    a.close();
    b.close();
    late.close();
  });

  // TC-12: full capacity, 200 seeded operations each. The seed is in the test
  // name, so a failure can be replayed exactly.
  it(
    `${MAX_CONCURRENT_EDITORS} people, 200 seeded operations each, one identical board at the end (TC-12, seed 20260917)`,
    async () => {
      const seed = 20260917;
      const operations = 200;
      const boardId = newBoardId();
      const clients: SyncClient[] = [];
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index++) {
        clients.push(await SyncClient.connect(boardId));
      }
      await Promise.all(clients.map((client) => client.waitForSync()));

      const reports = clients.map((client, index) =>
        applyRandomOperations(client.doc, createRandom(seed + index), operations),
      );

      await waitFor(
        () => seeSameBoard(...clients),
        `${MAX_CONCURRENT_EDITORS} screens to end on the same board`,
        20_000,
      );

      // What the generator guarantees is what the room must deliver: a note
      // belongs to the board unless its own author deleted it.
      const created = reports.flatMap((report) => report.created);
      const deleted = new Set(reports.flatMap((report) => report.deleted));
      const expected = created.filter((id) => !deleted.has(id));
      expect(clients[0]?.notes.length).toBe(expected.length);
      for (const id of expected) {
        expect(clients[0]?.notes.some((note) => note.id === id), id).toBe(true);
      }
      for (const id of deleted) {
        expect(clients[0]?.notes.some((note) => note.id === id), id).toBe(false);
      }

      for (const client of clients) client.close();
    },
  );

  // TC-14: two people fill the board, a late joiner is handed it as it is.
  it('hands a board of 40 notes to the person who joins last (TC-14)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    for (let index = 0; index < 20; index++) {
      a.addNote({ x: index * 250, y: 0 });
      b.addNote({ x: 0, y: index * 250 });
    }
    await waitFor(() => seeSameBoard(a, b), 'both people to see all 40 notes');

    const late = await SyncClient.connect(boardId);
    await late.waitForSync();
    await waitFor(
      () => canonicalNotes(late.notes) === canonicalNotes(a.notes),
      'the late joiner to be handed the whole board',
    );
    expect(late.notes.length).toBe(40);

    a.close();
    b.close();
    late.close();
  });

  // TC-15: malformed traffic, four runs. The negative scenario is that the
  // trouble does not spread: the room's document and everyone else survive.
  const malformedTraffic: Array<[string, (client: SyncClient) => void]> = [
    ['a text frame instead of bytes', (client) => client.sendText('hello')],
    [
      'bytes that stop in the middle of a message',
      (client) => client.sendRaw(Uint8Array.from([syncProtocol.messageYjsSyncStep1])),
    ],
    ['a message type nobody defined', (client) => client.sendRaw(unknownTypeFrame(9))],
    [
      'bytes that are not a Yjs update',
      (client) => client.sendRaw(updateFrame(Uint8Array.from([1, 2, 3, 9, 9, 9]))),
    ],
  ];
  for (const [description, sendGarbage] of malformedTraffic) {
    it(`closes the sender that sent ${description} and no one else (TC-15)`, async () => {
      const boardId = newBoardId();
      const { a, b } = await connectPair(boardId);
      const noteId = b.addNote({ x: 5, y: 5 });
      await waitFor(() => a.notes.length === 1, 'the note to be on both screens');

      sendGarbage(a);
      expect(await a.waitForClose(), description).toBe(CLOSE_UNSUPPORTED_DATA);

      // The room's document is unchanged: whoever connects now is handed the
      // one note and nothing of the garbage.
      const late = await SyncClient.connect(boardId);
      await late.waitForSync();
      await waitFor(() => late.notes.length === 1, 'the late joiner to see the board');
      expect(late.notes[0]?.id).toBe(noteId);

      // The innocent client is still connected and still getting changes.
      const otherId = b.addNote({ x: 6, y: 6 });
      await waitFor(
        () => late.notes.some((note) => note.id === otherId),
        'the late joiner to still receive what B does next',
      );
      expect(b.closeCode).toBeNull();
      expect(b.notes.length).toBe(2);

      b.close();
      late.close();
    });
  }

  // TC-16: awareness relay.
  it('relays presence bytes to everyone without touching them (TC-16)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const body = awarenessBody(7);

    b.sendAwareness(body);
    await waitFor(() => a.awarenessReceived.length === 1, 'A to receive the presence message');
    // The sender gets its own copy back, which is what stops an idle client
    // concluding the connection is dead. Who is here and who left: story 6.
    await waitFor(() => b.awarenessReceived.length === 1, 'B to receive its own presence message');

    expect([...(a.awarenessReceived[0] as Uint8Array)]).toEqual([...awarenessFrame(body)]);
    expect([...(b.awarenessReceived[0] as Uint8Array)]).toEqual([...awarenessFrame(body)]);
    expect([...(a.awarenessReceived[0] as Uint8Array)]).toEqual(
      [...(b.awarenessReceived[0] as Uint8Array)],
    );

    a.close();
    b.close();
  });

  // TC-18: room restart. A room object that starts with no document is what a
  // fresh instance is, so a second object id of the same board stands in for
  // the one a deploy replaced; the close handshake is not what is under test.
  it('gets its board back from the first person who comes back after the document was lost (TC-18)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    const noteId = a.addNote({ x: 5, y: 6 });
    a.type(noteId, 'before the restart');
    await waitFor(() => seeSameBoard(a, b), 'the board to hold the content');
    const beforeRestart = canonicalNotes(a.notes);

    // Every connection is down and the board starts from nothing: the client
    // sides hang up, and the room object we are about to use is a different
    // instance, which is what a deploy or an eviction leaves behind. (The close
    // handshake itself is not what is under test here.)
    a.hangUpWithoutSayingGoodbye();
    b.hangUpWithoutSayingGoodbye();
    const restarted = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(`${boardId}-restarted`));
    // Story 5: a room only serves a board that exists, and this stand-in for the
    // post-deploy instance is a fresh DO name, so the board is created (empty) —
    // it exists but this instance holds no document, which is what the test is
    // about: a returning person fills the empty room back in.
    await ensureBoard(`${boardId}-restarted`);

    // A comes back first, with the document still in the page's memory.
    const aBack = await SyncClient.connectWith(boardId, a.doc, restarted);
    await aBack.waitForSync();
    expect(canonicalNotes(aBack.notes)).toBe(beforeRestart);

    // The room itself now holds exactly what A had: A's SyncStep2 repopulated
    // the empty document of the new instance.
    const roomNotes = await runInDurableObject(restarted, (room) =>
      canonicalNotes(snapshot((room as unknown as { doc: Y.Doc | null }).doc as Y.Doc)),
    );
    expect(roomNotes).toBe(beforeRestart);

    // …the room has it now, so B is handed it from there rather than from A.
    const bBack = await SyncClient.connectWith(boardId, b.doc, restarted);
    await bBack.waitForSync();
    await waitFor(() => seeSameBoard(aBack, bBack), 'both to converge on the restarted room');
    expect(canonicalNotes(bBack.notes)).toBe(beforeRestart);

    aBack.close();
    bBack.close();
  });

  // TC-31: error path "a write to a dead socket drops that socket".
  it('keeps relaying after a write to a connection that died mid-flight (TC-31)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);

    // B hangs up without letting the room know: the room is left holding a
    // connection that is already gone. Story 3 reached into the room's own set of
    // connections and added a socket that throws on write; story 4 gave that list
    // to the runtime (`ctx.getWebSockets()`, which only ever holds live ones), so
    // the dead socket is handed to the room's own write instead — the same call
    // the relay loop makes, one step away. The runtime will not half-close a
    // connection on request, which is why both halves are needed.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    const survived = await runInDurableObject(stub, (room) => {
      try {
        writeThrough(room, deadSocket(), new Uint8Array([0, 2, 1, 0]));
        return true;
      } catch {
        return false;
      }
    });
    expect(survived).toBe(true);
    b.hangUpWithoutSayingGoodbye();

    const noteId = a.addNote({ x: 9, y: 10 });
    a.type(noteId, 'after the dead socket');

    // The failed write did not take the room down with it: a new connection
    // still gets the board, and still gets what comes after.
    const c = await SyncClient.connect(boardId);
    await c.waitForSync();
    expect(c.notes.length).toBe(1);
    expect(c.textOf(noteId)).toBe('after the dead socket');
    const lateId = a.addNote({ x: 11, y: 12 });
    await waitFor(
      () => c.notes.some((note) => note.id === lateId),
      'the new connection to still receive updates',
    );

    a.close();
    c.close();
  });

  // The other half of TC-18, and the thing that keeps TC-29 quiet: a person who
  // goes away politely is told about it, so their page stops believing it is in
  // the room at once rather than half a minute later when the browser gives up.
  it('finishes the closing handshake with a person who goes away', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectPair(boardId);
    // The room's own connections are only visible from inside the room.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    const held = (): Promise<number> => runInDurableObject(stub, (room) => heldBy(room));
    await waitForAsync(async () => (await held()) === 2, 'the room to be holding both connections');

    // A tab closing: a close frame goes out and an answer comes back. Whether the
    // answer carries a status (1000, as a browser reports it) or none at all
    // (1005) is the platform's choice; what matters is that the page is told at
    // once, rather than sitting in CLOSING until its browser gives up.
    a.close();
    expect([1000, 1005]).toContain(await a.waitForClose());

    // Nobody else is disturbed, and the room is left holding the connection that
    // is still there.
    expect(b.closeCode).toBeNull();
    await waitForAsync(async () => (await held()) === 1, 'the room to have let the connection go');

    // The board goes on being a board: the person who stayed makes a change and
    // the room itself takes it. (The room's own state is read from inside the
    // room, through the object the runtime hands to the callback.)
    const lateId = b.addNote({ x: 1, y: 2 });
    await waitForAsync(
      async () =>
        (
          await runInDurableObject(stub, (room) =>
            canonicalNotes(snapshot((room as unknown as { doc: Y.Doc | null }).doc as Y.Doc)),
          )
        ).includes(`"id":"${lateId}"`),
      'the room to hold what the person who stayed made',
    );

    b.close();
  });
});

/** The live object's open connections — private to the class, open to tests. */
/** How many connections the room is holding: the runtime's list, read from
 * inside the room. Story 3 read the room's own Set here; story 4 handed that
 * list to the runtime, because it is the list that survives the object being
 * evicted out from under it. */
const heldBy = (room: unknown): number =>
  (room as { ctx: { getWebSockets(): WebSocket[] } }).ctx.getWebSockets().length;

/** One call of the room's own write, with a connection the caller supplies. */
const writeThrough = (room: unknown, socket: WebSocket, payload: Uint8Array): void => {
  (room as unknown as { send(socket: WebSocket, payload: Uint8Array): void }).send(socket, payload);
};

/** A connection that throws the moment anything is written to it. */
const deadSocket = (): WebSocket =>
  ({
    send(): void {
      throw new Error('the connection is gone');
    },
    close(): void {
      // closing a socket that is already gone is not worth reporting
    },
  }) as unknown as WebSocket;
