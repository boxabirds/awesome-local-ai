import { describe, it, expect } from 'vitest';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
} from '../../src/shared/board-model.ts';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config.ts';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol.ts';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import { TestClient, snapEq, tick } from './helpers/ws-client.ts';
import { runSeededOps } from './helpers/random-ops.ts';

async function pair(): Promise<[TestClient, TestClient, string]> {
  const id = newBoardId();
  const a = await TestClient.connect(id);
  const b = await TestClient.connect(id);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  return [a, b, id];
}

// Let the initial-sync handshake (each side's meta/schemaVersion SyncStep2s,
// which the room may broadcast) fully settle before measuring anything.
async function settled(a: TestClient, b: TestClient): Promise<void> {
  await b.waitForEqualSnapshot(a);
  await tick(80);
}

function textOf(c: TestClient, id: string): string {
  const t = getStickyText(c.doc, id);
  return t ? t.toString() : '';
}

// TC-07: single-writer create propagates exactly once.
it('TC-07 A creates a sticky; B converges and receives exactly one update', async () => {
  const [a, b] = await pair();
  // Settle the initial-sync handshake before A's single create, so the count is
  // only A's operation.
  await settled(a, b);
  const id = createSticky(a.doc, { x: 10, y: 20 });
  await b.waitForEqualSnapshot(a, LIVE_UPDATE_LATENCY_BUDGET_MS);
  expect(b.snapshot()).toEqual(a.snapshot());
  expect(b.snapshot().map((s) => s.id)).toContain(id);
  expect(b.updateCount).toBe(1);
  a.close();
  b.close();
});

// TC-08: one test per operation kind; sender never sees an echo.
describe('TC-08 per-operation propagation with no sender echo', () => {
  it('move', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await settled(a, b);
    const before = a.mark();
    moveObject(a.doc, id, 123, 456);
    await b.waitForEqualSnapshot(a);
    expect(b.snapshot().find((s) => s.id === id)!.x).toBe(123);
    expect(a.updateCount).toBe(before); // no echo to A
  });

  it('recolour', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await settled(a, b);
    const before = a.mark();
    setStickyColor(a.doc, id, 'blue');
    await b.waitForEqualSnapshot(a);
    expect(b.snapshot().find((s) => s.id === id)!.color).toBe('blue');
    expect(a.updateCount).toBe(before);
  });

  it('text insert', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await settled(a, b);
    const before = a.mark();
    getStickyText(a.doc, id)!.insert(0, 'hello');
    await b.waitForEqualSnapshot(a);
    expect(textOf(b, id)).toBe('hello');
    expect(a.updateCount).toBe(before);
  });

  it('delete', async () => {
    const [a, b] = await pair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await settled(a, b);
    const before = a.mark();
    deleteObject(a.doc, id);
    await b.waitFor(() => b.snapshot().length === 0, LIVE_UPDATE_LATENCY_BUDGET_MS, 'B sees delete');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.updateCount).toBe(before);
  });
});

// TC-09: concurrent text inserts at different positions are all kept.
it('TC-09 concurrent text inserts both survive and converge', async () => {
  const [a, b] = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 });
  getStickyText(a.doc, id)!.insert(0, 'green');
  await b.waitFor(() => textOf(b, id) === 'green');
  // Both edit before either sees the other's change (no await between).
  getStickyText(a.doc, id)!.insert(0, 'red ');
  getStickyText(b.doc, id)!.insert(textOf(b, id).length, ' blue');
  await b.waitForEqualSnapshot(a, LIVE_UPDATE_LATENCY_BUDGET_MS);
  expect(textOf(a, id)).toBe('red green blue');
  expect(textOf(b, id)).toBe('red green blue');
});

// TC-10: concurrent map sets on the same property converge to one value.
it('TC-10 concurrent x=100 vs x=300 converge identically on both', async () => {
  const [a, b] = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 });
  await b.waitForEqualSnapshot(a);
  moveObject(a.doc, id, 100, 0);
  moveObject(b.doc, id, 300, 0);
  await b.waitForEqualSnapshot(a, LIVE_UPDATE_LATENCY_BUDGET_MS);
  const xa = a.snapshot().find((s) => s.id === id)!.x;
  const xb = b.snapshot().find((s) => s.id === id)!.x;
  expect(xa).toBe(xb);
  expect([100, 300]).toContain(xa);
});

// TC-11 (negative): a delete during a concurrent edit wins, no resurrection.
it('TC-11 delete during concurrent text insert: note is gone everywhere', async () => {
  const [a, b] = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 });
  await b.waitForEqualSnapshot(a);
  deleteObject(a.doc, id);
  getStickyText(b.doc, id)!.insert(0, 'typing into a doomed note');
  await Promise.all([
    a.waitFor(() => a.snapshot().length === 0, LIVE_UPDATE_LATENCY_BUDGET_MS, 'A empty'),
    b.waitFor(() => b.snapshot().length === 0, LIVE_UPDATE_LATENCY_BUDGET_MS, 'B empty'),
  ]);
  // B's text is nowhere: every remaining note has none of it.
  const allText = [...a.snapshot(), ...b.snapshot()].map((s) => s.text).join('|');
  expect(allText).not.toMatch(/doomed/);
});

// TC-12: full-capacity seeded soak converges to identical snapshots.
it('TC-12 MAX_CONCURRENT_EDITORS clients x 200 seeded ops converge', async () => {
  const boardId = newBoardId();
  const seed = 1234567;
  const n = MAX_CONCURRENT_EDITORS;
  const clients: TestClient[] = [];
  for (let i = 0; i < n; i++) clients.push(await TestClient.connect(boardId));
  await Promise.all(clients.map((c) => c.waitForSync()));

  const stats = clients.map((c, i) => runSeededOps(c.doc, 200, seed + i));
  console.log('TC-12 seed base', seed, 'ops per client', stats[0].ops);

  // Every client's snapshot must converge to the same end state.
  await Promise.all(
    clients.slice(1).map((c) => c.waitFor(() => snapEq(c.snapshot(), clients[0].snapshot()),
      LIVE_UPDATE_LATENCY_BUDGET_MS * 5, 'convergence')),
  );
  const base = clients[0].snapshot();
  for (const c of clients) expect(snapEq(c.snapshot(), base)).toBe(true);

  // Every note a client created and did NOT delete is present in the end state.
  const present = new Set(base.map((s) => s.id));
  for (const st of stats) {
    for (const id of st.created) {
      if (!st.deleted.includes(id)) expect(present.has(id)).toBe(true);
    }
  }
  for (const c of clients) c.close();
});

// TC-13 lives in worker.test.ts (routing boundary). TC-14 here.
// TC-14: a late joiner catches up on initial sync.
it('TC-14 late joiner C snapshot equals A after 20+20 notes', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connect(boardId);
  const b = await TestClient.connect(boardId);
  await a.waitForSync();
  await b.waitForSync();
  for (let i = 0; i < 20; i++) {
    createSticky(a.doc, { x: i * 10, y: 0 });
    createSticky(b.doc, { x: 0, y: i * 10 });
  }
  await b.waitForEqualSnapshot(a, LIVE_UPDATE_LATENCY_BUDGET_MS * 3);

  const c = await TestClient.connect(boardId);
  await c.waitForSync();
  await c.waitFor(() => snapEq(c.snapshot(), a.snapshot()), LIVE_UPDATE_LATENCY_BUDGET_MS * 3, 'C catches up');
  expect(snapEq(c.snapshot(), a.snapshot())).toBe(true);
  expect(c.snapshot().length).toBeGreaterThanOrEqual(40);
  a.close();
  b.close();
  c.close();
});

// TC-15 (negative, error path): malformed traffic from A closes ONLY A; B keeps
// working; the room document is not corrupted. Four malformed shapes.
describe('TC-15 malformed traffic closes the sender only', () => {
  const cases: Array<{ name: string; send: (c: TestClient) => void }> = [
    { name: 'text frame', send: (c) => c.sendText('this is not a y-websocket frame') },
    {
      name: 'truncated sync bytes',
      send: (c) => {
        // SyncStep2 header promising 100 bytes, but only a few are present.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
        encoding.writeVarUint(enc, syncProtocol.messageYjsSyncStep2);
        encoding.writeVarUint(enc, 100); // promises 100 bytes of update
        encoding.writeUint8(enc, 0x00); // only one byte of the update follows
        c.sendRaw(encoding.toUint8Array(enc));
      },
    },
    {
      name: 'unknown type',
      send: (c) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 9); // not a known message type
        encoding.writeUint8(enc, 1);
        c.sendRaw(encoding.toUint8Array(enc));
      },
    },
    {
      name: 'invalid Yjs update',
      send: (c) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
        encoding.writeVarUint(enc, syncProtocol.messageYjsUpdate);
        encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); // garbage
        c.sendRaw(encoding.toUint8Array(enc));
      },
    },
  ];

  for (const kase of cases) {
    it(kase.name, async () => {
      const [a, b] = await pair();
      // Put one good note in the room so B's later update proves it still works.
      const good = createSticky(a.doc, { x: 5, y: 5 });
      await b.waitFor(() => b.snapshot().some((s) => s.id === good));

      kase.send(a);
      const code = await a.waitForClose();
      expect(code).toBe(CLOSE_UNSUPPORTED_DATA);

      // B is untouched: still open, and a fresh edit still propagates and holds.
      expect(b.open).toBe(true);
      const later = createSticky(b.doc, { x: 7, y: 7 });
      await b.waitFor(() => b.snapshot().some((s) => s.id === later));
      // Room doc unchanged by the malformed message: the good note is still there
      // (observable through B) and B's own note count is exactly 2.
      await tick(50);
      expect(b.snapshot().some((s) => s.id === good)).toBe(true);
      expect(b.snapshot()).toHaveLength(2);
      b.close();
    });
  }
});

// TC-16: awareness relay echoes identical bytes to sender and peer.
it('TC-16 awareness bytes are relayed verbatim to all sockets', async () => {
  const [a, b] = await pair();
  // Build a REAL awareness update so receivers can apply it (the room relays
  // bytes verbatim regardless, but valid bytes let us also assert application).
  a.awareness.setLocalStateField('user', 'alex');
  const update = awarenessProtocol.encodeAwarenessUpdate(a.awareness, [a.awareness.clientID]);
  a.sendAwareness(update);
  await b.waitFor(() => b.received.some((r) => r.kind === 'awareness'), LIVE_UPDATE_LATENCY_BUDGET_MS);
  // The sender also receives its own awareness (keepalive) — identical bytes.
  await a.waitFor(() => a.received.some((r) => r.kind === 'awareness'));
  const bytesEq = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((v, i) => v === y[i]);
  const bAware = b.received.find((r) => r.kind === 'awareness')!.bytes;
  const aAware = a.received.find((r) => r.kind === 'awareness')!.bytes;
  expect(bytesEq(bAware, update)).toBe(true);
  expect(bytesEq(aAware, update)).toBe(true);
  // B actually applied A's presence.
  expect(b.awareness.getStates().get(a.awareness.clientID)).toEqual({ user: 'alex' });
  a.close();
  b.close();
});

// TC-17 lives in worker.test.ts (isolation boundary).

// TC-18 (restart simulation): all sockets closed, fresh room instance; the first
// reconnecting client repopulates the empty room via SyncStep2.
it('TC-18 fresh room is repopulated by the first reconnecting client', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connect(boardId);
  const b = await TestClient.connect(boardId);
  await a.waitForSync();
  await b.waitForSync();
  for (let i = 0; i < 5; i++) createSticky(a.doc, { x: i, y: i });
  await b.waitForEqualSnapshot(a);
  const original = a.snapshot();
  expect(original.length).toBe(5);

  // Simulate a restart: both clients disconnect (their Y.Docs survive on the
  // client side) and a FRESH room id stands in for the restarted, empty Durable
  // Object. A reconnects its own doc first.
  a.close();
  b.close();
  await tick(50);
  const restarted = newBoardId();

  await a.reconnect(restarted);
  await a.waitFor(() => snapEq(a.snapshot(), original), LIVE_UPDATE_LATENCY_BUDGET_MS, 'A keeps its doc');
  // A's SyncStep2 repopulated the (empty) room. A fresh observer proves the SERVER
  // recovered, not just A.
  const probe = await TestClient.connect(restarted);
  await probe.waitForSync();
  await probe.waitFor(() => snapEq(probe.snapshot(), original), LIVE_UPDATE_LATENCY_BUDGET_MS, 'room repopulated');
  expect(snapEq(probe.snapshot(), original)).toBe(true);

  // B reconnects the same restarted room and converges (its own doc matches).
  await b.reconnect(restarted);
  await b.waitFor(() => snapEq(b.snapshot(), a.snapshot()), LIVE_UPDATE_LATENCY_BUDGET_MS, 'B converges');
  expect(snapEq(b.snapshot(), a.snapshot())).toBe(true);
  a.close();
  b.close();
  probe.close();
});

// TC-31 (error path): a dead socket must not break the room for later sockets.
it('TC-31 broadcasting to a dead socket does not throw or block others', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connect(boardId);
  const b = await TestClient.connect(boardId);
  const c = await TestClient.connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync(), c.waitForSync()]);

  // B goes away abruptly.
  b.close();
  await tick(30);

  // A keeps editing; the room must not throw and C (a live socket) keeps getting
  // every later update.
  for (let i = 0; i < 5; i++) {
    const id = createSticky(a.doc, { x: i, y: i });
    await c.waitFor(() => c.snapshot().some((s) => s.id === id), LIVE_UPDATE_LATENCY_BUDGET_MS, 'C sees A note');
  }
  expect(c.snapshot()).toHaveLength(5);
  a.close();
  c.close();
});

// Sanity: the helper imports are all used and Y re-export is real.
it('sanity: yjs round trip in test realm', () => {
  const d = new Y.Doc();
  d.getMap('x').set('a', 1);
  expect((d.getMap('x') as Y.Map<unknown>).get('a')).toBe(1);
});
