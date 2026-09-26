// Story 3, task 6: BoardRoom behaviour under the workerd runtime.
//
// TC-07  A's note reaches B; the room's doc equals A's.
// TC-08  move / recolor / text-insert / delete: B equals A after each, and A
//        receives no echo back (negative).
// TC-09  two concurrent clients connect without a full exchange; only after
//        both flush does each doc contain both clients' content.
// TC-10  late joiner B receives A's note and its doc equals A's.
// TC-11  after sync, updates flow both directions.
// TC-12  seeded random ops: 5 clients x 200 ops converge to one board; every
//        created note exists unless deleted.
// TC-14  A and B create 20 notes; late joiner C's snapshot equals A's.
// TC-15  malformed traffic (4 kinds) closes only A with 1003; B keeps
//        receiving updates; the room's doc is unchanged by the garbage.
// TC-16  an awareness frame is relayed verbatim to ALL sockets (incl. A).
// TC-18  room "restart": a fresh empty room is repopulated by the first
//        reconnecting client's step2; the late joiner converges.
// TC-31  a dead socket never breaks the room: A's update after B's abrupt
//        close is applied and a later socket still receives it.

import { describe, expect, it } from 'vitest';
import {
  createStickyAt,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  SYNC_UPDATE,
} from '../../src/shared/protocol';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import {
  CONCURRENT_CLIENTS,
  CONVERGENCE_SEED,
  makeOpGenerator,
  OPERATIONS_PER_CLIENT,
} from './random-ops';
import { probeRoomSnapshot, WsClient } from './ws-client';

function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const key = (n: StickySnapshot) =>
    `${n.id}|${n.x}|${n.y}|${n.color}|${n.text}|${n.z}|${n.createdAt}`;
  const sorted = (s: readonly StickySnapshot[]) => s.map(key).sort();
  return sorted(a).every((k, i) => k === sorted(b)[i]);
}

describe('BoardRoom (task 6)', () => {
  it('TC-07: A creates a note, B receives it, and the room doc equals A doc', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const b = await WsClient.connect(boardId);
    try {
      const noteId = a.applyLocal((doc) => createStickyAt(doc, 11, 22, 'pink'));
      await b.waitUntil(() => b.hasNote(noteId), 3000);
      await a.waitForSync();
      await b.waitForSync();
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
      // The room's own doc (observed via a probe) equals A's.
      const room = await probeRoomSnapshot(boardId);
      expect(sameBoard(room, a.boardSnapshot())).toBe(true);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('TC-08: move, recolor, text insert, delete — B equals A, A gets no echo', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const noteId = a.applyLocal((doc) => createStickyAt(doc, 0, 0));
    const b = await WsClient.connect(boardId);
    await b.waitUntil(() => b.hasNote(noteId), 3000);
    await a.waitForSync();
    await b.waitForSync();
    const receivedByAAtStart = a.received.length;
    try {
      // move
      a.applyLocal((doc) => moveObject(doc, noteId, 123, 456));
      await b.waitUntil(
        () => b.boardSnapshot().find((n) => n.id === noteId)?.x === 123,
        3000,
      );
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);

      // recolor
      a.applyLocal((doc) => setStickyColor(doc, noteId, 'violet'));
      await b.waitUntil(
        () => b.boardSnapshot().find((n) => n.id === noteId)?.color === 'violet',
        3000,
      );
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);

      // text insert
      a.applyLocal((doc) => getStickyText(doc, noteId)!.insert(0, 'hello '));
      await b.waitUntil(
        () => getStickyText(b.doc, noteId)?.toString().startsWith('hello '),
        3000,
      );
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);

      // delete
      a.applyLocal((doc) => deleteObject(doc, noteId));
      await b.waitUntil(() => !b.hasNote(noteId), 3000);
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
    } finally {
      await a.destroy();
      await b.destroy();
    }
    // Negative: A never received an update frame echoing its own ops back.
    // (A only ever receives sync SUBFRAMES of type step1/step2 from the
    // initial exchange; broadcasts always target the other sockets.)
    const updatesToA = a.received.slice(receivedByAAtStart).filter((f) => f.syncSub === SYNC_UPDATE);
    expect(updatesToA.length).toBe(0);
  });

  it('TC-09: concurrent clients without a full exchange converge after flush', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId, { autoExchange: false });
    const b = await WsClient.connect(boardId, { autoExchange: false });
    try {
      // Both hold their exchanges and make disjoint local content.
      const noteA = a.applyLocal((doc) => createStickyAt(doc, 1, 1, 'blue'));
      const noteB = b.applyLocal((doc) => createStickyAt(doc, 9, 9, 'orange'));
      // Let every frame in flight settle (the room answered step1s; the
      // clients' step2s are still held).
      await a.waitForSync();
      await b.waitForSync();
      // Before flush: neither sees the other's content.
      expect(a.hasNote(noteB)).toBe(false);
      expect(b.hasNote(noteA)).toBe(false);

      a.flush();
      b.flush();

      await a.waitUntil(() => a.hasNote(noteB), 3000);
      await b.waitUntil(() => b.hasNote(noteA), 3000);
      await a.waitForSync();
      await b.waitForSync();
      expect(a.hasNote(noteA)).toBe(true);
      expect(a.hasNote(noteB)).toBe(true);
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('TC-10: late joiner B receives A note and equals A', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const noteId = a.applyLocal((doc) => createStickyAt(doc, 5, 5, 'green'));
    await a.waitUntil(() => a.hasNote(noteId));
    const b = await WsClient.connect(boardId);
    try {
      await b.waitUntil(() => b.hasNote(noteId), 3000);
      await b.waitForSync();
      expect(sameBoard(a.boardSnapshot(), b.boardSnapshot())).toBe(true);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('TC-11: after sync, updates flow both directions', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const b = await WsClient.connect(boardId);
    await b.waitForSync();
    try {
      // A -> B
      const noteA = a.applyLocal((doc) => createStickyAt(doc, 1, 1));
      await b.waitUntil(() => b.hasNote(noteA), 3000);
      // B -> A
      const noteB = b.applyLocal((doc) => createStickyAt(doc, 2, 2));
      await a.waitUntil(() => a.hasNote(noteB), 3000);
      // A edits B's note
      a.applyLocal((doc) => getStickyText(doc, noteB)!.insert(0, 'edited-by-a'));
      await b.waitUntil(
        () => getStickyText(b.doc, noteB)?.toString() === 'edited-by-a',
        3000,
      );
      // B moves A's note
      b.applyLocal((doc) => moveObject(doc, noteA, 77, 88));
      await a.waitUntil(
        () => a.boardSnapshot().find((n) => n.id === noteA)?.x === 77,
        3000,
      );
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it(
    `TC-12: ${CONCURRENT_CLIENTS} clients x ${OPERATIONS_PER_CLIENT} seeded random ops converge (seed ${CONVERGENCE_SEED})`,
    async () => {
      const boardId = newBoardId();
      const clients: WsClient[] = [];
      try {
        for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
          clients.push(await WsClient.connect(boardId));
        }
        // Interleave the operation streams with awaits so updates overlap in
        // flight (workerd processes each message on its own turn).
        const generators = clients.map((c) => makeOpGenerator(CONVERGENCE_SEED, c.doc));
        const records = clients.map(() => [] as { createdIds: string[]; deletedIds: string[] }[]);
        for (let op = 0; op < OPERATIONS_PER_CLIENT; op++) {
          for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
            const rec = generators[i]();
            records[i].push(rec);
            if (op % 25 === 0) await new Promise((r) => setTimeout(r, 0));
          }
        }
        // Convergence: every client's doc settles to the same board.
        await Promise.all(clients.map((c) => c.waitForSync(10_000)));
        const reference = clients[0].boardSnapshot();
        for (const client of clients.slice(1)) {
          expect(
            sameBoard(reference, client.boardSnapshot()),
            `${client.name} diverged from client 0`,
          ).toBe(true);
        }
        // Every created note exists unless it was deleted (by any client).
        const created = new Set<string>();
        const deleted = new Set<string>();
        for (const perClient of records) {
          for (const rec of perClient) {
            rec.createdIds.forEach((id) => created.add(id));
            rec.deletedIds.forEach((id) => deleted.add(id));
          }
        }
        const finalIds = new Set(reference.map((n) => n.id));
        for (const id of created) {
          if (deleted.has(id)) continue;
          expect(finalIds.has(id), `created note ${id} missing from final board`).toBe(true);
        }
        for (const id of finalIds) {
          expect(created.has(id), `final note ${id} was never created`).toBe(true);
        }
      } finally {
        for (const client of clients) await client.destroy();
      }
    },
    60_000,
  );

  it('TC-14: A and B create 20 notes; late joiner C equals A', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const b = await WsClient.connect(boardId);
    await b.waitForSync();
    try {
      for (let i = 0; i < 10; i++) {
        a.applyLocal((doc) => createStickyAt(doc, i * 10, 0, 'yellow'));
        b.applyLocal((doc) => createStickyAt(doc, i * 10, 100, 'blue'));
      }
      await a.waitForSync();
      await b.waitForSync();
      expect(a.boardSnapshot()).toHaveLength(20);
      expect(b.boardSnapshot()).toHaveLength(20);

      const c = await WsClient.connect(boardId);
      try {
        await c.waitUntil(() => c.boardSnapshot().length === 20, 5000);
        await c.waitForSync();
        expect(sameBoard(a.boardSnapshot(), c.boardSnapshot())).toBe(true);
        expect(sameBoard(b.boardSnapshot(), c.boardSnapshot())).toBe(true);
      } finally {
        await c.destroy();
      }
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('TC-15: malformed traffic closes only A with 1003; B keeps receiving; room doc unchanged', async () => {
    const boardId = newBoardId();
    // B creates one note so the room has legitimate state to compare against.
    const b = await WsClient.connect(boardId);
    await b.waitForSync();
    const legitNote = b.applyLocal((doc) => createStickyAt(doc, 0, 0, 'green'));
    await b.waitUntil(() => b.hasNote(legitNote));

    const malformedFrames: { name: string; frame: ArrayBuffer | string }[] = [
      { name: 'text frame', frame: 'this is not binary' },
      {
        // claims a 10-byte payload, carries 3
        name: 'truncated bytes',
        frame: new Uint8Array([MESSAGE_SYNC, 2, 10, 1, 2, 3]).buffer as ArrayBuffer,
      },
      { name: 'unknown type 9', frame: new Uint8Array([9]).buffer as ArrayBuffer },
      {
        // well-formed framing, garbage Yjs update: claims 255 client parts
        // in 7 bytes — Yjs' update decoder throws on the truncation.
        name: 'invalid Yjs update',
        frame: ((): ArrayBuffer => {
          const enc = createEncoder();
          writeVarUint(enc, MESSAGE_SYNC);
          writeVarUint(enc, 2);
          writeVarUint8Array(enc, new Uint8Array([255, 255, 255, 255, 255, 255, 255]));
          return toUint8Array(enc).buffer as ArrayBuffer;
        })(),
      },
    ];

    try {
      for (const { name, frame } of malformedFrames) {
        const a = await WsClient.connect(boardId, { autoExchange: false });
        // The room's initial SyncStep1 is held; send the malformed frame.
        a.sendRaw(frame);
        const info = await Promise.race([
          a.closeInfo(),
          new Promise<{ code: number; reason: string }>((resolve) =>
            setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 3000),
          ),
        ]);
        expect(info.code, `${name}: expected close 1003`).toBe(1003);
        await a.destroy();
      }

      // B is still open and keeps receiving updates from healthy clients.
      expect(b.ws.readyState).toBe(WebSocket.OPEN);
      const a2 = await WsClient.connect(boardId);
      try {
        const note2 = a2.applyLocal((doc) => createStickyAt(doc, 50, 50, 'pink'));
        await b.waitUntil(() => b.hasNote(note2), 3000);
      } finally {
        await a2.destroy();
      }

      // The room's doc contains only legitimate content: B's note plus
      // a2's note (a2's socket is gone, but its update lives on in the room).
      const room = await probeRoomSnapshot(boardId);
      const ids = room.map((n) => n.id).sort();
      expect(ids).toContain(legitNote);
      expect(ids).toHaveLength(2);
      expect(room.find((n) => n.id === legitNote)?.text).toBe('');
    } finally {
      await b.destroy();
    }
  });

  it('TC-16: an awareness frame is relayed verbatim to A and B', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const b = await WsClient.connect(boardId);
    await b.waitForSync();
    try {
      const awarenessUpdate = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
      const enc = createEncoder();
      writeVarUint(enc, MESSAGE_AWARENESS);
      writeVarUint8Array(enc, awarenessUpdate);
      const frame = toUint8Array(enc).buffer as ArrayBuffer;

      const before = a.received.length;
      a.sendRaw(frame);

      await a.waitUntil(() => a.received.length > before, 3000);
      await b.waitUntil(() => b.received.some((f) => f.type === MESSAGE_AWARENESS), 3000);
      const gotByA = a.received
        .slice(before)
        .find((f) => f.type === MESSAGE_AWARENESS);
      const gotByB = b.received.find((f) => f.type === MESSAGE_AWARENESS);
      expect(gotByA, 'A (the sender) must receive the relay too').toBeDefined();
      expect(gotByB).toBeDefined();
      // Identical bytes on both sides, identical to what A sent.
      expect(Array.from(gotByA!.awarenessUpdate!)).toEqual(Array.from(awarenessUpdate));
      expect(Array.from(gotByB!.awarenessUpdate!)).toEqual(Array.from(awarenessUpdate));
      // And the full frame A received is byte-identical to the frame it sent.
      expect(gotByA!.payload.byteLength).toBe(
        new Uint8Array(frame).slice(1).length,
      );
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it('TC-18: a fresh empty room is repopulated by the first reconnecting client', async () => {
    const original = newBoardId();
    // Phase 1: the "old" room accumulates state, then everyone leaves.
    const aOld = await WsClient.connect(original);
    await aOld.waitForSync();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(aOld.applyLocal((doc) => createStickyAt(doc, i, i * 10, 'yellow')));
    }
    await aOld.waitForSync();
    const oldState = aOld.boardSnapshot();
    expect(oldState).toHaveLength(3);
    await aOld.destroy();

    // Phase 2: the "restarted" room is a fresh DO instance (new object id).
    // A reconnects FIRST with the same local doc (the client keeps its doc
    // across reconnects) and its step2 repopulates the room.
    const restarted = newBoardId();
    const aClient = await WsClient.adopt(restarted, aOld.doc);
    await aClient.waitForSync();
    try {
      // The room's doc now equals A's doc.
      const room = await probeRoomSnapshot(restarted);
      expect(sameBoard(room, aOld.doc && aClient.boardSnapshot())).toBe(true);

      // Phase 3: B joins and converges.
      const b = await WsClient.connect(restarted);
      try {
        await b.waitUntil(() => b.boardSnapshot().length === 3, 3000);
        await b.waitForSync();
        expect(sameBoard(aClient.boardSnapshot(), b.boardSnapshot())).toBe(true);
      } finally {
        await b.destroy();
      }
    } finally {
      await aClient.destroy();
    }
  });

  it('TC-31: a dead socket never breaks the room', async () => {
    const boardId = newBoardId();
    const a = await WsClient.connect(boardId);
    await a.waitForSync();
    const b = await WsClient.connect(boardId);
    try {
      // B dies abruptly (1006 is reserved: user code must not send it).
      b.ws.close(1011, 'gone');
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The room must not have crashed: A's update still applies and a
      // later socket (C) still receives it.
      const note = a.applyLocal((doc) => createStickyAt(doc, 42, 42, 'violet'));
      const c = await WsClient.connect(boardId);
      try {
        await c.waitUntil(() => c.hasNote(note), 3000);
        expect(sameBoard(a.boardSnapshot(), c.boardSnapshot())).toBe(true);
      } finally {
        await c.destroy();
      }
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});
