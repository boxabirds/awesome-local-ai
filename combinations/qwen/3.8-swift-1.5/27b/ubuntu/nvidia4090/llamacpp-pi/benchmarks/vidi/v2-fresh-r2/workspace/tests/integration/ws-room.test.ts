import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { RoomClient, createBoardViaWorker } from './helpers/ws-client';
import { applyRandomOps } from './helpers/random-ops';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  initDoc,
} from '../../src/shared/board-model';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** Poll until `cond()` is true or the timeout elapses. */
async function poll(cond: () => boolean, timeoutMs = 10_000, intervalMs = 15): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

const snapStr = (doc: Y.Doc): string => JSON.stringify(snapshot(doc));

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function twoClients(boardId: string): Promise<[RoomClient, RoomClient]> {
  const a = new RoomClient(boardId);
  await a.connect();
  await a.waitForSync();
  const b = new RoomClient(boardId);
  await b.connect();
  await b.waitForSync();
  return [a, b];
}

function closeAll(...clients: RoomClient[]): void {
  for (const c of clients) c.close();
}

/**
 * BoardRoom live relay: real Durable Object + real WebSockets + real Yjs,
 * driven in-process in workerd via the Cloudflare workers pool.
 */
describe('BoardRoom live relay (integration)', () => {
  it('TC-07: a note created by A appears on B; B received exactly one update', async () => {
    const [a, b] = await twoClients(await createBoardViaWorker());
    createSticky(a.doc, { x: 100, y: 100 });
    await poll(() => snapshot(b.doc).length === snapshot(a.doc).length);
    expect(snapStr(b.doc)).toBe(snapStr(a.doc));
    expect(b.updatesReceived).toBe(1);
    closeAll(a, b);
  }, 30_000);

  describe('TC-08: single operations propagate with no echo to the sender', () => {
    async function opPropagates(mutate: (doc: Y.Doc, id: string) => void): Promise<void> {
      const [a, b] = await twoClients(await createBoardViaWorker());
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await poll(() => snapshot(b.doc).some((n) => n.id === id));
      mutate(a.doc, id);
      await poll(() => snapStr(b.doc) === snapStr(a.doc));
      expect(snapStr(b.doc)).toBe(snapStr(a.doc));
      // The sender gets no echo of its own update.
      await new Promise((r) => setTimeout(r, 60));
      expect(a.updatesReceived).toBe(0);
      closeAll(a, b);
    }

    it('move', async () => {
      await opPropagates((doc, id) => moveObject(doc, id, 123, 456));
    }, 30_000);

    it('recolour', async () => {
      await opPropagates((doc, id) => setStickyColor(doc, id, 'pink'));
    }, 30_000);

    it('text insert', async () => {
      await opPropagates((doc, id) => getStickyText(doc, id)?.insert(0, 'hello'));
    }, 30_000);

    it('delete', async () => {
      const [a, b] = await twoClients(await createBoardViaWorker());
      const id = createSticky(a.doc, { x: 0, y: 0 });
      await poll(() => snapshot(b.doc).some((n) => n.id === id));
      deleteObject(a.doc, id);
      await poll(() => !snapshot(b.doc).some((n) => n.id === id));
      expect(snapshot(b.doc)).toHaveLength(0);
      closeAll(a, b);
    }, 30_000);
  });

  it("TC-09: concurrent text inserts merge to 'red green blue' on both", async () => {
    const [a, b] = await twoClients(await createBoardViaWorker());
    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)?.insert(0, 'green');
    await poll(() => getStickyText(b.doc, id)?.toString() === 'green');

    // Concurrent, before any exchange: A prefixes, B suffixes.
    getStickyText(a.doc, id)?.insert(0, 'red ');
    const tb = getStickyText(b.doc, id);
    tb?.insert(tb.length, ' blue');

    await poll(
      () =>
        getStickyText(a.doc, id)?.toString() === 'red green blue' &&
        getStickyText(b.doc, id)?.toString() === 'red green blue',
    );
    closeAll(a, b);
  }, 30_000);

  it('TC-10: concurrent moves converge to an identical x on both', async () => {
    const [a, b] = await twoClients(await createBoardViaWorker());
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await poll(() => snapshot(b.doc).some((n) => n.id === id));

    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await poll(() => snapStr(a.doc) === snapStr(b.doc));
    const xa = snapshot(a.doc).find((n) => n.id === id)?.x;
    const xb = snapshot(b.doc).find((n) => n.id === id)?.x;
    expect(xa).toBe(xb);
    closeAll(a, b);
  }, 30_000);

  it("TC-11: delete wins over concurrent text insert; B's text is nowhere", async () => {
    const [a, b] = await twoClients(await createBoardViaWorker());
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await poll(() => snapshot(b.doc).some((n) => n.id === id));

    getStickyText(b.doc, id)?.insert(0, 'orphaned text');
    deleteObject(a.doc, id);

    await poll(
      () =>
        !snapshot(a.doc).some((n) => n.id === id) && !snapshot(b.doc).some((n) => n.id === id),
    );
    for (const n of snapshot(b.doc)) {
      expect(n.text).not.toContain('orphaned text');
    }
    closeAll(a, b);
  }, 30_000);

  it(`TC-12: ${MAX_CONCURRENT_EDITORS} clients x 200 seeded random ops converge`, async () => {
    const boardId = await createBoardViaWorker();
    const seed = 0xc0ffee;
    console.log(`TC-12 seed: ${seed}`);
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const c = new RoomClient(boardId);
      await c.connect();
      await c.waitForSync();
      clients.push(c);
    }
    for (let i = 0; i < clients.length; i++) {
      await applyRandomOps(clients[i].doc, 200, seed + i);
    }
    // Poll until all clients converge to the same state. The reference state
    // is re-read each iteration because clients may still be receiving
    // broadcasts when the ops loop completes (persistence adds latency).
    await poll(() => {
      const first = snapStr(clients[0].doc);
      return clients.every((c) => snapStr(c.doc) === first);
    }, 30_000);
    const finalSnap = snapStr(clients[0].doc);
    expect(clients.every((c) => snapStr(c.doc) === finalSnap)).toBe(true);
    closeAll(...clients);
  }, 120_000);

  it(`TC-13: ${MAX_CONCURRENT_EDITORS + 1} sockets all upgrade; the last joiner's note reaches all`, async () => {
    const boardId = await createBoardViaWorker();
    const clients: RoomClient[] = [];
    for (let i = 0; i <= MAX_CONCURRENT_EDITORS; i++) {
      const c = new RoomClient(boardId);
      await c.connect();
      await c.waitForSync();
      clients.push(c);
    }
    expect(clients).toHaveLength(MAX_CONCURRENT_EDITORS + 1);
    const last = clients[clients.length - 1];
    const id = createSticky(last.doc, { x: 9, y: 9 });
    await poll(() => clients.slice(0, -1).every((c) => snapshot(c.doc).some((n) => n.id === id)));
    closeAll(...clients);
  }, 60_000);

  it('TC-14: late joiner C converges to the 20 notes created by A and B', async () => {
    const boardId = await createBoardViaWorker();
    const [a, b] = await twoClients(boardId);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i, y: 100 });
    await poll(() => snapStr(a.doc) === snapStr(b.doc) && snapshot(a.doc).length === 20);

    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitForSync();
    expect(snapStr(c.doc)).toBe(snapStr(a.doc));
    expect(snapshot(c.doc)).toHaveLength(20);
    closeAll(a, b, c);
  }, 30_000);

  it('TC-15: malformed traffic closes only the sender (1003); B keeps receiving', async () => {
    const boardId = await createBoardViaWorker();
    const [b] = await twoClients(boardId);

    let sender: RoomClient;
    const malformedFrames: Array<() => void> = [
      // 1. Text frame.
      () => sender.sendRaw('this is a string frame'),
      // 2. Truncated bytes (type 0, subtype 0, varuint8Array len 4 but 2 bytes).
      () => sender.sendRaw(new Uint8Array([0, 0, 4, 1, 2]).buffer as ArrayBuffer),
      // 3. Unknown message type (9).
      () => sender.sendRaw(new Uint8Array([9, 1, 2]).buffer as ArrayBuffer),
      // 4. Invalid Yjs update (submessage 2 with garbage).
      () => {
        const sub = encoding.createEncoder();
        encoding.writeVarUint(sub, 2);
        encoding.writeVarUint8Array(sub, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
        sender.sendSyncSubmessage(encoding.toUint8Array(sub));
      },
    ];

    for (const makeFrame of malformedFrames) {
      sender = new RoomClient(boardId);
      await sender.connect();
      await sender.waitForSync();
      makeFrame();
      const info = await sender.waitForClose();
      expect(info.code).toBe(CLOSE_UNSUPPORTED_DATA);
      // B is still open throughout.
      expect(b.connected).toBe(true);
    }

    // The room is still healthy: a fresh client's note reaches B.
    const a = new RoomClient(boardId);
    await a.connect();
    await a.waitForSync();
    const id = createSticky(a.doc, { x: 1, y: 1 });
    await poll(() => snapshot(b.doc).some((n) => n.id === id));
    closeAll(a, b);
  }, 60_000);

  it('TC-16: awareness bytes from A are received identically by A and B', async () => {
    const [a, b] = await twoClients(await createBoardViaWorker());
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    a.sendAwareness(payload);
    await poll(() => a.awarenessCount >= 1 && b.awarenessCount >= 1);
    expect(bytesEqual(a.lastAwareness(), payload)).toBe(true);
    expect(bytesEqual(b.lastAwareness(), payload)).toBe(true);
    closeAll(a, b);
  }, 30_000);

  it('TC-17: rooms are isolated; a note in room1 never reaches room2', async () => {
    const room1 = await createBoardViaWorker();
    const room2 = await createBoardViaWorker();
    const a = new RoomClient(room1);
    await a.connect();
    await a.waitForSync();
    const b = new RoomClient(room2);
    await b.connect();
    await b.waitForSync();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 120));

    expect(snapshot(a.doc).some((n) => n.id === id)).toBe(true);
    expect(snapshot(b.doc)).toHaveLength(0);
    closeAll(a, b);
  }, 30_000);

  it('TC-18: after a restart the first reconnector repopulates; B converges', async () => {
    // Build content on one board.
    const boardX = await createBoardViaWorker();
    const a = new RoomClient(boardX);
    await a.connect();
    await a.waitForSync();
    createSticky(a.doc, { x: 1, y: 1 });
    createSticky(a.doc, { x: 2, y: 2 });
    const content = snapStr(a.doc);
    a.close();

    // Fresh room (new board => new DO instance). A reconnects first, carrying
    // its content; the empty room must adopt it.
    const boardY = await createBoardViaWorker();
    const a2 = new RoomClient(boardY);
    Y.applyUpdate(a2.doc, Y.encodeStateAsUpdate(a.doc));
    await a2.connect();
    await a2.waitForSync();
    expect(snapStr(a2.doc)).toBe(content);

    const b = new RoomClient(boardY);
    await b.connect();
    await b.waitForSync();
    expect(snapStr(b.doc)).toBe(content);
    closeAll(a2, b);
  }, 30_000);

  it('TC-14b: state persists after all clients leave; new client sees converged state', async () => {
    const boardId = await createBoardViaWorker();
    const [a, b] = await twoClients(boardId);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: 0 });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: i, y: 100 });
    await poll(() => snapStr(a.doc) === snapStr(b.doc) && snapshot(a.doc).length === 20);
    const converged = snapStr(a.doc);

    // All clients leave.
    closeAll(a, b);
    await new Promise((r) => setTimeout(r, 100));

    // A new client connects and sees the full converged state.
    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitForSync();
    expect(snapStr(c.doc)).toBe(converged);
    expect(snapshot(c.doc)).toHaveLength(20);
    c.close();
  }, 30_000);

  it('TC-15b: 2000-note board persists; new client loads full state and ops persist', async () => {
    const { generateLargeBoard } = await import('../fixtures/boards');
    const doc = new Y.Doc();
    initDoc(doc);
    generateLargeBoard(doc);
    const noteCount = snapshot(doc).length;
    expect(noteCount).toBe(2000);

    const boardId = await createBoardViaWorker();
    const a = new RoomClient(boardId);
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(doc));
    await a.connect();
    await a.waitForSync();
    expect(snapshot(a.doc)).toHaveLength(2000);

    // All clients leave.
    a.close();
    await new Promise((r) => setTimeout(r, 100));

    // A new client connects and sees all 2000 notes.
    const b = new RoomClient(boardId);
    await b.connect();
    await b.waitForSync();
    expect(snapshot(b.doc)).toHaveLength(2000);

    // A new op persists.
    const id = createSticky(b.doc, { x: 999, y: 999 });
    b.close();
    await new Promise((r) => setTimeout(r, 100));

    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitForSync();
    expect(snapshot(c.doc)).toHaveLength(2001);
    expect(snapshot(c.doc).some((n) => n.id === id)).toBe(true);
    c.close();
  }, 60_000);

  it('TC-18b: awareness is relayed but NOT persisted across reload', async () => {
    const boardId = await createBoardViaWorker();
    const [a, b] = await twoClients(boardId);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    a.sendAwareness(payload);
    await poll(() => b.awarenessCount >= 1);
    expect(bytesEqual(b.lastAwareness(), payload)).toBe(true);

    // All clients leave.
    closeAll(a, b);
    await new Promise((r) => setTimeout(r, 100));

    // A new client connects: awareness should NOT come back.
    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitForSync();
    await new Promise((r) => setTimeout(r, 200));
    expect(c.awarenessCount).toBe(0);
    c.close();
  }, 30_000);

  it('TC-26: restart persistence — updates from before "restart" are present', async () => {
    const boardId = await createBoardViaWorker();
    const a = new RoomClient(boardId);
    await a.connect();
    await a.waitForSync();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(createSticky(a.doc, { x: i, y: i }));
    }
    await poll(() => snapshot(a.doc).length === 5);
    const beforeClose = snapStr(a.doc);
    a.close();
    await new Promise((r) => setTimeout(r, 100));

    // Simulate "restart": a new client connects to the same board.
    const b = new RoomClient(boardId);
    await b.connect();
    await b.waitForSync();
    expect(snapStr(b.doc)).toBe(beforeClose);
    expect(snapshot(b.doc)).toHaveLength(5);
    for (const id of ids) {
      expect(snapshot(b.doc).some((n) => n.id === id)).toBe(true);
    }
    b.close();
  }, 30_000);

  it('TC-31: an abruptly closed socket does not break the room; later sockets receive', async () => {
    const boardId = await createBoardViaWorker();
    const a = new RoomClient(boardId);
    await a.connect();
    await a.waitForSync();
    const b = new RoomClient(boardId);
    await b.connect();
    await b.waitForSync();

    // Close B's socket; the room must drop it and keep serving the others.
    b.close();
    await new Promise((r) => setTimeout(r, 80));

    // A still works and a later joiner receives A's new note.
    const id = createSticky(a.doc, { x: 5, y: 5 });
    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitForSync();
    await poll(() => snapshot(c.doc).some((n) => n.id === id));
    closeAll(a, c);
  }, 30_000);
});
