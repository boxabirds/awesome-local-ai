import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  abortAllDurableObjects,
  env,
  runInDurableObject,
} from 'cloudflare:test';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot as snapshotDoc,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { createdBoardId } from './helpers/room';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { TestClient } from './helpers/ws-client';
import { applyRandomOp, createRng } from './helpers/random-ops';

async function syncedPair(): Promise<[TestClient, TestClient]> {
  const boardId = await createdBoardId();
  const a = await TestClient.connect(boardId);
  const b = await TestClient.connect(boardId);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  a.clearLog();
  b.clearLog();
  return [a, b];
}

// Read the room's own document directly from its Durable Object.
function roomSnapshot(boardId: string): Promise<readonly StickySnapshot[]> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub as never, (room: unknown) =>
    snapshotDoc((room as { doc: Y.Doc }).doc),
  ) as Promise<readonly StickySnapshot[]>;
}

describe('BoardRoom sync, merge and errors (TC-07 to TC-12, TC-14 to TC-18, TC-31)', () => {
  it('TC-07 relays a create: B matches A and received exactly one update', async () => {
    const [a, b] = await syncedPair();
    const id = createSticky(a.doc, { x: 10, y: 20 }, 'blue');
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    expect(b.updateCount).toBe(1);
    expect(b.snapshot().some((n) => n.id === id)).toBe(true);
    a.close();
    b.close();
  });

  describe('TC-08 relay of each mutation with no echo to the author', () => {
    async function one(op: (id: string, c: TestClient) => void) {
      const [a, b] = await syncedPair();
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await expect.poll(() => b.snapshot().length).toBe(1);
      a.clearLog();
      b.clearLog();
      op(id, a);
      await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
      // The author must never receive its own update back.
      expect(a.updateCount).toBe(0);
      a.close();
      b.close();
    }

    it('move', () => one((id, a) => void moveObject(a.doc, id, 300, 400)));
    it('recolour', () => one((id, a) => void setStickyColor(a.doc, id, 'green')));
    it('text insert', () =>
      one((id, a) => void getStickyText(a.doc, id)!.insert(0, 'typed')));
    it('delete', () => one((id, a) => void deleteObject(a.doc, id)));
  });

  it('TC-09 merges concurrent text inserts on both clients', async () => {
    const [a, b] = await syncedPair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)!.insert(0, 'green');
    await expect.poll(() => getStickyText(b.doc, id)?.toString()).toBe('green');

    // Both edit against the shared 'green' base with neither seeing the other,
    // then their updates are pushed through the room together.
    const uA = a.makeLocalEdit((d) => void getStickyText(d, id)!.insert(0, 'red '));
    const uB = b.makeLocalEdit((d) => void getStickyText(d, id)!.insert(5, ' blue'));
    a.injectUpdate(uA);
    b.injectUpdate(uB);

    await expect.poll(() => getStickyText(a.doc, id)?.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)?.toString()).toBe('red green blue');
    a.close();
    b.close();
  });

  it('TC-10 converges concurrent map sets to one value on both', async () => {
    const [a, b] = await syncedPair();
    const id = createSticky(a.doc, { x: 1, y: 1 });
    await expect.poll(() => b.snapshot().length).toBe(1);

    const uA = a.makeLocalEdit((d) => void moveObject(d, id, 100, 0));
    const uB = b.makeLocalEdit((d) => void moveObject(d, id, 300, 0));
    a.injectUpdate(uA);
    b.injectUpdate(uB);

    await expect
      .poll(() => {
        const sa = a.snapshot().find((n) => n.id === id);
        const sb = b.snapshot().find((n) => n.id === id);
        if (!sa || !sb || sa.x !== sb.x) return null;
        return sa.x;
      })
      .not.toBeNull();
    const xa = a.snapshot().find((n) => n.id === id)!.x;
    expect([100, 300]).toContain(xa);
    a.close();
    b.close();
  });

  it('TC-11 delete wins over a concurrent insert; the note never reappears', async () => {
    const [a, b] = await syncedPair();
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await expect.poll(() => b.snapshot().length).toBe(1);

    const uDel = a.makeLocalEdit((d) => void deleteObject(d, id));
    const uIns = b.makeLocalEdit((d) => void getStickyText(d, id)!.insert(0, 'z'));
    a.injectUpdate(uDel);
    b.injectUpdate(uIns);

    await expect.poll(() => a.snapshot().some((n) => n.id === id)).toBe(false);
    await expect.poll(() => b.snapshot().some((n) => n.id === id)).toBe(false);
    // B's inserted character lives nowhere reachable, on either client.
    expect(getStickyText(a.doc, id)).toBeUndefined();
    expect(getStickyText(b.doc, id)).toBeUndefined();
    a.close();
    b.close();
  });

  it('TC-12 converges many clients doing 200 seeded random ops', async () => {
    const seed = 0x1a2b3c; // logged so a failure is reproducible
    console.log(`TC-12 random-ops seed = ${seed}`);
    const boardId = await createdBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await TestClient.connect(boardId));
    }
    await Promise.all(clients.map((c) => c.waitForSync()));

    // One shared op sequence, distributed round-robin across the clients so the
    // room must merge edits originating from every editor.
    const rng = createRng(seed);
    for (let i = 0; i < 200; i++) {
      applyRandomOp(clients[i % MAX_CONCURRENT_EDITORS]!.doc, rng);
    }

    const expected = clients[0]!;
    await expect
      .poll(
        () =>
          clients.every((c) => JSON.stringify(c.snapshot()) === JSON.stringify(expected.snapshot())),
        { timeout: 20_000 },
      )
      .toBe(true);
    for (const c of clients) c.close();
  });

  it('TC-14 a late joiner converges to the live board', async () => {
    const boardId = await createdBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i * 30, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: 0, y: i * 30 });
    await expect.poll(() => a.snapshot().length).toBe(20);
    await expect.poll(() => b.snapshot().length).toBe(20);

    const c = await TestClient.connect(boardId);
    await c.waitForSync();
    await expect.poll(() => c.snapshot()).toEqual(a.snapshot());
    a.close();
    b.close();
    c.close();
  });

  describe('TC-15 malformed frames close only the sender', () => {
    const cases: [string, (c: TestClient) => void][] = [
      ['text frame', (c) => c.sendTextFrame('hello world')],
      ['truncated bytes', (c) => c.send(new Uint8Array([MESSAGE_SYNC]))],
      ['unknown message type', (c) => c.send(new Uint8Array([9]))],
      [
        'invalid Yjs update',
        (c) => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.writeUpdate(enc, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f]));
          c.send(encoding.toUint8Array(enc));
        },
      ],
    ];

    for (const [name, send] of cases) {
      it(name, async () => {
        const boardId = await createdBoardId();
        const a = await TestClient.connect(boardId);
        const b = await TestClient.connect(boardId);
        await Promise.all([a.waitForSync(), b.waitForSync()]);
        // Seed the room with real content so we can show it does not change.
        createSticky(a.doc, { x: 5, y: 5 });
        await expect.poll(() => b.snapshot().length).toBe(1);
        const before = b.snapshot();

        send(a);
        await expect.poll(() => a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

        // The victim stays connected and the room's document is unchanged.
        expect(b.closeCode).toBeNull();
        expect(b.snapshot()).toEqual(before);

        // A third editor still works with B, proving the room kept running.
        const d = await TestClient.connect(boardId);
        await d.waitForSync();
        createSticky(b.doc, { x: 9, y: 9 });
        await expect.poll(() => d.snapshot().length).toBe(2);
        a.close();
        b.close();
        d.close();
      });
    }
  });

  it('TC-16 relays awareness bytes verbatim to sender and peer alike', async () => {
    const [a, b] = await syncedPair();
    a.setAwareness('present', true);
    await expect.poll(() => b.awarenessReceived.length).toBeGreaterThan(0);
    await expect.poll(() => a.awarenessReceived.length).toBeGreaterThan(0);
    const fromA = a.awarenessReceived[a.awarenessReceived.length - 1]!;
    const fromB = b.awarenessReceived[b.awarenessReceived.length - 1]!;
    // Byte-for-byte identical, including the copy A gets back of its own update.
    expect(Array.from(fromA)).toEqual(Array.from(fromB));
    a.close();
    b.close();
  });

  it('TC-18 a restarted room repopulates from the first client to reconnect', async () => {
    const boardId = await createdBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);
    for (let i = 0; i < 3; i++) createSticky(a.doc, { x: i, y: 0 });
    await expect.poll(() => b.snapshot().length).toBe(3);

    // Crash the room: tear the object down (in-memory document is lost) and drop
    // every socket. Then A reconnects first against a fresh, empty room.
    await abortAllDurableObjects();
    await a.reconnect();
    await a.waitForSync();
    await expect.poll(() => roomSnapshot(boardId)).toEqual(a.snapshot());

    await b.reconnect();
    await b.waitForSync();
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    a.close();
    b.close();
  });

  it('TC-31 a dead socket does not stop the room from serving later sockets', async () => {
    const boardId = await createdBoardId();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    await Promise.all([a.waitForSync(), b.waitForSync()]);

    // B goes away abruptly, then A keeps editing. The room must not blow up.
    b.close(1006);
    createSticky(a.doc, { x: 0, y: 0 });
    await expect.poll(() => a.snapshot().length).toBe(1);

    // A socket opened afterwards still receives A's changes.
    const d = await TestClient.connect(boardId);
    await d.waitForSync();
    await expect.poll(() => d.snapshot().length).toBe(1);
    createSticky(a.doc, { x: 50, y: 50 });
    await expect.poll(() => d.snapshot().length).toBe(2);
    a.close();
    d.close();
  });
});
