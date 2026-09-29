import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEncoder, writeVarUint8Array, toUint8Array } from 'lib0/encoding';
import { RoomClient, settle } from './ws-client';
import { newBoardId } from '@/shared/board-id';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  LOCAL_ORIGIN,
} from '@/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '@/shared/config';
import { runRandomOps, snapshotsEqual } from './random-ops';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function connectBoth(boardId: string): Promise<{ a: RoomClient; b: RoomClient }> {
  const a = new RoomClient(boardId);
  const b = new RoomClient(boardId);
  await a.connect();
  await b.connect();
  await a.waitSync();
  await b.waitSync();
  return { a, b };
}

/** Polls until every client's snapshot equals client 0's (CRDT convergence). */
async function awaitAllEqual(clients: RoomClient[], timeoutMs = 20_000): Promise<boolean> {
  const start = Date.now();
  const allEq = () => clients.slice(1).every((c) => snapshotsEqual(c.notes(), clients[0].notes()));
  while (Date.now() - start < timeoutMs) {
    if (allEq()) return true;
    await settle(150);
  }
  return allEq();
}

describe('BoardRoom (real wrangler dev)', () => {
  it('TC-07: create -> B snapshot equals A; B receives exactly 1 update', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    const id = createSticky(a.doc, { x: 40, y: 60 }, 'yellow');
    expect(id).toBeTruthy();
    await settle(500);
    expect(b.receivedUpdates).toBe(1);
    expect(snapshotsEqual(a.notes(), b.notes())).toBe(true);
    expect(b.notes().some((s) => s.id === id)).toBe(true);
    a.close();
    b.close();
  }, 30_000);

  it.each(['move', 'recolor', 'type', 'delete'] as const)(
    'TC-08: %s -> B matches A and A gets no echo of its own update',
    async (kind) => {
      const boardId = newBoardId();
      const { a, b } = await connectBoth(boardId);
      const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
      await settle(400);
      const before = a.receivedUpdates;
      switch (kind) {
        case 'move':
          moveObject(a.doc, id, 12, 34);
          break;
        case 'recolor':
          setStickyColor(a.doc, id, 'blue');
          break;
        case 'type': {
          const t = getStickyText(a.doc, id);
          a.doc.transact(() => t!.insert(t!.length, 'hi '), LOCAL_ORIGIN);
          break;
        }
        case 'delete':
          deleteObject(a.doc, id);
          break;
      }
      await settle(500);
      expect(snapshotsEqual(a.notes(), b.notes())).toBe(true);
      expect(a.receivedUpdates).toBe(before); // no echo
      a.close();
      b.close();
    },
    30_000,
  );

  it('TC-09: concurrent text inserts merge to "red green blue"', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    a.doc.transact(() => getStickyText(a.doc, id)!.insert(0, 'green'), LOCAL_ORIGIN);
    await settle(500); // both now hold "green"

    a.setAutoPush(false);
    b.setAutoPush(false);
    // Concurrent, based on the same "green":
    a.doc.transact(() => getStickyText(a.doc, id)!.insert(0, 'red '), LOCAL_ORIGIN); // "red green"
    b.doc.transact(() => {
      const t = getStickyText(b.doc, id)!;
      t.insert(t.length, ' blue');
    }, LOCAL_ORIGIN); // "green blue"
    a.flush();
    b.flush();
    await settle(900);

    expect(String(getStickyText(a.doc, id))).toBe('red green blue');
    expect(String(getStickyText(b.doc, id))).toBe('red green blue');
    expect(snapshotsEqual(a.notes(), b.notes())).toBe(true);
    a.close();
    b.close();
  }, 30_000);

  it('TC-10: concurrent moves converge to the same x on both', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    await settle(400);

    a.setAutoPush(false);
    b.setAutoPush(false);
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.flush();
    b.flush();
    await settle(900);

    const na = a.notes().find((s) => s.id === id);
    const nb = b.notes().find((s) => s.id === id);
    expect(na).toBeTruthy();
    expect(nb).toBeTruthy();
    expect(na!.x).toBe(nb!.x); // same value on both (last-write-wins)
    expect(na!.y).toBe(nb!.y);
    a.close();
    b.close();
  }, 30_000);

  it('TC-11: delete vs concurrent text insert -> note gone, no stray text', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    a.doc.transact(() => getStickyText(a.doc, id)!.insert(0, 'base'), LOCAL_ORIGIN);
    await settle(500);

    a.setAutoPush(false);
    b.setAutoPush(false);
    deleteObject(a.doc, id);
    b.doc.transact(() => getStickyText(b.doc, id)!.insert(0, 'extra '), LOCAL_ORIGIN);
    a.flush();
    b.flush();
    await settle(900);

    expect(a.notes().some((s) => s.id === id)).toBe(false);
    expect(b.notes().some((s) => s.id === id)).toBe(false);
    const allText = [...a.notes(), ...b.notes()].map((s) => s.text).join('|');
    expect(allText).not.toContain('extra');
    a.close();
    b.close();
  }, 30_000);

  it('TC-12: 5 clients x 200 seeded random ops -> identical snapshots', async () => {
    const boardId = newBoardId();
    const n = MAX_CONCURRENT_EDITORS; // 5
    const base = 20240607;
    const clients = Array.from({ length: n }, () => new RoomClient(boardId));
    for (const c of clients) await c.connect();
    for (const c of clients) await c.waitSync();

    const results = await Promise.all(clients.map((c, i) => runRandomOps(c.doc, 200, base + i)));
    const converged = await awaitAllEqual(clients, 25_000);

    const ref = clients[0].notes();
    expect(ref.length).toBeGreaterThan(0);
    expect(converged).toBe(true);
    for (const c of clients) expect(snapshotsEqual(c.notes(), ref)).toBe(true);
    console.log(
      `[TC-12] base seed=${base}, per-client seeds=[${results.map((_, i) => base + i).join(',')}], ` +
        `created=[${results.map((r) => r.stats.created).join(',')}], final notes=${ref.length}`,
    );
    for (const c of clients) c.close();
  }, 90_000);

  it('TC-14: late joiner C snapshot equals A after 20 notes', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: 0 }, 'yellow');
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i, y: 10 }, 'blue');
    await settle(800);
    expect(a.notes().length).toBe(20);

    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitSync();
    await settle(300);
    expect(c.notes().length).toBe(20);
    expect(snapshotsEqual(c.notes(), a.notes())).toBe(true);
    a.close();
    b.close();
    c.close();
  }, 30_000);

  describe('TC-15: malformed traffic closes only the offender with 1003', () => {
    async function malformedCase(name: string, send: (a: RoomClient) => void) {
      const boardId = newBoardId();
      const b = new RoomClient(boardId);
      await b.connect();
      await b.waitSync();
      const baseId = createSticky(b.doc, { x: 0, y: 0 }, 'yellow');
      await settle(400);
      const baseline = b.notes();

      const a = new RoomClient(boardId);
      await a.connect();
      await a.waitSync();
      await settle(200);

      send(a);
      const code = await a.waitClose(6000);
      expect(code, `${name}: A closed with 1003`).toBe(1003);
      expect(b.closed, `${name}: B stays open`).toBe(false);
      expect(snapshotsEqual(b.notes(), baseline), `${name}: room doc unchanged`).toBe(true);

      // The room is still healthy and serves new clients.
      const c = new RoomClient(boardId);
      await c.connect();
      await c.waitSync();
      await settle(200);
      expect(c.notes().some((s) => s.id === baseId)).toBe(true);
      a.close();
      b.close();
      c.close();
    }

    it('text frame', async () => {
      await malformedCase('text', (a) => a.sendText('hello'));
    }, 30_000);

    it('truncated syncStep2 bytes', async () => {
      // outer=sync(0), inner=syncStep2(1), varUint8Array length=100 but only 4 bytes present
      await malformedCase('truncated', (a) => a.sendRaw(new Uint8Array([0, 1, 0x64, 0x01, 0x02, 0x03, 0x04])));
    }, 30_000);

    it('unknown message type', async () => {
      await malformedCase('unknown-type', (a) => a.sendRaw(new Uint8Array([9])));
    }, 30_000);

    it('invalid Yjs update', async () => {
      // outer=sync(0), inner=update(2), 4 bytes of garbage
      await malformedCase('invalid-update', (a) => a.sendRaw(new Uint8Array([0, 2, 4, 0xff, 0xff, 0xff, 0xff])));
    }, 30_000);
  });

  it('TC-16: awareness is relayed verbatim to A and B (identical bytes)', async () => {
    const boardId = newBoardId();
    const { a, b } = await connectBoth(boardId);
    const awarenessContent = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]);
    const enc = createEncoder();
    writeVarUint8Array(enc, awarenessContent);
    const inner = new Uint8Array(toUint8Array(enc));
    a.sendFrame(1, inner); // MESSAGE_AWARENESS
    await settle(700);

    expect(a.awarenessReceived.some((p) => bytesEqual(p, awarenessContent))).toBe(true);
    expect(b.awarenessReceived.some((p) => bytesEqual(p, awarenessContent))).toBe(true);
    a.close();
    b.close();
  }, 30_000);

  it('TC-18: after a restart the first rejoiner repopulates; B converges', async () => {
    // Phase 1: A and B populate board X.
    const x = newBoardId();
    const a = new RoomClient(x);
    const b = new RoomClient(x);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: 0 }, 'yellow');
    await settle(600);
    expect(a.notes().length).toBe(3);
    expect(snapshotsEqual(a.notes(), b.notes())).toBe(true);
    a.close();
    b.close();

    // Phase 2: "restart" = a fresh DO instance (new object id, empty doc).
    const fresh = newBoardId();
    // A reconnects FIRST, reusing its doc (still holds the 3 notes).
    const a2 = new RoomClient(fresh, a.doc);
    await a2.connect();
    await a2.waitSync();
    // A brand-new client sees the repopulated room (= A's doc).
    const c = new RoomClient(fresh);
    await c.connect();
    await c.waitSync();
    await settle(300);
    expect(c.notes().length).toBe(3);
    expect(snapshotsEqual(c.notes(), a2.notes())).toBe(true); // fresh room == A's doc

    // Then B reconnects (reusing its doc) and converges.
    const b2 = new RoomClient(fresh, b.doc);
    await b2.connect();
    await b2.waitSync();
    await settle(500);
    expect(b2.notes().length).toBe(3);
    expect(snapshotsEqual(b2.notes(), a2.notes())).toBe(true);
    a2.close();
    b2.close();
    c.close();
  }, 30_000);

  it('TC-31: a dead socket does not break the room; later sockets still receive', async () => {
    const boardId = newBoardId();
    const a = new RoomClient(boardId);
    const b = new RoomClient(boardId);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();

    b.close(); // B drops
    await settle(300);

    const n1 = createSticky(a.doc, { x: 1, y: 0 }, 'yellow');
    await settle(400);

    // A later joiner receives the room's state and continues to get updates.
    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitSync();
    await settle(300);
    const n2 = createSticky(a.doc, { x: 2, y: 0 }, 'blue');
    await settle(500);

    expect(c.notes().some((s) => s.id === n1)).toBe(true);
    expect(c.notes().some((s) => s.id === n2)).toBe(true);
    expect(a.notes().some((s) => s.id === n1)).toBe(true);
    expect(a.notes().some((s) => s.id === n2)).toBe(true);
    a.close();
    c.close();
  }, 30_000);
});

// Keep the Y import used (doc reuse in TC-18 relies on Y.Doc identity).
void Y;
