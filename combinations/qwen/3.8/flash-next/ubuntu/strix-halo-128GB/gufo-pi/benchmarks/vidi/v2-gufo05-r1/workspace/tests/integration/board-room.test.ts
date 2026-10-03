/**
 * The BoardRoom: the one Y.Doc per board, and the relay between everyone looking at
 * it.
 *
 * These tests run in workerd against the real Durable Object, with real `Y.Doc`s on
 * both ends and the real `y-protocols` on the wire. Concurrency is produced the way
 * it happens on a train — by disconnecting, editing, and reconnecting — rather than
 * by hand-building Yjs updates, so what gets merged is what the app actually creates.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';

import { connectRoom, type RoomClient } from './helpers/room-client';
import { applyRandomOp, applyRandomOps, createRng } from './fixtures/random-ops';

/** The room's own state, for the assertions that have to look inside. */
interface RoomInspection {
  sockets: number;
  notes: string[];
  hasDoc: boolean;
}

async function inspect(boardId: string): Promise<RoomInspection> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room) => {
    const target = room as unknown as { sockets: Set<WebSocket>; ydoc: Y.Doc | null };
    return {
      sockets: target.sockets.size,
      notes: target.ydoc ? [...target.ydoc.getMap('objects').keys()] : [],
      hasDoc: target.ydoc !== null,
    };
  });
}

/**
 * Empty the room the way a brand new instance is empty: no document, no sockets.
 *
 * There is no API to evict a Durable Object from a test, and waiting for the runtime
 * to do it is not a thing a test can do either. What matters about a restart is the
 * state the new instance starts with, and that state is exactly this.
 */
async function simulateRestart(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject(stub, (room) => {
    const target = room as unknown as { sockets: Set<WebSocket>; ydoc: Y.Doc | null };
    for (const socket of target.sockets) {
      try {
        socket.close(1012, 'restarting');
      } catch {
        // Already gone.
      }
    }
    target.sockets.clear();
    target.ydoc = null;
  });
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
      // Everyone has to see everyone: wait for the note counts to agree, then for the
      // boards to be the same, which is the actual promise.
      const expected = editors.map((editor) => editor.notes().length);
      console.log(`TC-12: ${ops} ops, notes per client: ${expected.join(', ')}`);
      await Promise.all(
        editors.map(async (editor, index) => {
          await editor.waitFor(
            () => editor.notes().length === editors[0]!.notes().length,
            `client ${String(index)} to have the same number of notes`,
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
  it('refills an empty room from the first client back and both converge', async () => {
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

    // Room with nobody in it: nothing kept, nothing to fall back to.
    await simulateRestart(boardId);
    const afterRestart = await inspect(boardId);
    expect(afterRestart.hasDoc).toBe(false);
    expect(afterRestart.sockets).toBe(0);

    // The first person back refills it, the second then agrees with the first.
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
  it('survives an abrupt close mid-broadcast and keeps relaying to everyone left', async () => {
    const boardId = newBoardId();
    const alex = await connectRoom(boardId);
    const sam = await connectRoom(boardId);
    // A socket the room still holds but that cannot be written to: the state a peer
    // that vanished without a close handshake leaves behind. `runInDurableObject` is
    // the only way to put one in the room's set, and it is a fair way to ask the
    // question, because from the room's side a half-open socket is exactly this.
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    await runInDurableObject(stub, (room) => {
      const target = room as unknown as { sockets: Set<WebSocket> };
      const pair = new WebSocketPair();
      target.sockets.add(pair[1]);
    });
    try {
      sam.destroy(); // abrupt: the room's set may still hold it when the next edit lands
      const id = createSticky(alex.doc, { x: 0, y: 0 });
      // The room must still be answering for its own socket.
      const later = await connectRoom(boardId);
      await later.waitForNotes(1);
      expect(later.notes()[0]?.id).toBe(id);
      // And it is still healthy afterwards: another edit, another arrival.
      moveObject(alex.doc, id, 55, 55);
      await later.waitFor(() => later.notes()[0]?.x === 55, 'the move after the abrupt close');
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
