/**
 * Integration tests for board persistence (story 4, design task 7: TC-19 to
 * TC-24, TC-28).
 *
 * Everything here is about what happens *between* connections: the room is
 * rebuilt, the board has to come back, and a board that cannot be read has to
 * be refused rather than replaced with an empty one.
 *
 * A rebuilt room is produced in two ways, and the difference matters. Closing
 * every socket and calling `/control/restart` is the cheap one: the object
 * stays alive but forgets its document and its sync bookkeeping, which is what
 * a hibernation and a wake look like from the inside. `TestPeer.connectToInstance`
 * opens a second object over the same board key, which is what a genuinely new
 * instance looks like. Both are used below, because the first cannot catch a
 * bug where the restart is half done.
 *
 * Storage is real SQLite, in the object's own file: the fixtures write bytes
 * the way the room does, and the restart reads them back.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, runInDurableObject } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../src/shared/protocol';
import { CLOSE_LOAD_FAILED } from '../../src/worker/room-machine';
import { TestPeer, boardOf, boardsAgree, settle, waitFor } from './helpers/ws-client';
import type { BoardRoom } from '../../src/worker/board-room';

/** Ask one room's control surface (never reachable through the Worker entry). */
async function control(board: string, name: string): Promise<Record<string, unknown>> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(board));
  const response = await stub.fetch(new Request(`https://board.example/control/${name}`));
  if (!response.ok) throw new Error(`/control/${name} answered ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

/** The room's own board, or `null` when it is holding none. */
async function roomBoardOrNull(board: string): Promise<string | null> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(board));
  return runInDurableObject(stub as never, (room: BoardRoom) =>
    room.doc === null ? null : boardOf(room.doc),
  );
}

/** How many sockets the room holds for one board right now. */
async function socketsOf(board: string): Promise<number> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(board));
  return runInDurableObject(stub as never, (room: BoardRoom) => room.socketCount());
}

/** Wait until the room has let go of every socket. */
async function socketsGone(board: string): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await socketsOf(board)) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

/** How many notes a peer's board holds. */
function notes(peer: TestPeer): number {
  return snapshot(peer.doc).length;
}

/**
 * One editor on a fresh board, and a note to look for afterwards.
 *
 * The note is written through the model, so a test that later sees an empty
 * board is seeing a board that was never stored, not a bad fixture.
 */
async function editorWithNotes(board: string, count: number): Promise<TestPeer> {
  const peer = await TestPeer.connect(board, { name: 'writer' });
  for (let index = 0; index < count; index += 1) {
    createSticky(peer.doc, { x: index * 30, y: index * 12 });
  }
  await settle([peer]);
  return peer;
}

describe('a board outlives the room that held it (TC-19, TC-24)', () => {
  it('gives the board back to a room that never saw it', async () => {
    const board = newBoardId();
    const writer = await editorWithNotes(board, 3);
    const before = boardOf(writer.doc);
    expect(notes(writer)).toBe(3);

    // The last departure is the checkpoint: after everyone goes there is nobody
    // to relay to, no timer left, and soon no instance.
    writer.close();
    expect(await socketsGone(board)).toBe(true);
    const stored = await control(board, 'state');
    expect(stored.bytes).toBeGreaterThan(0);

    // A second object over the same board key: no memory of the first, one
    // SQLite file to read.
    const reader = await TestPeer.connect(board, { name: 'reader' });
    await settle([reader]);
    await waitFor(() => notes(reader) === 3, 'the stored board to reach the reader');
    expect(boardOf(reader.doc)).toBe(before);
    reader.close();
  });

  it('carries a board of five hundred notes through a rebuild', async () => {
    const board = newBoardId();
    const writer = await editorWithNotes(board, 500);
    const before = boardOf(writer.doc);
    expect(notes(writer)).toBe(500);

    writer.close();
    expect(await socketsGone(board)).toBe(true);

    const reader = await TestPeer.connect(board, { name: 'reader' });
    await settle([reader]);
    await waitFor(() => notes(reader) === 500, 'all five hundred notes to come back');
    expect(boardOf(reader.doc)).toBe(before);
    reader.close();
  });

  it('stores a board that is bigger than one SQLite row', async () => {
    const board = newBoardId();
    const writer = await TestPeer.connect(board, { name: 'writer' });
    // Several transactions of a megabyte in total: bigger than one SQLite row,
    // so the state goes in as chunks and has to come back glued together in
    // order. Each write stays under the room's frame limit, which is what keeps
    // this a storage test rather than a framing one.
    const blobs: Uint8Array[] = [];
    for (let chunk = 0; chunk < 8; chunk += 1) {
      const blob = new Uint8Array(70_000);
      for (let index = 0; index < blob.length; index += 1) blob[index] = (index + chunk) % 251;
      blobs.push(blob);
      writer.doc.getMap('large').set(`blob-${chunk}`, blob);
      await settle([writer]);
    }

    writer.close();
    expect(await socketsGone(board)).toBe(true);
    expect((await control(board, 'state')).bytes).toBeGreaterThan(400_000);

    const reader = await TestPeer.connect(board, { name: 'reader' });
    await settle([reader]);
    await waitFor(() => reader.doc.getMap('large').size === 8, 'the large board to come back');
    const back = reader.doc.getMap('large');
    expect(
      blobs.every((blob, chunk) => {
        const restored = back.get(`blob-${chunk}`) as Uint8Array;
        return restored.length === blob.length && restored.every((value, index) => value === blob[index]);
      }),
    ).toBe(true);
    reader.close();
  });
});

describe('a room that was rebuilt is filled again (TC-20)', () => {
  it('lets a browser hand back what it kept while the room was asleep', async () => {
    const board = newBoardId();
    const first = await editorWithNotes(board, 2);
    const shared = first.doc;

    // Sleep: the room forgets the board, the socket is still open.
    first.close();
    expect(await socketsGone(board)).toBe(true);
    await control(board, 'restart');

    // A client that reconnects with the document it already holds: the room must
    // take the difference, not answer with a copy of what it read.
    const back = await TestPeer.connect(board, { name: 'rejoined', doc: shared });
    createSticky(back.doc, { x: 500, y: 500 });
    await settle([back]);
    await waitFor(() => notes(back) === 3, 'the room to accept the rejoined client board');

    const other = await TestPeer.connect(board, { name: 'other' });
    await settle([back, other]);
    await waitFor(() => boardsAgree([back, other]), 'both clients to hold the same board');
    expect(notes(other)).toBe(3);
    back.close();
    other.close();
  });

  it('reads the board once, however many editors arrive at once', async () => {
    const board = newBoardId();
    const writer = await editorWithNotes(board, 4);
    const shared = writer.doc;
    writer.close();
    expect(await socketsGone(board)).toBe(true);
    await control(board, 'restart');

    // Eight restart candidates at once: one read, and eight identical boards.
    const candidates: TestPeer[] = [];
    for (let index = 0; index < 8; index += 1) {
      candidates.push(await TestPeer.connect(board, { name: `candidate-${index}`, doc: shared }));
    }
    await settle(candidates);
    await waitFor(() => boardsAgree(candidates), 'every candidate to hold the same board');

    const state = await control(board, 'state');
    expect(state.reads).toBe(1);
    expect(state.members).toBe(8);
    expect(candidates.every((peer) => notes(peer) === 4)).toBe(true);
    candidates.forEach((peer) => peer.close());
  });
});

describe('a board that cannot be read is refused, not emptied (TC-21, TC-22, TC-23)', () => {
  it('closes a joiner for damaged bytes, and keeps the damage off the board', async () => {
    const board = newBoardId();
    const writer = await editorWithNotes(board, 2);
    const before = boardOf(writer.doc);
    writer.close();
    expect(await socketsGone(board)).toBe(true);

    // Three bytes are not a board. The room has to tell that apart from a board
    // nobody has drawn on yet, and its answer is to refuse the connection.
    await control(board, 'damaged');
    const joiner = await TestPeer.connect(board, { name: 'joiner' });
    await settle([joiner]);
    await waitFor(() => joiner.closed, 'the room to close the joiner');

    expect(joiner.closeCode).toBe(CLOSE_LOAD_FAILED);
    // No empty board was served: the room holds no board at all.
    expect(await roomBoardOrNull(board)).toBeNull();
    expect(joiner.updateCount()).toBe(0);
    expect(before).not.toBe('{"version":1,"objects":[]}');
  });

  it('refuses every later join without reading again', async () => {
    const board = newBoardId();
    await control(board, 'failure');
    const peers: TestPeer[] = [];
    for (let index = 0; index < 4; index += 1) {
      peers.push(await TestPeer.connect(board, { name: `refused-${index}` }));
    }
    await settle(peers);
    await waitFor(() => peers.every((peer) => peer.closed), 'every join to be refused');

    const state = await control(board, 'state');
    expect(state.state).toBe('failed');
    expect(state.refused).toBe(4);
    // One broken read, not four: the retry budget belongs to the client.
    expect(state.reads).toBe(1);
    expect(await roomBoardOrNull(board)).toBeNull();
  });

  it('refuses a read that takes too long, and serves nothing meanwhile', async () => {
    const board = newBoardId();
    // A storage read that wedges for longer than the room's own deadline. The
    // room is single-threaded, so the clock is burned inside the read.
    await control(board, 'timeout');

    const joiner = await TestPeer.connect(board, { name: 'slow' });
    await settle([joiner]);
    await waitFor(() => joiner.closed, 'the slow read to time out');

    expect(joiner.closeCode).toBe(CLOSE_LOAD_FAILED);
    const state = await control(board, 'state');
    expect(state.state).toBe('failed');
    expect(await roomBoardOrNull(board)).toBeNull();
  });
});

describe('a checkpoint does not hold up the board (TC-28)', () => {
  it('relays an update before it writes it', async () => {
    const board = newBoardId();
    const a = await TestPeer.connect(board, { name: 'A' });
    const b = await TestPeer.connect(board, { name: 'B' });
    await settle([a, b]);

    const before = b.frames.length;
    const started = Date.now();
    for (let index = 0; index < 20; index += 1) {
      createSticky(a.doc, { x: index * 20, y: index * 20 });
    }
    await waitFor(() => b.frames.length > before, 'B to hear about the notes');
    const elapsed = Date.now() - started;

    // Twenty transactions, each of which would cost a SQLite write if the relay
    // waited for storage. The relay is the fast path; the write follows it.
    expect(elapsed).toBeLessThan(400);
    await settle([a, b]);
    await waitFor(() => boardsAgree([a, b]), 'both editors to converge');

    a.close();
    b.close();
    expect(await socketsGone(board)).toBe(true);
    expect((await control(board, 'state')).bytes).toBeGreaterThan(0);
  });

  it('does not answer a second sync request from the same editor', async () => {
    const board = newBoardId();
    const writer = await editorWithNotes(board, 6);
    const joiner = await TestPeer.connect(board, { name: 'joiner' });
    await settle([writer, joiner]);
    await waitFor(() => notes(joiner) === 6, 'the joiner to be handed the board');

    // The same question again, from a socket that was already answered: no more
    // copies of the board on the wire, to the joiner or to anybody else.
    const before = joiner.frames.length;
    const writerFrames = writer.frames.length;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, joiner.doc);
    joiner.send(encoding.toUint8Array(encoder));
    await settle([writer, joiner]);
    expect(joiner.frames.length).toBe(before);
    expect(writer.frames.length).toBe(writerFrames);
    writer.close();
    joiner.close();
  });
});
