/**
 * Integration tests for the board's room: one Durable Object, its document, and
 * the people connected to it.
 *
 * Real WebSockets through the real Worker, real Yjs on both sides — the only
 * difference from a browser is that these clients are driven by the test.
 * `TC-nn` ids are the ones the story's acceptance list uses.
 *
 * TC-07 a note made by one person appears for the other, once
 * TC-08 move, recolour, typing and delete each reach the other person, with no
 *         echo back to the one who did it
 * TC-09 text written into one note at the same time is kept on both screens
 * TC-10 a field written at the same time settles the same way on both screens
 * TC-11 a note deleted while somebody is typing in it stays deleted
 * TC-12 everybody editing at once still ends with one identical board
 * TC-14 a person arriving late sees the board as it is now
 * TC-15 a broken message closes one connection and changes nothing else
 * TC-16 presence is relayed to everybody, unchanged
 * TC-18 a room that restarted rebuilds the board from the people in it
 * TC-31 a socket that died does not take the room down with it
 */
import { describe, expect, it } from 'vitest';
import { env, evictDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';

import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA, encodeSyncMessage } from '../../src/shared/protocol';
import { TestClient } from './ws-client';
import { newSeed, runRandomOps } from './random-ops';

/** Document frames only, which is what "an update" means here. */
const updates = (client: TestClient) => client.received.filter((entry) => entry.kind === 'sync');

/** Presence frames only. */
const presences = (client: TestClient) =>
  client.received.filter((entry) => entry.kind === 'awareness');

/** Two screens showing the same board, down to the stacking order. */
const sameBoard = (a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Two people on a board, both up to date with it and with an empty message log. */
async function twoPeople(): Promise<{ a: TestClient; b: TestClient; boardId: string }> {
  const boardId = newBoardId();
  const first = await TestClient.connect(boardId);
  const second = await TestClient.connect(boardId);
  await first.client.waitForSync();
  await second.client.waitForSync();
  first.client.clearLog();
  second.client.clearLog();
  return { a: first.client, b: second.client, boardId };
}

/** Waits until every client shows exactly the same board as every other. */
async function waitForOneBoard(clients: TestClient[]): Promise<void> {
  await Promise.all(
    clients.map((client) =>
      client.waitForDoc(() =>
        clients.every((other) => sameBoard(client.snapshot(), other.snapshot())),
      ),
    ),
  );
  // And the board has said nothing since: nothing is still on its way.
  await Promise.all(clients.map((client) => client.quiet()));
}

/** The board as the room itself holds it, read by somebody arriving now. */
async function roomBoard(boardId: string): Promise<readonly StickySnapshot[]> {
  const { client } = await TestClient.connect(boardId);
  await client.waitForSync();
  const notes = client.snapshot();
  client.close();
  return notes;
}

describe('board room', () => {
  it('TC-07: a note made by one person appears for the other person, exactly once', async () => {
    const { a, b } = await twoPeople();

    const id = createSticky(a.doc, { x: 10, y: 20 });
    await b.waitForMessages(1);
    await b.quiet();
    // One frame, and it is the whole change.
    expect(updates(b)).toHaveLength(1);
    expect(b.kinds()).toEqual(['sync']);
    expect(snapshot(b.doc)).toEqual(snapshot(a.doc));
    expect(snapshot(b.doc).map((note) => note.id)).toEqual([id]);
    // The room does not send a change back to the person who made it.
    expect(a.received).toHaveLength(0);

    // How long the next change takes, measured and reported against the budget.
    const second = createSticky(a.doc, { x: 90, y: 20 });
    const arrivedAfter = await b.timeUntil((doc) =>
      snapshot(doc).some((note) => note.id === second),
    );
    console.log(`TC-07: the change reached the other person in ${arrivedAfter.toFixed(1)}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
  });

  describe.each([
    {
      kind: 'move',
      apply: (doc: Y.Doc, id: string) => moveObject(doc, id, 400, 250),
    },
    {
      kind: 'recolour',
      apply: (doc: Y.Doc, id: string) => setStickyColor(doc, id, 'blue'),
    },
    {
      kind: 'text insert',
      apply: (doc: Y.Doc, id: string) => {
        const text = getStickyText(doc, id);
        if (text === undefined) return false;
        text.insert(0, 'shipped ');
        return text.toString().startsWith('shipped ');
      },
    },
    {
      kind: 'delete',
      apply: (doc: Y.Doc, id: string) => deleteObject(doc, id),
    },
  ])('TC-08: $kind', ({ apply }) => {
    it('reaches the other person and is not echoed back', async () => {
      const { a, b } = await twoPeople();
      const id = createSticky(a.doc, { x: 10, y: 20 });
      await b.waitForDoc((doc) => snapshot(doc).some((note) => note.id === id));
      a.clearLog();
      b.clearLog();

      expect(apply(a.doc, id)).toBeTruthy();

      await b.waitForDoc((doc) => sameBoard(snapshot(doc), snapshot(a.doc)));
      expect(snapshot(b.doc)).toEqual(snapshot(a.doc));
      expect(a.received).toHaveLength(0);
    });
  });

  it('TC-09: text written into one note at the same time is kept on both screens', async () => {
    const { a, b } = await twoPeople();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'green');
    await b.waitForDoc((doc) => snapshot(doc)[0]?.text === 'green');

    // Both people write at once, each from the same starting text: one before the
    // word, one after it. Neither has the other's change yet, so neither wins.
    a.local((doc) => getStickyText(doc, id)?.insert(0, 'red '));
    b.local((doc) => getStickyText(doc, id)?.insert(5, ' blue'));

    await waitForOneBoard([a, b]);
    expect(snapshot(a.doc)[0]!.text).toBe('red green blue');
    expect(snapshot(b.doc)[0]!.text).toBe('red green blue');
  });

  it('TC-10: a field written at the same time settles the same way on both screens', async () => {
    const { a, b } = await twoPeople();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await b.waitForDoc((doc) => snapshot(doc).some((note) => note.id === id));

    // Both drag the same note, to different places, before either has seen the
    // other. A field holds one value, so one of the two wins — the point is that
    // both screens agree on which.
    a.local((doc) => moveObject(doc, id, 100, 100));
    b.local((doc) => moveObject(doc, id, 300, 300));

    await waitForOneBoard([a, b]);
    const x = snapshot(a.doc)[0]!.x;
    expect([100, 300]).toContain(x);
    expect(snapshot(b.doc)[0]!.x).toBe(x);
  });

  it('TC-11: a note deleted while somebody is typing in it stays deleted', async () => {
    const { a, b } = await twoPeople();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await b.waitForDoc((doc) => snapshot(doc).some((note) => note.id === id));

    // One person deletes the note at the same moment the other writes in it.
    const text = getStickyText(b.doc, id);
    expect(text).toBeDefined();
    text?.insert(0, 'meanwhile');
    a.local((doc) => deleteObject(doc, id));

    await waitForOneBoard([a, b]);
    // The note is gone from both screens and the typing cannot bring it back.
    expect(snapshot(a.doc)).toEqual([]);
    expect(snapshot(b.doc)).toEqual([]);
    expect(b.doc.getMap('objects').has(id)).toBe(false);
    expect(JSON.stringify(snapshot(b.doc))).not.toContain('meanwhile');
    expect(JSON.stringify(snapshot(a.doc))).not.toContain('meanwhile');
  });

  it('TC-12: everybody editing at once still ends with one identical board', async () => {
    const boardId = newBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const { client } = await TestClient.connect(boardId);
      clients.push(client);
    }
    await Promise.all(clients.map((client) => client.waitForSync()));

    const seed = newSeed();
    console.log(`TC-12: seed ${seed} (replay with runRandomOps(doc, seed, 200))`);
    const OPS = 200;
    const runs = await Promise.all(
      clients.map((client, i) => runRandomOps(client.doc, seed + i, OPS)),
    );

    await waitForOneBoard(clients);

    // All screens show one board, note for note and word for word.
    const boards = new Set(clients.map((client) => JSON.stringify(client.snapshot())));
    expect(boards.size).toBe(1);

    // And every note anybody made is there, unless somebody cleared it away.
    const deleted = new Set(runs.flatMap((run) => run.deleted));
    const expected = runs.flatMap((run) => run.created).filter((id) => !deleted.has(id));
    const seen = new Set(clients[0]!.snapshot().map((note) => note.id));
    for (const id of expected) expect(seen.has(id)).toBe(true);
    for (const id of deleted) expect(seen.has(id)).toBe(false);
    expect(clients[0]!.snapshot().length).toBe(expected.length);
    console.log(
      `TC-12: ${clients.length} clients x ${OPS} edits -> ${expected.length} notes left, all identical`,
    );
  });

  it('TC-14: a person arriving late sees the board as it is now', async () => {
    const { a, b, boardId } = await twoPeople();

    // Two people make 20 notes between them.
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i * 40, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i * 40, y: 200 });
    await waitForOneBoard([a, b]);
    expect(a.snapshot()).toHaveLength(20);

    // The newcomer is handed the board as it stands.
    const late = await TestClient.connect(boardId);
    await late.client.waitForSync();

    expect(snapshot(late.client.doc)).toEqual(snapshot(a.doc));
    expect(late.client.snapshot()).toHaveLength(20);
    late.client.close();
  });

  it('TC-15: a broken message closes one connection and changes nothing else', async () => {
    const broken: { what: string; frame: ArrayBuffer | string }[] = [
      { what: 'a text frame', frame: 'not a board message' },
      { what: 'a frame that stops before its body', frame: new Uint8Array([0]).buffer },
      { what: 'a type the room does not know', frame: new Uint8Array([9, 1, 2, 3]).buffer },
      {
        what: 'bytes that are not a Yjs update',
        frame: encodeSyncMessage(new Uint8Array([5, 0, 1])).buffer as ArrayBuffer,
      },
    ];

    for (const { what, frame } of broken) {
      console.log(`TC-15: broken frame — ${what}`);
      const bystander = await TestClient.onNewBoard();
      const offender = await TestClient.connect(bystander.boardId);
      await offender.client.waitForSync();
      const other = await TestClient.connect(bystander.boardId);
      await other.client.waitForSync();
      bystander.clearLog();
      other.client.clearLog();

      offender.client.sendRaw(frame);

      // The person who sent it is dropped...
      expect(await offender.client.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);
      // ...the board is untouched: it is still the empty board the bystander is
      // looking at, and nobody else was even told about the frame.
      await bystander.quiet();
      expect(bystander.received).toHaveLength(0);
      expect(snapshot(bystander.doc)).toEqual([]);
      expect(other.client.closeCode).toBeUndefined();

      // And the room still works for the people who stayed: a change by one of
      // them arrives at the other.
      createSticky(bystander.doc, { x: 5, y: 5 });
      await other.client.waitForMessages(1);
      expect(sameBoard(snapshot(other.client.doc), snapshot(bystander.doc))).toBe(true);
      bystander.close();
      other.client.close();
    }
  });

  it('TC-16: presence is relayed to everybody, unchanged', async () => {
    const { a, b } = await twoPeople();

    const first = a.sendPresence({ user: 'bee' });
    await a.waitForMessages(1);

    // Every socket on the board gets the frame, the sender included — which is how
    // an idle connection keeps hearing something and stays up — and the bytes are
    // the ones that went in.
    await a.quiet();
    expect(presences(a).map((entry) => entry.payload)).toEqual([first]);
    expect(presences(b).map((entry) => entry.payload)).toEqual([first]);

    const second = a.sendPresence({ cursor: { x: 12, y: 9 } });
    await a.waitForMessages(2);
    await a.quiet();
    expect(presences(a).map((entry) => entry.payload)).toEqual([first, second]);
    expect(presences(b).map((entry) => entry.payload)).toEqual([first, second]);

    // Asking who else is here is not an error, and is not answered in this story:
    // the room keeps no presence of its own.
    a.clearLog();
    b.clearLog();
    a.sendQueryAwareness();
    await a.quiet();
    expect(a.received).toHaveLength(0);
    expect(b.received).toHaveLength(0);
    expect(a.closeCode).toBeUndefined();
    expect(b.closeCode).toBeUndefined();
  });

  it('TC-18: a room that restarted rebuilds the board from the people in it', async () => {
    const { a, b, boardId } = await twoPeople();
    createSticky(a.doc, { x: 0, y: 0 });
    createSticky(b.doc, { x: 100, y: 0 });
    await waitForOneBoard([a, b]);
    const board = snapshot(a.doc);
    expect(board).toHaveLength(2);

    // The room goes away: everybody is disconnected and the object is evicted, so
    // its in-memory document is gone — the same shape as a deploy or an eviction.
    a.close();
    b.close();
    await evictDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)), {
      webSockets: 'close',
    });

    // The first person back still has the whole board, and hands it over as part of
    // re-syncing; the room they land in is otherwise empty.
    const back = await a.reconnect();
    await back.waitForSync();
    expect(snapshot(back.doc)).toEqual(board);
    expect(await roomBoard(boardId)).toEqual(board);

    // The second person arrives with nothing the room did not already get, so both
    // screens and the room hold one board.
    const other = await b.reconnect();
    await other.waitForSync();
    await waitForOneBoard([back, other]);
    expect(snapshot(other.doc)).toEqual(board);
    expect(await roomBoard(boardId)).toEqual(board);
  });

  it('TC-31: a socket that died does not take the room down with it', async () => {
    const { a, b, boardId } = await twoPeople();

    // One connection dies without a proper goodbye.
    b.close(1001, 'gone');
    await b.waitForClose();

    // The next change is applied anyway: the room finds the dead socket on its own.
    const id = createSticky(a.doc, { x: 7, y: 7 });
    await a.quiet();

    // Somebody arriving now sees the change, so the room is alive and telling.
    const later = await TestClient.connect(boardId);
    await later.client.waitForSync();
    expect(snapshot(later.client.doc).map((note) => note.id)).toEqual([id]);
    expect(a.closeCode).toBeUndefined();
    later.client.close();
  });
});
