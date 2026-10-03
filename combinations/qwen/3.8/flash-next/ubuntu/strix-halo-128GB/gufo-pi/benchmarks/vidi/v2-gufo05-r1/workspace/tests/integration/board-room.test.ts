/**
 * The BoardRoom: the one Y.Doc per board, and the relay between everyone looking at
 * it.
 *
 * These tests run in workerd against the real Durable Object, with real `Y.Doc`s on
 * both ends and the real `y-protocols` on the wire. Concurrency is produced the way
 * it happens on a train — by disconnecting, editing, and reconnecting — rather than
 * by hand-building Yjs updates, so what gets merged is what the app actually creates.
 */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, COMPACTION_UPDATE_COUNT, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import { corruptSnapshot } from '../../src/worker/test-hooks';
import type { RoomState } from '../../src/worker/room-state';

import { applyRandomOp, applyRandomOps, createRng } from './fixtures/random-ops';
import { connectRoom, RoomClient, roomStub } from './helpers/room-client';

/** What a test can see by looking inside the room, which no client can. */
interface RoomInspection {
  sockets: number;
  notes: string[];
  hasDoc: boolean;
  state: RoomState;
}

async function inspect(boardId: string): Promise<RoomInspection> {
  return runInDurableObject(roomStub(boardId), (room) => {
    const target = room as unknown as { ydoc: Y.Doc | null; state: RoomState };
    return {
      // Story 4: the sockets belong to the runtime now, and the object is handed the
      // live list when it wakes, so that list is the count.
      sockets: listSockets(room),
      notes: target.ydoc ? [...target.ydoc.getMap('objects').keys()] : [],
      hasDoc: target.ydoc !== null,
      state: target.state,
    };
  });
}

function listSockets(room: unknown): number {
  const ctx = (room as { ctx: { getWebSockets: () => WebSocket[] } }).ctx;
  return ctx.getWebSockets().length;
}

/**
 * End this room's life for real: the runtime drops the object, and the next request
 * runs a constructor again.
 *
 * Story 3 had to fake this by emptying the object's own fields, because there was no
 * way to evict it. `evictDurableObject` is the real thing: what the new instance
 * starts with is whatever storage holds, which is precisely the promise this story is
 * about, and the sockets stay open unless `closeSockets` says otherwise.
 */
async function restartRoom(boardId: string, options: { closeSockets?: boolean } = {}): Promise<void> {
  try {
    await evictDurableObject(roomStub(boardId), {
      webSockets: options.closeSockets === true ? 'close' : 'hibernate',
    });
  } catch (error) {
    // An object that is not running is as restarted as a test can make it: the next
    // arrival will read the board from storage, which is the whole point.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('not currently running')) throw error;
  }
}

/**
 * The room's console output, collected for the whole file.
 *
 * workerd writes to the console from the worker's side of a pipe, so a line the room
 * logged while a test was running can arrive a little after the test's own awaits have
 * resolved - a spy installed around the call would be off before the line it is
 * looking for shows up. So this one stays on, keeps every line, and lets `capturedLogs`
 * read the ones from a span. Lines that are not the room's structured logging are
 * passed through: they are real problems, not evidence.
 */
const logged: string[] = [];

beforeAll(() => {
  // The room's structured lines go out on `console.log`; anything it has to complain
  // about goes out on `console.error`. Both are collected, and only the noise they would
  // make is suppressed - a failing test still prints what the room said.
  const log = console.log.bind(console);
  const error = console.error.bind(console);
  const collect =
    (through: (...args: string[]) => void) =>
    (...args: unknown[]): void => {
      const line = args.map((part) => String(part)).join(' ');
      logged.push(line);
      if (!line.includes('"event":')) through(line);
    };
  vi.spyOn(console, 'log').mockImplementation(collect(log));
  vi.spyOn(console, 'error').mockImplementation(collect(error));
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** The console lines written while `run` ran, newest last. */
async function capturedLogs(run: () => Promise<unknown>): Promise<string[]> {
  const from = logged.length;
  await run();
  // The lines this span produced can still be in flight when the last await resolves.
  await sleep(100);
  return logged.slice(from);
}

/** How many times the room says it read the board, in these console lines. */
function countLoads(lines: string[]): number {
  return lines.filter((line) => line.includes('"event":"board-loaded"')).length;
}

async function openPair(boardId: string): Promise<[RoomClient, RoomClient]> {
  const first = await connectRoom(boardId);
  const second = await connectRoom(boardId);
  return [first, second];
}

/** Wait for something about the room itself, which no client can see directly. */
async function waitRoom(boardId: string, predicate: (room: RoomInspection) => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const room = await inspect(boardId);
    if (predicate(room)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${description}`);
    await sleep(20);
  }
}

/** Two boards as one string each, so a failure shows the whole picture. */
function boardsMatch(left: RoomClient, right: RoomClient): boolean {
  return left.board().join('\n') === right.board().join('\n');
}

function textOf(doc: Y.Doc, noteId: string): string | undefined {
  return getStickyText(doc, noteId)?.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('room relay (TC-07, TC-08)', () => {
  it('shows a created note on the other client, once (TC-07)', async () => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(boardId);
    try {
      expect(sam.updates).toBe(0);
      const id = createSticky(alex.doc, { x: 10, y: 20 });
      await sam.waitForNotes(1);
      expect(sam.board()).toEqual(alex.board());
      expect(sam.notes()[0]?.id).toBe(id);
      // Exactly one update: the relay is not a fan-out of duplicates.
      expect(sam.updates).toBe(1);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });

  const edits: { name: string; apply: (doc: Y.Doc, noteId: string) => void }[] = [
    { name: 'move', apply: (doc, id) => moveObject(doc, id, 300, -140) },
    { name: 'recolour', apply: (doc, id) => setStickyColor(doc, id, 'teal') },
    {
      name: 'text',
      apply: (doc, id) => getStickyText(doc, id)?.insert(0, 'pricing review'),
    },
  ];

  for (const edit of edits) {
    it(`shows a ${edit.name} on the other client and echoes nothing back (TC-08)`, async () => {
      const boardId = newBoardId();
      const [alex, sam] = await openPair(boardId);
      try {
        const id = createSticky(alex.doc, { x: 0, y: 0 });
        await sam.waitForNotes(1);
        alex.updates = 0;
        sam.updates = 0;

        edit.apply(alex.doc, id);
        await sam.waitFor(() => boardsMatch(sam, alex), `the ${edit.name} to arrive`);

        expect(sam.board()).toEqual(alex.board());
        // The room never sends a writer their own change back.
        expect(alex.updates).toBe(0);
      } finally {
        alex.destroyCompletely();
        sam.destroyCompletely();
      }
    });
  }

  it('shows a delete on the other client, and the note stays gone (TC-08)', async () => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(boardId);
    try {
      const id = createSticky(alex.doc, { x: 0, y: 0 });
      const other = createSticky(alex.doc, { x: 400, y: 0 });
      await sam.waitForNotes(2);
      alex.updates = 0;

      expect(deleteObject(alex.doc, id)).toBe(true);
      await sam.waitForNotes(1);

      expect(sam.notes().map((note) => note.id)).toEqual([other]);
      expect(sam.board()).toEqual(alex.board());
      expect(alex.updates).toBe(0);
      // The room agrees, and it did not come back on a fresh read.
      const room = await inspect(boardId);
      expect(room.notes).toEqual([other]);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });
});

describe('concurrent edits converge (TC-09, TC-10, TC-11)', () => {
  /** Two clients that have seen each other's board and can then go quiet. */
  async function syncedPair(boardId: string): Promise<{
    alex: RoomClient;
    sam: RoomClient;
    noteId: string;
    disconnect: () => void;
  }> {
    const alex = await connectRoom(boardId);
    const id = createSticky(alex.doc, { x: 0, y: 0 });
    getStickyText(alex.doc, id)?.insert(0, 'green');
    await alex.waitFor(() => textOf(alex.doc, id) === 'green', 'the seed text to exist');
    const sam = await connectRoom(boardId);
    await sam.waitFor(() => textOf(sam.doc, id) === 'green', 'the seed text to arrive');
    return {
      alex,
      sam,
      noteId: id,
      disconnect: () => {
        alex.destroy();
        sam.destroy();
      },
    };
  }

  it('keeps both ends of a concurrent text edit (TC-09)', async () => {
    const boardId = newBoardId();
    const seed = await syncedPair(boardId);
    // Both go quiet, so neither sees the other's edit, then both come back: this is
    // what two people typing at the same moment really looks like.
    seed.disconnect();
    getStickyText(seed.alex.doc, seed.noteId)?.insert(0, 'red ');
    const samText = getStickyText(seed.sam.doc, seed.noteId);
    samText?.insert(samText.length, ' blue');

    const alex = await connectRoom(boardId, seed.alex.doc);
    const sam = await connectRoom(boardId, seed.sam.doc);
    try {
      await alex.waitFor(() => textOf(alex.doc, seed.noteId) === 'red green blue', 'A to see both edits');
      await sam.waitFor(() => textOf(sam.doc, seed.noteId) === 'red green blue', 'B to see both edits');
      expect(textOf(alex.doc, seed.noteId)).toBe(textOf(sam.doc, seed.noteId));
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });

  it('settles a concurrent position conflict identically on both (TC-10)', async () => {
    const boardId = newBoardId();
    const seed = await syncedPair(boardId);
    seed.disconnect();
    moveObject(seed.alex.doc, seed.noteId, 100, 0);
    moveObject(seed.sam.doc, seed.noteId, 300, 0);

    const alex = await connectRoom(boardId, seed.alex.doc);
    const sam = await connectRoom(boardId, seed.sam.doc);
    try {
      await alex.waitForNotes(1);
      await sam.waitForNotes(1);
      // Both must land on the same value, and it must be one of the two written —
      // Yjs last-writer-wins, so which one is a coin flip; identical is the promise.
      const alexX = alex.notes()[0]?.x;
      const samX = sam.notes()[0]?.x;
      expect(alexX).toBe(samX);
      expect([100, 300]).toContain(alexX);
      expect(alex.board()).toEqual(sam.board());
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });

  it('keeps a delete over typing into the note that vanished (TC-11)', async () => {
    const boardId = newBoardId();
    const seed = await syncedPair(boardId);
    seed.disconnect();
    expect(deleteObject(seed.alex.doc, seed.noteId)).toBe(true);
    const samText = getStickyText(seed.sam.doc, seed.noteId);
    expect(samText).toBeDefined();
    samText?.insert(samText.length, ' and still typing');

    const alex = await connectRoom(boardId, seed.alex.doc);
    const sam = await connectRoom(boardId, seed.sam.doc);
    try {
      await alex.waitForNotes(0);
      await sam.waitForNotes(0);
      expect(alex.notes()).toEqual([]);
      expect(sam.notes()).toEqual([]);
      // The typed content is not merely hidden: there is no note left to hold it.
      expect(textOf(sam.doc, seed.noteId)).toBeUndefined();
      const room = await inspect(boardId);
      expect(room.notes).toEqual([]);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });
});

describe('capacity and late arrivals (TC-12, TC-14)', () => {
  it('holds the design capacity of editors over a long random session (TC-12)', async () => {
    // A failing run is reproducible from the seed it printed; `SEED=12345 npm run
    // test:integration` replays it.
    const fromEnvironment = (globalThis as { process?: { env?: Record<string, string> } }).process
      ?.env?.['SEED'];
    const seed = Number(fromEnvironment ?? Date.now() % 1_000_000);
    console.log(`TC-12 seed: ${seed}`);
    const rng = createRng(seed);
    const boardId = newBoardId();
    const editors: RoomClient[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      editors.push(await connectRoom(boardId));
    }
    try {
      // Round-robin so the interleaving is the test's, not the runtime's.
      const ops = 200;
      for (let index = 0; index < ops; index += 1) {
        applyRandomOp(editors[index % editors.length]!.doc, rng);
      }
      // Everyone has to see everyone.
      const expected = editors.map((editor) => editor.notes().length);
      console.log(`TC-12: ${ops} ops, notes per client: ${expected.join(', ')}`);
      // Wait for the boards themselves to agree. Note counts agreeing is a weaker
      // condition, and an edit that adds one note and deletes another passes it while
      // the two boards still hold different things.
      await Promise.all(
        editors.map(async (editor, index) => {
          await editor.waitFor(
            () => editor.board().join('\n') === editors[0]!.board().join('\n'),
            `client ${String(index)} to hold the same board as client 0`,
            15_000,
          );
        }),
      );
      const reference = editors[0]!.board().join('\n');
      for (const [index, editor] of editors.entries()) {
        expect(editor.board().join('\n'), `client ${String(index)} diverged (seed ${String(seed)})`).toBe(
          reference,
        );
      }
      // The board is not empty either — a run that deleted everything proves nothing.
      expect(editors[0]!.notes().length).toBeGreaterThan(0);
    } finally {
      for (const editor of editors) editor.destroyCompletely();
    }
  });

  it('gives a late joiner the whole board (TC-14)', async () => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(boardId);
    const late = await connectRoom(boardId);
    try {
      for (let index = 0; index < 10; index += 1) {
        createSticky(alex.doc, { x: index * 220, y: 0 });
        createSticky(sam.doc, { x: index * 220, y: 300 });
      }
      await alex.waitForNotes(20);
      await sam.waitForNotes(20);
      await late.waitForNotes(20);
      expect(late.board()).toEqual(alex.board());
      expect(late.board()).toEqual(sam.board());
      // And the new person's own edit reaches the others, which is what a board is for.
      createSticky(late.doc, { x: 0, y: -500 });
      await alex.waitForNotes(21);
      await sam.waitForNotes(21);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
      late.destroyCompletely();
    }
  });
});

describe('bad traffic (TC-15)', () => {
  /** Frames a broken or hostile client might send. */
  const badFrames: { name: string; build: () => ArrayBuffer | string }[] = [
    { name: 'a text frame', build: () => 'hello' },
    {
      name: 'bytes truncated short',
      build: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3, 4, 5]));
        const whole = encoding.toUint8Array(encoder);
        return whole.slice(0, 4).buffer as ArrayBuffer; // promises five bytes, carries one
      },
    },
    { name: 'an unknown message type', build: () => new Uint8Array([9, 1, 2, 3]).buffer },
    {
      name: 'an update Yjs refuses',
      build: () => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        encoding.writeVarUint(encoder, 2); // sync/update
        encoding.writeVarUint8Array(encoder, new Uint8Array([255, 254, 253, 252, 10, 0, 1, 2, 3]));
        return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
      },
    },
  ];

  for (const frame of badFrames) {
    it(`closes the sender for ${frame.name}, and keeps the room working (TC-15)`, async () => {
      const boardId = newBoardId();
      const [alex, sam] = await openPair(boardId);
      try {
        const id = createSticky(alex.doc, { x: 0, y: 0 });
        await sam.waitForNotes(1);
        const notesBefore = (await inspect(boardId)).notes;
        expect(notesBefore).toEqual([id]);

        alex.sendRaw(frame.build());
        await alex.waitFor(() => alex.closeInfo !== null, 'the room to close the socket');
        expect(alex.closeInfo?.code).toBe(CLOSE_UNSUPPORTED_DATA);

        // The other person is untouched: a new connection from the same document can
        // still edit, and the edit arrives.
        const again = await connectRoom(boardId, alex.doc);
        try {
          moveObject(alex.doc, id, 77, 0);
          await sam.waitFor(() => sam.notes()[0]?.x === 77, 'the move after the bad frame');
          expect(sam.closeInfo).toBeNull();
          // Nothing the bad frame claimed to do took effect.
          const room = await inspect(boardId);
          expect(room.notes).toEqual([id]);
        } finally {
          again.destroy();
        }
      } finally {
        alex.destroyCompletely();
        sam.destroyCompletely();
      }
    });
  }
});

describe('awareness relay (TC-16)', () => {
  it('relays awareness to the sender and the other client as identical bytes', async () => {
    const boardId = newBoardId();
    const [alex, sam] = await openPair(boardId);
    try {
      alex.sendAwareness({ x: 12, y: 34 });
      await alex.waitFor(
        () => alex.awarenessFrames().length >= 1 && sam.awarenessFrames().length >= 1,
        'awareness to reach both',
      );
      const fromAlex = alex.awarenessFrames()[0];
      const fromSam = sam.awarenessFrames()[0];
      if (!fromAlex || !fromSam) throw new Error('no awareness frames arrived');
      expect(fromSam).toEqual(fromAlex);
      // It is a real awareness update by the time it lands: the state is readable.
      const seenBySam = sam.awareness.getStates().get(alex.doc.clientID) as { test?: unknown } | undefined;
      expect(seenBySam?.test).toEqual({ x: 12, y: 34 });
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });
});

describe('room restart (TC-18)', () => {
  it('comes back from storage with the board, and both clients converge', async () => {
    const boardId = newBoardId();
    const alexDoc = new Y.Doc();
    const samDoc = new Y.Doc();
    initDoc(alexDoc);
    initDoc(samDoc);

    const alex = await connectRoom(boardId, alexDoc);
    createSticky(alexDoc, { x: 0, y: 0 });
    const second = createSticky(alexDoc, { x: 300, y: 0 });
    const sam = await connectRoom(boardId, samDoc);
    await sam.waitForNotes(2);
    expect(samDoc.getMap('objects').get(second)).toBeDefined();
    alex.destroy();
    sam.destroy();
    await waitRoom(boardId, (room) => room.sockets === 0, 'both sockets to close');

    // Room with nobody in it, and this time it is a real new instance: the runtime
    // dropped the old one, so nothing is in memory.
    await restartRoom(boardId, { closeSockets: true });
    // `inspect` wakes the object, and a cold object reads the board before it answers
    // anything, so what a restart proves here is the sockets going away and the board
    // being there again - not an empty document, which nobody outside can ever see.
    const afterRestart = await inspect(boardId);
    expect(afterRestart.sockets).toBe(0);
    expect(afterRestart.state).toBe('ready');

    // The first person back finds the board already read, the second then agrees
    // with the first.
    const alexBack = await connectRoom(boardId, alexDoc);
    const roomAfterFirstBack = await inspect(boardId);
    expect(roomAfterFirstBack.notes).toHaveLength(2);

    const samBack = await connectRoom(boardId, samDoc);
    try {
      await samBack.waitForNotes(2);
      expect(samBack.board()).toEqual(alexBack.board());
      // And it is live again, not a frozen copy.
      createSticky(alexDoc, { x: -400, y: -400 });
      await samBack.waitForNotes(3);
    } finally {
      alexBack.destroyCompletely();
      samBack.destroyCompletely();
    }
  });
});

describe('dead sockets (TC-31)', () => {
  it('survives a socket that cannot be written to and keeps relaying to everyone left', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const sam = await connectRoom(boardId);
    // A socket the room still lists but that throws the moment it is written to: the
    // state a peer that vanished without a close handshake leaves behind. Story 3 put
    // a made-up socket in the room's own set; the room has no set any more, so this
    // takes one of its real sockets and makes writing to it fail, which is the same
    // thing from the room's side and does not depend on when the runtime notices a
    // dead connection.
    await runInDurableObject(roomStub(boardId), (room) => {
      const target = room as unknown as { ctx: { getWebSockets: () => WebSocket[] } };
      const victim = target.ctx.getWebSockets().find((socket) => socket.readyState !== WebSocket.CLOSED);
      if (!victim) throw new Error('the room has no socket to make unwritable');
      victim.send = () => {
        throw new Error('this socket is gone');
      };
    });
    try {
      const id = createSticky(alex.doc, { x: 0, y: 0 });
      // The room must still be answering for its own socket, and for everyone else's.
      const later = await connectRoom(boardId);
      await later.waitForNotes(1);
      expect(later.notes()[0]?.id).toBe(id);
      // And it is still healthy afterwards: another edit, another arrival.
      moveObject(alex.doc, id, 55, 55);
      await later.waitFor(() => later.notes()[0]?.x === 55, 'the move after the dead socket');
      const room = await inspect(boardId);
      expect(room.notes).toEqual([id]);
      later.destroyCompletely();
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });
});

describe('helpers are honest (guards against a test that proves nothing)', () => {
  it('applyRandomOps edits a document through the real board-model functions', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const rng = createRng(7);
    const ops = applyRandomOps(doc, rng, 40);
    expect(ops.length).toBe(40);
    expect(ops.some((op) => op.kind === 'create')).toBe(true);
    expect(ops.some((op) => op.kind === 'type')).toBe(true);
    expect(snapshot(doc).length).toBeGreaterThan(0);
    doc.destroy();
  });
});

/**
 * Story 4: the board outlives the room.
 *
 * `restartRoom` is the tool these tests are built around — the runtime dropping the
 * object is what "the server went away" means here, and unlike story 3 it can be
 * done for real rather than simulated.
 */

async function logShape(boardId: string): Promise<{ rows: number; bytes: number; chunks: number }> {
  return runInDurableObject(roomStub(boardId), (room) => {
    const sql = (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage.sql;
    const updates = sql
      .exec('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM updates')
      .toArray()[0] as { n: number; bytes: number };
    const chunks = sql.exec('SELECT COUNT(*) AS n FROM snapshot_chunks').toArray()[0] as { n: number };
    return { rows: updates.n, bytes: updates.bytes, chunks: chunks.n };
  });
}

/** Connect, and hand back the close the room gave instead of a board. */
async function rejectedConnection(boardId: string): Promise<{ code: number; reason: string }> {
  const response = await roomStub(boardId).fetch(
    new Request(`https://board.test/api/rooms/${boardId}`, { headers: { Upgrade: 'websocket' } }),
  );
  const socket = response.webSocket;
  if (!socket) throw new Error(`no WebSocket in the response (status ${String(response.status)})`);
  socket.binaryType = 'arraybuffer';
  const client = new RoomClient(socket);
  socket.accept();
  client.sendSyncStep1();
  await client.waitFor(() => client.closeInfo !== null, 'the room to close the connection');
  if (!client.closeInfo) throw new Error('no close information');
  return client.closeInfo;
}

/**
 * Read the board cold - the object has just been dropped, so the next connection
 * loads it - and return the milliseconds the room measured for that load.
 */
async function coldLoadMillis(boardId: string, notes: number): Promise<number> {
  await restartRoom(boardId, { closeSockets: true });
  const lines = await capturedLogs(async () => {
    const client = await connectRoom(boardId);
    await client.waitForNotes(notes, 15_000);
    client.destroyCompletely();
  });
  const line = lines.find((entry) => entry.includes('"event":"board-loaded"'));
  if (!line) throw new Error(`no board-loaded line in: ${lines.join(' | ')}`);
  return (JSON.parse(line) as { ms: number }).ms;
}

/** Wait for something about the log itself, which no client can see. */
async function waitForLogShape(
  boardId: string,
  predicate: (shape: { rows: number; bytes: number; chunks: number }) => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const shape = await logShape(boardId);
    if (predicate(shape)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${description}`);
    await sleep(20);
  }
}

describe('durability before visibility (TC-12)', () => {
  it('has already stored every change another client can see', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const sam = await connectRoom(boardId);
    try {
      for (let index = 0; index < 3; index += 1) {
        createSticky(alex.doc, { x: index * 240, y: 0 });
        // Sam seeing it is the moment the room relayed it, which is the earliest a
        // change can become visible to anyone at all.
        await sam.waitForNotes(index + 1);
      }
      // The room's life ends here with no clean shutdown, no flush, nothing: what Sam
      // saw has to be what storage holds.
      await restartRoom(boardId, { closeSockets: true });
      const back = await connectRoom(boardId);
      try {
        await back.waitForNotes(3);
        expect(back.board()).toEqual(sam.board());
        expect((await logShape(boardId)).rows).toBeGreaterThanOrEqual(3);
      } finally {
        back.destroyCompletely();
      }
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });
});

describe('hibernation and wake (TC-13, TC-14)', () => {
  it('wakes for a message on a hibernating socket and relays it', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const sam = await connectRoom(boardId);
    try {
      createSticky(alex.doc, { x: 0, y: 0 });
      await sam.waitForNotes(1);

      await waitForLogShape(boardId, (shape) => shape.rows >= 2, 'the first note to be stored');
      const rowsBefore = (await logShape(boardId)).rows;
      // The runtime ends this instance. The sockets are the runtime's, so they stay
      // open, which is the whole point of hibernation. Nothing else may touch the room
      // before the traffic does: the first thing to wake it has to be the message.
      const asleep = await capturedLogs(async () => {
        await restartRoom(boardId);
      });
      expect(countLoads(asleep)).toBe(0);

      // Traffic on one of those sockets has to wake the room, read the board back,
      // apply, and relay — all of it inside one message handler. The evidence is a
      // `board-loaded` line: this instance had to read the board again, having been
      // handed nothing but the sockets.
      const lines = await capturedLogs(async () => {
        createSticky(alex.doc, { x: 240, y: 0 });
        await sam.waitForNotes(2);
      });
      expect(countLoads(lines)).toBe(1);
      const awake = await inspect(boardId);
      expect(awake.sockets).toBe(2);
      expect(awake.state).toBe('ready');
      expect(awake.notes).toHaveLength(2);
      // The change that woke it is stored too, not merely relayed: one more row than
      // there was before the object went away, for the one note that was written.
      expect((await logShape(boardId)).rows).toBe(rowsBefore + 1);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });

  it('takes a client back after the object went away, with nothing duplicated or lost', async () => {
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    const alex = await connectRoom(boardId, doc);
    const first = createSticky(doc, { x: 0, y: 0 });
    await alex.waitForNotes(1);
    const second = createSticky(doc, { x: 240, y: 0 });
    await alex.waitForNotes(2);

    // The connection dies with the object, and the client comes back as a page would:
    // a new socket carrying the document it already has.
    await restartRoom(boardId, { closeSockets: true });
    await alex.waitFor(() => alex.closeInfo !== null, 'the socket to close');
    alex.destroy();

    const back = await connectRoom(boardId, doc);
    try {
      // Nothing was re-sent: the room had nothing the client lacked, so the handshake
      // carried no update frames at all. A room that answered a reconnect with the
      // whole board would fail here without the board being wrong about anything.
      expect(back.updates).toBe(0);
      expect(back.notes().map((note) => note.id)).toEqual([first, second]);
      // And the board is live: this socket can write.
      const third = createSticky(doc, { x: 480, y: 0 });
      await back.waitForNotes(3);
      expect((await logShape(boardId)).rows).toBe(3);
      expect(back.notes().map((note) => note.id)).toEqual([first, second, third]);
    } finally {
      back.destroyCompletely();
    }
  });
});

describe('a write that fails (TC-15, TC-16)', () => {
  /**
   * Make the room's next writes throw, from inside the object, and hand back nothing:
   * `healWrites` puts them back. This is the one place a test reaches into the room's
   * own `BoardStore`, because "SQLite said no" is not something a test can arrange
   * otherwise, and pretending the storage binding is broken would be a faker, not
   * this.
   */
  async function breakWrites(boardId: string): Promise<void> {
    await runInDurableObject(roomStub(boardId), (room) => {
      const store = (room as unknown as { store: Record<string, unknown> }).store;
      if (store.workingAppend === undefined) store.workingAppend = store.append;
      store.append = () => {
        throw new Error('storage is down');
      };
    });
  }

  async function healWrites(boardId: string): Promise<void> {
    await runInDurableObject(roomStub(boardId), (room) => {
      const store = (room as unknown as { store: Record<string, unknown> }).store;
      if (typeof store.workingAppend === 'function') {
        store.append = store.workingAppend;
        delete store.workingAppend;
      }
    });
  }

  it('tells the writer, keeps their change off everyone else, and says so in the log', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const sam = await connectRoom(boardId);
    try {
      // Two people are already connected, and their handshakes are already stored. What
      // matters is that the failed change adds no row of its own.
      await waitForLogShape(boardId, () => true, 'the handshakes to settle');
      const rowsBefore = (await logShape(boardId)).rows;
      await breakWrites(boardId);
      await capturedLogs(async () => {
        createSticky(alex.doc, { x: 0, y: 0 });
        await alex.waitFor(() => alex.closeInfo !== null, 'the writer to be disconnected');
      });
      expect(alex.closeInfo?.code).toBe(CLOSE_STORAGE_FAILURE);
      // The change never reached the other person: the room stopped it before applying.
      await sleep(100);
      expect(sam.notes()).toEqual([]);
      // And nothing was written down either. The room's own `storage-write-failed`
      // line is not asserted here: console output from a WebSocket event is not
      // reliable to catch in this pool, and "the row is absent" says the same thing
      // about the failure in a way the test can hold on to.

      const room = await inspect(boardId);
      expect(room.state).toBe('storage-failed');
      // What the room had applied before the write was attempted is still in its memory,
      // but the room no longer answers from it: it told the writer, told nobody else,
      // and the next arrival reads the board back out of storage (TC-16). What a client
      // can check - and what the promise is about - is that the failed change is not in
      // the log.
      expect((await logShape(boardId)).rows).toBe(rowsBefore);
    } finally {
      alex.destroyCompletely();
      sam.destroyCompletely();
    }
  });

  it('retries the failed write on the next attempt and stores it once', async () => {
    // One arrival at a time, because every arrival has a document of its own to
    // introduce: a joining client's handshake carries the board map it created under its
    // own client id, which the room stores like any other update. Counting rows only
    // means anything with nobody else connecting while the count is taken.
    const boardId = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    const alex = await connectRoom(boardId, doc);
    await waitForLogShape(boardId, (shape) => shape.rows >= 1, 'the first client to be stored');
    await sleep(200);
    const rowsBefore = (await logShape(boardId)).rows;

    await breakWrites(boardId);
    createSticky(doc, { x: 0, y: 0 });
    await alex.waitFor(() => alex.closeInfo !== null, 'the writer to be disconnected');
    alex.destroy();
    await sleep(200);
    // The attempt that failed left nothing behind.
    expect((await logShape(boardId)).rows).toBe(rowsBefore);

    await healWrites(boardId);
    // The same person comes back. The room cannot answer from memory in this state, so
    // it reads the board again, and the change that was refused goes up as an ordinary
    // write - one update, no more. This is the difference between a retry and a silent
    // duplicate: the board has one note, and the log holds the update that says so.
    const back = await connectRoom(boardId, doc);
    try {
      await back.waitForNotes(1);
      await waitForLogShape(boardId, (shape) => shape.rows === rowsBefore + 1, 'the retry to be stored');
      expect((await logShape(boardId)).rows).toBe(rowsBefore + 1);
      // And everyone who arrives after agrees: the retry is the board, not a second copy
      // of a note.
      const watcher = await connectRoom(boardId);
      try {
        await watcher.waitForNotes(1);
        expect(watcher.board()).toEqual(back.board());
      } finally {
        watcher.destroyCompletely();
      }
    } finally {
      back.destroyCompletely();
    }
    },
    // A failed write, a healed store, and two cold handshakes.
    20_000,
  );
});

describe('a board that will not load (TC-17)', () => {
  it('closes with 4500 and an explanation in the log, not with an empty board', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    createSticky(alex.doc, { x: 0, y: 0 });
    await alex.waitForNotes(1);
    await waitForLogShape(boardId, (shape) => shape.rows >= 1, 'the write to land');
    // Fold it, then damage what the fold wrote: this is the story's own failure.
    await runInDurableObject(roomStub(boardId), (room) => {
      const target = room as unknown as {
        store: { compactSnapshot(doc: Y.Doc): boolean };
        ydoc: Y.Doc | null;
        ctx: { storage: DurableObjectStorage };
      };
      if (!target.ydoc) throw new Error('the room has no document to fold');
      expect(target.store.compactSnapshot(target.ydoc)).toBe(true);
      corruptSnapshot(target.ctx.storage);
    });
    await restartRoom(boardId, { closeSockets: true });
    alex.destroyCompletely();

    const lines = await capturedLogs(async () => {
      const close = await rejectedConnection(boardId);
      expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    });
    const failure = lines.find((line) => line.includes('"event":"board-load-failed"'));
    expect(failure).toBeDefined();
    expect(failure).toContain('snapshot-unreadable');
  });
});

describe('compaction and eviction (TC-18)', () => {
  it(
    'keeps a committed fold across the object going away',
    async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const others: RoomClient[] = [];
    try {
      for (let index = 0; index < COMPACTION_UPDATE_COUNT; index += 1) {
        createSticky(alex.doc, { x: index * 12, y: 0 });
      }
      await alex.waitForNotes(COMPACTION_UPDATE_COUNT);
      // The fold the 500th update asked for, waited for: it runs after the relay, so
      // the only honest check is the log itself.
      await waitForLogShape(boardId, (shape) => shape.chunks > 0, 'the log to fold into a snapshot');
      const folded = await logShape(boardId);
      // Five hundred rows became a snapshot: what is left of the log is the handful of
      // updates that arrived while the fold was being written.
      expect(folded.rows).toBeLessThanOrEqual(2);

      // One more change, and then the object's life ends without warning. The second
      // pair of eyes is not decoration: the room stores before it shows, so a change a
      // peer can see is a change that is on disk, and evicting before that would be
      // testing an eviction the design does not promise to survive.
      const sam = await connectRoom(boardId);
      others.push(sam);
      await sam.waitForNotes(COMPACTION_UPDATE_COUNT, 20_000);
      createSticky(alex.doc, { x: -100, y: -100 });
      await sam.waitForNotes(COMPACTION_UPDATE_COUNT + 1, 20_000);
      await restartRoom(boardId, { closeSockets: true });
      alex.destroy();

      // What the wake had to read is the point: the room's own line says how many
      // updates it went through, and five hundred of them would mean the fold was not
      // there. (Rows keep arriving from the handshakes of whoever connects next, which
      // is why this reads the room's number rather than the table's.)
      const woke = await capturedLogs(async () => {
        const back = await connectRoom(boardId);
        others.push(back);
        await back.waitForNotes(COMPACTION_UPDATE_COUNT + 1, 20_000);
      });
      const line = woke.find((entry) => entry.includes('"event":"board-loaded"'));
      expect(line, 'the wake should have said what it read').toBeDefined();
      const read = JSON.parse(String(line)) as { updates: number; bytes: number };
      expect(read.updates).toBeLessThanOrEqual(3);
      // The fold survived, in other words: a snapshot plus the few updates since it.
      const after = await logShape(boardId);
      expect(after.chunks).toBeGreaterThan(0);
    } finally {
      for (const other of others) other.destroyCompletely();
      alex.destroyCompletely();
    }
    },
    // Five hundred updates through one socket, a fold, and a cold wake.
    60_000,
  );
});

describe('the cost of waking (TC-26)', () => {
  it(
    'reads a folded board in about the same time as a short log',
    async () => {
    // The room folds the log at 500 rows, so a board with thousands of them has to be
    // built the way the store tests build one: appended directly, before any room
    // looks at it. What is timed is the call a wake makes - `BoardStore.load` into an
    // empty document - read out of the room's own log line, before and after folding
    // the same board.
    const updates: Uint8Array[] = [];
    {
      // The recorder goes on before the first change, including `initDoc`: an update
      // carries the clock it starts at, and a log that begins in the middle replays as
      // an empty board while every comparison against it still passes.
      const doc = new Y.Doc();
      doc.on('update', (update: Uint8Array) => updates.push(update.slice()));
      initDoc(doc);
      for (let index = 0; index < 1_200; index += 1) {
        const id = createSticky(doc, { x: index * 12, y: 0 });
        getStickyText(doc, id)?.insert(0, `note number ${String(index)}`);
      }
      doc.destroy();
    }
    // One update that creates the board map, then one per note and one per line of text.
    expect(updates.length).toBe(2_401);

    const boardId = newBoardId();
    await runInDurableObject(roomStub(boardId), (room) => {
      const storage = (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;
      const store = new BoardStore(storage);
      store.migrate();
      for (const update of updates) store.append(update);
      expect(store.logStats().rows).toBe(updates.length);
    });

    const unfoldedMillis = await coldLoadMillis(boardId, 1_200);

    // Fold it, through a store of its own: this is what the room does after the 500th
    // update, and doing it here keeps the measurement about reading rather than about
    // when a particular write happened to land. The arrival measured above wrote one
    // update of its own, which is enough for the room to have folded the log already -
    // so what is asserted is the end state, a snapshot covering the whole board.
    await runInDurableObject(roomStub(boardId), (room) => {
      const storage = (room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage;
      const store = new BoardStore(storage);
      const doc = new Y.Doc();
      expect(store.load(doc).ok).toBe(true);
      if (store.logStats().rows > 0) expect(store.compactSnapshot(doc)).toBe(true);
      doc.destroy();
    });
    expect((await logShape(boardId)).chunks).toBeGreaterThan(0);
    await restartRoom(boardId, { closeSockets: true });

    const foldedMillis = await coldLoadMillis(boardId, 1_200);
    console.log(
      `TC-26: ${String(updates.length)} updates, unfolded ${String(unfoldedMillis)}ms, folded ${String(foldedMillis)}ms`,
    );

    // The promise is "roughly the same, not hundreds of reads slower". A ratio with
    // room to spare, and an absolute ceiling that a healthy load should never near.
    expect(foldedMillis).toBeLessThan(unfoldedMillis * 4);
    expect(foldedMillis).toBeLessThan(BOARD_LOAD_BUDGET_MS);
    },
    // Two thousand and four hundred writes, two cold reads of a 1,200-note board.
    // Nothing here is slow in absolute terms; it is simply more than the default.
    120_000,
  );
});
