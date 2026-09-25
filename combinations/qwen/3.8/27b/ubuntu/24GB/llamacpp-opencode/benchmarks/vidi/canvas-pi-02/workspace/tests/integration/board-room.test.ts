import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  hasObject,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { erasureSnapshots, runRandomOps } from './random-ops';
import {
  connectClient,
  connectClientWithDoc,
  connectRawClient,
  noteCount,
  sameBytes,
  updateFrame,
  WsClient,
} from './ws-client';

async function connectionCount(boardId: string): Promise<number> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room) => room.connectionCount);
}

/** Poll until the condition holds (or throw). */
async function until(cond: () => boolean, timeoutMs = 10_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Wait until the count of update frames received by `c` stops changing for
 * `quietMs` — i.e. handshake traffic has fully drained — and return the
 * settled count.
 */
async function awaitUpdatesSettled(
  c: WsClient,
  quietMs = 200,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let stableSince = Date.now();
  let count = c.updateCount;
  for (;;) {
    if (Date.now() > deadline) throw new Error('update count did not settle');
    await new Promise((r) => setTimeout(r, 20));
    if (c.updateCount !== count) {
      count = c.updateCount;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return count;
    }
  }
}

/** Poll until both replicas render the same board (raw snapshots: same ids). */
async function awaitSnapshotsEqual(a: WsClient, b: WsClient, timeoutMs = 10_000): Promise<void> {
  await until(
    () => JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()),
    timeoutMs,
    'snapshots to converge',
  );
}

/**
 * sync.room — the BoardRoom Durable Object: one Y.Doc per board, relayed
 * over WebSockets (tasks 5-6, TC-07 to TC-18, TC-31).
 */
describe('sync.room', () => {
  it('TC-07 A creates a sticky: B converges and received exactly one update', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();
    const before = b.updateCount;
    const id = createSticky(a.doc, { x: 10, y: 20 }, 'green');
    expect(id).not.toBe('');
    await b.waitForNote(id);
    expect(b.updateCount).toBe(before + 1);
    expect(b.snapshot()).toEqual(a.snapshot());
    a.close();
    b.close();
  }, 20_000);

  it('TC-08 move, recolour, text insert and delete all reach B; A gets no echo', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    await b.waitForNote(id);
    // Baseline: the handshake itself exchanges meta updates between the
    // replicas (B's initDoc meta is broadcast to A once B's Step2 round-
    // trip completes, which can land after B's own sync resolves). Wait
    // for that handshake traffic to drain; from here on, A must receive
    // nothing at all.
    const baseline = await awaitUpdatesSettled(a);

    // move
    moveObject(a.doc, id, 55, 66);
    await awaitSnapshotsEqual(a, b);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.updateCount).toBe(baseline);

    // recolour
    setStickyColor(a.doc, id, 'violet');
    await awaitSnapshotsEqual(a, b);
    expect(a.updateCount).toBe(baseline);

    // text insert
    getStickyText(a.doc, id)!.insert(0, 'hello ');
    await awaitSnapshotsEqual(a, b);
    expect(a.updateCount).toBe(baseline);

    // delete
    deleteObject(a.doc, id);
    await awaitSnapshotsEqual(a, b);
    expect(noteCount(b.doc)).toBe(0);
    expect(a.updateCount).toBe(baseline); // the room never echoes to the sender
    a.close();
    b.close();
  }, 20_000);

  it('TC-09 concurrent text edits merge on both replicas', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 }, 'blue');
    await b.waitForNote(id);
    getStickyText(a.doc, id)!.insert(0, 'green');
    await awaitSnapshotsEqual(a, b);

    // Both edit the same text before anything is exchanged.
    a.setPaused(true);
    getStickyText(a.doc, id)!.insert(0, 'red '); // A: 'red green'
    getStickyText(b.doc, id)!.insert(5, ' blue'); // B: 'green blue' (at the end)
    a.setPaused(false); // exchange: each replica now holds one local + one remote edit

    await awaitSnapshotsEqual(a, b);
    expect(getStickyText(a.doc, id)!.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)!.toString()).toBe('red green blue');
    a.close();
    b.close();
  }, 20_000);

  it('TC-10 concurrent moves settle on one identical position', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 }, 'pink');
    await b.waitForNote(id);

    a.setPaused(true);
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);
    a.setPaused(false);

    await awaitSnapshotsEqual(a, b);
    const xa = a.doc.getMap('objects').get(id)!.get('x');
    const xb = b.doc.getMap('objects').get(id)!.get('x');
    expect(xa).toBe(xb); // one deterministic winner, identical everywhere
    a.close();
    b.close();
  }, 20_000);

  it('TC-11 delete wins over concurrent text insert; no resurrection, no exception', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 }, 'orange');
    await b.waitForNote(id);

    a.setPaused(true);
    deleteObject(a.doc, id); // A deletes
    getStickyText(b.doc, id)!.insert(0, 'resurrect me '); // B types into the doomed note
    a.setPaused(false);

    await until(() => !hasObject(a.doc, id) && !hasObject(b.doc, id), 10_000, 'delete to win');
    // B's typed text is nowhere on either board.
    for (const c of [a, b]) {
      const texts: string[] = [];
      c.doc.getMap('objects').forEach((obj) => {
        const t = obj.get('text');
        if (t instanceof Y.Text) texts.push(t.toString());
      });
      expect(texts.some((t) => t.includes('resurrect me'))).toBe(false);
    }
    a.close();
    b.close();
  }, 20_000);

  it(`TC-12 ${MAX_CONCURRENT_EDITORS} clients x 200 seeded random ops -> identical snapshots`, async () => {
    const seed = 20260214;
    console.log(`TC-12 seed=${seed} opsPerClient=200`);
    const boardId = newBoardId();
    const clients: WsClient[] = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => connectClient(boardId)),
    );
    await Promise.all(clients.map((c) => c.waitForSync()));

    for (const c of clients) {
      runRandomOps(c.doc, seed, 200);
    }

    // Every replica must converge to the same logical board.
    await until(() => {
      const first = JSON.stringify(erasureSnapshots(clients[0].snapshot()));
      return clients.every((c) => JSON.stringify(erasureSnapshots(c.snapshot())) === first);
    }, 60_000, 'all replicas to converge');
    const first = erasureSnapshots(clients[0].snapshot());
    expect(first.length).toBeGreaterThan(0);
    for (const c of clients) {
      expect(erasureSnapshots(c.snapshot())).toEqual(first);
    }
    for (const c of clients) c.close();
  }, 120_000);

  it(`TC-13 ${MAX_CONCURRENT_EDITORS + 1} sockets on one board: all accepted, last one reaches all others`, async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS + 1 }, () => connectClient(boardId)),
    );
    await Promise.all(clients.map((c) => c.waitForSync()));
    expect(await connectionCount(boardId)).toBe(MAX_CONCURRENT_EDITORS + 1);
    const id = createSticky(clients[clients.length - 1].doc, { x: 0, y: 0 }, 'green');
    for (const other of clients.slice(0, -1)) {
      await other.waitForNote(id);
    }
    for (const c of clients) c.close();
  }, 30_000);

  it('TC-14 late joiner C sees exactly what A and B made', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i, y: 0 }, 'yellow');
      createSticky(b.doc, { x: i, y: 100 }, 'blue');
    }
    await awaitSnapshotsEqual(a, b, 30_000);
    expect(noteCount(a.doc)).toBe(20);

    const c = await connectClient(boardId);
    await c.waitForSync();
    expect(c.snapshot()).toEqual(a.snapshot());
    a.close();
    b.close();
    c.close();
  }, 30_000);

  it('TC-15 malformed traffic: A closed with 1003, B still works, room doc unchanged', async () => {
    const variants: Array<{ name: string; frame: () => Uint8Array | string }> = [
      { name: 'text frame', frame: () => 'not a binary frame' },
      {
        name: 'truncated bytes',
        frame: () => {
          const scratch = new Y.Doc();
          const id = createSticky(scratch, { x: 0, y: 0 }, 'green');
          const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(new Y.Doc()));
          return updateFrame(update).slice(0, Math.floor(updateFrame(update).length * 0.6));
        },
      },
      { name: 'unknown message type', frame: () => new Uint8Array([7]) },
      {
        name: 'invalid Yjs update',
        frame: () => {
          const scratch = new Y.Doc();
          createSticky(scratch, { x: 0, y: 0 }, 'green');
          const update = Y.encodeStateAsUpdate(scratch, Y.encodeStateVector(new Y.Doc()));
          return updateFrame(update.slice(0, Math.floor(update.length * 0.8)));
        },
      },
    ];

    for (const { name, frame } of variants) {
      const boardId = newBoardId();
      const b = await connectClient(boardId);
      await b.waitForSync();
      const c = await connectClient(boardId);
      await c.waitForSync();
      const a = await connectRawClient(boardId);
      const before = b.snapshot();

      a.sendRaw(frame());
      const info = await a.closed;
      expect(info.code, name).toBe(CLOSE_UNSUPPORTED_DATA);

      // The room's doc is unchanged by the garbage.
      expect(b.snapshot()).toEqual(before);

      // B is still open and still receives: C's note reaches B.
      const id = createSticky(c.doc, { x: 1, y: 1 }, 'yellow');
      await b.waitForNote(id);

      b.close();
      c.close();
    }
  }, 60_000);

  it('TC-16 awareness bytes reach A and B identically', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();

    const aBefore = a.awarenessFrames.length;
    const bBefore = b.awarenessFrames.length;
    a.sendAwareness(a.encodeAwareness({ user: 'alice' }));

    await until(
      () =>
        a.awarenessFrames.length > aBefore && b.awarenessFrames.length > bBefore,
      10_000,
      'awareness relay',
    );
    expect(sameBytes(a.awarenessFrames[aBefore], b.awarenessFrames[bBefore])).toBe(true);
    a.close();
    b.close();
  }, 20_000);

  it('TC-18 on reconnect the client re-sends state; a fresh joiner converges', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    const seedId = createSticky(b.doc, { x: 0, y: 0 }, 'yellow');
    await until(() => hasObject(a.doc, seedId), 10_000, 'seed note on a');
    // Everyone goes offline. (The pool cannot force the DO instance to be
    // evicted, so the in-memory doc outlives the last socket here; on a real
    // restart it would be discarded. The mechanism under test is the one that
    // makes restarts safe: every (re)connection re-sends state, so the first
    // client back repopulates the room.)
    a.close();
    b.close();
    const a2 = await connectClientWithDoc(boardId, a.doc);
    await a2.waitForSync();
    const c = await connectClient(boardId);
    await c.waitForSync();
    expect(hasObject(c.doc, seedId)).toBe(true);
    expect(c.snapshot()).toEqual(a2.snapshot());
    c.close();
    a2.close();
  }, 30_000);

  it('TC-31 a closed-and-gone socket does not break the room', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    const b = await connectClient(boardId);
    await b.waitForSync();
    // B's socket goes away without further handshake traffic.
    b.close();
    // A keeps working; a later socket still receives updates.
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'green');
    const c = await connectClient(boardId);
    await c.waitForSync();
    await c.waitForNote(id);
    expect(noteCount(c.doc)).toBe(1);
    // The room itself is alive and answerable.
    expect(await connectionCount(boardId)).toBeGreaterThanOrEqual(1);
    a.close();
    c.close();
  }, 20_000);

  // --- additional coverage (beyond the TC list) ----------------------------

  it('a WebSocket upgrade is accepted and the room counts the connection', async () => {
    const boardId = newBoardId();
    const client = await connectClient(boardId);
    await client.waitForSync();
    expect(await connectionCount(boardId)).toBe(1);
    client.close();
  }, 20_000);

  it('a new board starts with an empty doc', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    expect(noteCount(a.doc)).toBe(0);
    a.close();
  }, 20_000);

  it('the room drops a closed socket (connection count decrements)', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    expect(await connectionCount(boardId)).toBe(2);
    a.close();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await connectionCount(boardId)) > 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await connectionCount(boardId)).toBe(1);
    b.close();
  }, 30_000);

  it('10,000 sequential updates are all applied', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    let lastId = '';
    for (let i = 0; i < 10_000; i++) {
      lastId = createSticky(a.doc, { x: i, y: i }, 'yellow');
    }
    await b.waitForNote(lastId, 120_000);
    expect(noteCount(b.doc)).toBe(10_000);
    a.close();
    b.close();
  }, 180_000);

  it('a change propagates within the latency budget', async () => {
    const budgetMs = 1000; // PRD live.propagate
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    const sentAt = Date.now();
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    await b.waitForNote(id);
    expect(Date.now() - sentAt).toBeLessThan(budgetMs);
    a.close();
    b.close();
  }, 20_000);

  it('an offline client catches up after reconnecting with its kept doc', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    createSticky(b.doc, { x: 0, y: 0 }, 'yellow');
    await until(() => noteCount(a.doc) === 1, 10_000, 'seed note');
    a.close();
    for (let i = 0; i < 100; i++) {
      createSticky(b.doc, { x: i, y: i }, 'blue');
    }
    const a2 = await connectClientWithDoc(boardId, a.doc);
    await a2.waitForSync();
    expect(noteCount(a2.doc)).toBe(101); // seed + 100 offline notes
    expect(noteCount(b.doc)).toBe(101);
    a2.close();
    b.close();
  }, 60_000);
});
