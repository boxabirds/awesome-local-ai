import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createBoard } from './hooks';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { boardUrl, RoomClient, sameNotes, waitUntil } from './ws-client';
import { makeRandomOps } from './random-ops';

describe('BoardRoom advanced behavior', () => {
  it('TC-12: 5 clients x 200 seeded random ops converge to identical boards', async () => {
    const seed = 0x5eed_2024;
    const board = await createBoard();
    const clients: RoomClient[] = [];
    const ops: Array<ReturnType<typeof makeRandomOps>> = [];
    for (let i = 0; i < 5; i++) {
      const c = await RoomClient.connect(boardUrl(board));
      await c.waitForSync();
      clients.push(c);
      ops.push(makeRandomOps(c.doc, seed + i * 7919));
    }
    // each client does 200 ops while the others are live
    for (const o of ops) o.run(200);

    const created = new Set(ops.flatMap((o) => o.createdIds));
    const deleted = new Set(ops.flatMap((o) => [...o.deletedIds]));
    const mustExist = new Set([...created].filter((id) => !deleted.has(id)));

    await waitUntil(
      () => clients.every((c, i) => (i === 0 || sameNotes(clients[0].notes(), c.notes()))),
      20_000,
    );
    const finalIds = new Set(clients[0].notes().map((n) => n.id));
    for (const id of mustExist) expect(finalIds.has(id)).toBe(true);
    // every note on the board is one the ops created
    for (const id of finalIds) expect(created.has(id)).toBe(true);
    console.log(`TC-12: seed=${seed} ops=5x200 finalNotes=${clients[0].notes().length}`);
    for (const c of clients) c.close();
  }, 30_000);

  it('TC-14: a late joiner receives the full state, not just the delta', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();
    for (let i = 0; i < 20; i++) {
      createSticky(A.doc, { x: i * 10, y: 0 }, (['yellow', 'green', 'blue'] as const)[i % 3]);
    }
    createSticky(B.doc, { x: 999, y: 999 });
    await waitUntil(() => A.notes().length === 21 && B.notes().length === 21);

    // C joins after all of that
    const C = await RoomClient.connect(boardUrl(board));
    await C.waitForSync();
    await waitUntil(() => C.notes().length === 21);
    expect(sameNotes(A.notes(), C.notes())).toBe(true);
    A.close();
    B.close();
    C.close();
  });

  it('TC-15: malformed data closes the offending client with 1003 and leaves the room healthy', async () => {
    const board = await createBoard();
    let A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();

    const invalidUpdate = (() => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 2); // inner "update" message type
      encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3, 4])); // garbage yjs bytes
      return encoding.toUint8Array(enc);
    })();

    const variants: Array<[string, string | Uint8Array]> = [
      ['text frame', 'hello, not a frame'],
      ['truncated frame', new Uint8Array([0, 3])], // sync, payload len 3, no payload
      ['unknown message type', new Uint8Array([0xff, 0x05, 1, 2, 3, 4, 5])],
      ['invalid yjs update', invalidUpdate],
    ];

    for (const [name, payload] of variants) {
      console.log(`TC-15 variant: ${name}`);
      A.sendRaw(payload);
      const close = await A.waitForClose(10_000);
      expect(close.code, name).toBe(1003);

      // room is still healthy: B is untouched and relaying still works
      expect(B.closed, name).toBeNull();
      const fresh = await RoomClient.connect(boardUrl(board));
      await fresh.waitForSync();
      const id = createSticky(fresh.doc, { x: 1, y: 1 });
      await waitUntil(() => B.notes().some((n) => n.id === id));
      fresh.close();

      A = await RoomClient.connect(boardUrl(board));
      await A.waitForSync();
    }
    B.close();
    A.close();
  }, 30_000);

  it('TC-16: awareness frames are echoed to all connected clients', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    const B = await RoomClient.connect(boardUrl(board));
    await B.waitForSync();

    const aw = new Awareness(A.doc);
    aw.setLocalStateField('user', 'A');
    const payload = encodeAwarenessUpdate(aw, [aw.clientID]);
    expect(payload.byteLength).toBeGreaterThan(0);
    A.sendAwareness(payload);

    const has = (c: RoomClient) => c.receivedAwareness.some((p) => bytesEqual(p, payload));
    await waitUntil(() => has(A) && has(B));
    expect(has(B)).toBe(true);
    A.close();
    B.close();
  });

  it('TC-17: separate boards do not mix', async () => {
    const board1 = await createBoard();
    const board2 = await createBoard();
    const A = await RoomClient.connect(boardUrl(board1));
    const B = await RoomClient.connect(boardUrl(board2));
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 5, y: 5 });
    await waitUntil(() => A.notes().some((n) => n.id === id));
    // give any (mis)delivery a chance to happen
    await new Promise((r) => setTimeout(r, 300));
    expect(B.notes()).toHaveLength(0);
    expect(A.notes().some((n) => n.id === id)).toBe(true);
    A.close();
    B.close();
  });

  it('TC-18: after a full disconnect and reconnect, the board state survives and a new client converges', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();
    const id = createSticky(A.doc, { x: 7, y: 8 }, 'pink');
    getStickyText(A.doc, id)!.insert(0, 'survivor');
    await waitUntil(() => B.notes().some((n) => n.id === id && n.text === 'survivor'));

    // everyone drops
    A.close();
    B.close();
    await waitUntil(() => A.closed !== null && B.closed !== null);

    // A reconnects with the same doc; B comes back with a fresh one
    const A2 = await RoomClient.connect(boardUrl(board));
    const B2 = await RoomClient.connect(boardUrl(board));
    // transfer A's doc into A2 (simulating the same user's reconnection)
    Y.applyUpdate(A2.doc, Y.encodeStateAsUpdate(A.doc), A2);
    await A2.waitForSync();
    await B2.waitForSync();

    await waitUntil(() => {
      const n = B2.notes().find((x) => x.id === id);
      return n !== undefined && n.text === 'survivor';
    });
    expect(sameNotes(A2.notes(), B2.notes())).toBe(true);
    A2.close();
    B2.close();
  });

  it('TC-31: an abrupt disconnect does not break later broadcast', async () => {
    const board = await createBoard();
    const A = await RoomClient.connect(boardUrl(board));
    const B = await RoomClient.connect(boardUrl(board));
    const C = await RoomClient.connect(boardUrl(board));
    await A.waitForSync();
    await B.waitForSync();
    await C.waitForSync();

    // B disappears without warning
    B.close(1006, 'abrupt');

    // A keeps broadcasting; C (a healthy client) still receives
    const id = createSticky(A.doc, { x: 11, y: 11 });
    await waitUntil(() => C.notes().some((n) => n.id === id), 10_000);
    // A is unaffected
    expect(A.closed).toBeNull();
    A.close();
    C.close();
  });
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
