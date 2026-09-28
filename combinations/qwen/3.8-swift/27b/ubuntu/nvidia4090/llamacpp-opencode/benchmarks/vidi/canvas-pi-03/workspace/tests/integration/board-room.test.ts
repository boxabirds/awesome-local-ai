/**
 * BoardRoom integration tests (sync.board_room), exercising the real room logic
 * through real WebSockets + real Yjs in workerd. Each test asserts both the
 * happy path and its error paths.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MAX_CONCURRENT_EDITORS } from 'src/shared/config';
import { newBoardId } from 'src/shared/board-id';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  getStickyColor,
} from 'src/shared/board-model';
import { connectRoomClient, settleBoards, type RoomClient } from './helpers/ws-client';
import { randomOps } from './helpers/random-ops';

// Local workerd's DO isolate overflows at ~11 live BoardRoom objects; evict
// idle boards between tests so the live count stays under the limit.
afterEach(async () => {
  await settleBoards();
});

async function pair(boardId = newBoardId()): Promise<[RoomClient, RoomClient]> {
  const a = await connectRoomClient(boardId);
  const b = await connectRoomClient(boardId);
  await a.waitForSync();
  await b.waitForSync();
  return [a, b];
}

function textOf(c: RoomClient, id: string): string {
  return getStickyText(c.doc, id)?.toString() ?? '';
}

const sameNotes = (a: RoomClient, b: RoomClient): boolean =>
  JSON.stringify([...a.snapshot()].sort((x, y) => x.id.localeCompare(y.id))) ===
  JSON.stringify([...b.snapshot()].sort((x, y) => x.id.localeCompare(y.id)));

/** Deterministic key over a client's notes (id-sorted). */
const sortedKey = (c: RoomClient): string =>
  JSON.stringify([...c.snapshot()].sort((x, y) => x.id.localeCompare(y.id)));

// Local workerd evicts an idle Durable Object after ~10 s of inactivity
// (miniflare). Waiting just past that guarantees the reconnect rebuilds the
// room from storage, proving persistence rather than in-memory retention.
const EVICTION_WAIT_MS = 11_000;

describe('sync.board_room', () => {
  it('TC-07: create propagates to the second client (exactly one update)', async () => {
    const [a, b] = await pair();
    // Baseline: the handshake already delivered the room's initial state to b.
    // Assert the create adds exactly one further remote update (no dup / no self-echo).
    const bRemoteBefore = b.remoteUpdates;
    createSticky(a.doc, { x: 1, y: 2 });
    await b.waitFor(() => b.snapshot().length === 1);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.remoteUpdates).toBe(bRemoteBefore + 1);
    await a.close();    await b.close();  });

  it('TC-08a: move propagates; no self-echo on A', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    await b.waitFor(() => b.snapshot().length === 1);
    const aRemoteBefore = a.remoteUpdates;
    moveObject(a.doc, nid, 42, 7);
    await b.waitFor(() => b.snapshot()[0]?.x === 42 && b.snapshot()[0]?.y === 7);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.remoteUpdates).toBe(aRemoteBefore);
    await a.close();    await b.close();  });

  it('TC-08b: colour change propagates; no self-echo on A', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    await b.waitFor(() => b.snapshot().length === 1);
    const aRemoteBefore = a.remoteUpdates;
    setStickyColor(a.doc, nid, 'blue');
    await b.waitFor(() => getStickyColor(b.doc, nid) === 'blue');
    expect(getStickyColor(a.doc, nid)).toBe('blue');
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.remoteUpdates).toBe(aRemoteBefore);
    await a.close();    await b.close();  });

  it('TC-08c: text insert propagates; no self-echo on A', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    getStickyText(a.doc, nid)!.insert(0, 'hello');
    await b.waitFor(() => textOf(b, nid) === 'hello');
    const aRemoteBefore = a.remoteUpdates;
    getStickyText(a.doc, nid)!.insert(5, ' world');
    await b.waitFor(() => textOf(b, nid) === 'hello world');
    expect(textOf(a, nid)).toBe('hello world');
    expect(a.remoteUpdates).toBe(aRemoteBefore);
    await a.close();    await b.close();  });

  it('TC-08d: delete propagates; no self-echo on A', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    await b.waitFor(() => b.snapshot().length === 1);
    const aRemoteBefore = a.remoteUpdates;
    deleteObject(a.doc, nid);
    await b.waitFor(() => b.snapshot().length === 0);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.remoteUpdates).toBe(aRemoteBefore);
    await a.close();    await b.close();  });

  it('TC-09: concurrent text edits merge to the same string on both', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    getStickyText(a.doc, nid)!.insert(0, 'green');
    await b.waitFor(() => textOf(b, nid) === 'green');

    a.holding = true;
    b.holding = true;
    getStickyText(a.doc, nid)!.insert(0, 'red ');
    getStickyText(b.doc, nid)!.insert(5, ' blue');
    a.flushHeld();
    b.flushHeld();

    await a.waitFor(() => textOf(a, nid) === 'red green blue');
    await b.waitFor(() => textOf(b, nid) === 'red green blue');
    expect(textOf(a, nid)).toBe(textOf(b, nid));
    await a.close();    await b.close();  });

  it('TC-10: concurrent position sets converge to the identical x on both', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 5 })!;
    await b.waitFor(() => b.snapshot().length === 1);

    a.holding = true;
    b.holding = true;
    moveObject(a.doc, nid, 100, 5);
    moveObject(b.doc, nid, 300, 5);
    a.flushHeld();
    b.flushHeld();

    await a.waitFor(() => a.remoteUpdates >= 1 && b.remoteUpdates >= 1);
    await new Promise((r) => setTimeout(r, 100));
    const ax = a.snapshot().find((s) => s.id === nid)?.x;
    const bx = b.snapshot().find((s) => s.id === nid)?.x;
    expect(ax).toBe(bx);
    await a.close();    await b.close();  });

  it('TC-11: delete concurrent with a text insert → note absent on both, no throw', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 0, y: 0 })!;
    getStickyText(a.doc, nid)!.insert(0, 'hello');
    await b.waitFor(() => textOf(b, nid) === 'hello');

    a.holding = true;
    b.holding = true;
    deleteObject(a.doc, nid);
    getStickyText(b.doc, nid)!.insert(0, 'X');
    a.flushHeld();
    b.flushHeld();

    await a.waitFor(() => !a.snapshot().some((s) => s.id === nid) && b.snapshot().length === 0);
    expect(a.snapshot().some((s) => s.id === nid)).toBe(false);
    expect(b.snapshot().some((s) => s.id === nid)).toBe(false);
    await a.close();    await b.close();  });

  it('TC-12: MAX clients x 200 seeded random ops converge to identical snapshots', async () => {
    const room = newBoardId();
    const seed = 20240311;
    const clients: RoomClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) clients.push(await connectRoomClient(room));
    for (const c of clients) await c.waitForSync();

    for (const c of clients) randomOps(c.doc, seed, 200);

    const key = (c: RoomClient) => JSON.stringify(c.snapshot().map((s) => ({ ...s })));
    await clients[0].waitFor(
      () => clients.every((c) => key(c) === key(clients[0])),
      { timeout: 30000 },
    );
    for (const c of clients) expect(key(c)).toBe(key(clients[0]));
    console.log(`[TC-12] seed=${seed} ops=200 clients=${MAX_CONCURRENT_EDITORS} converged`);
    for (const c of clients) await c.close();
  }, 90000);

  it('TC-14: late joiner receives full state from scratch', async () => {
    const room = newBoardId();
    const [a, b] = await pair(room);
    for (let i = 0; i < 20; i++) createSticky(a.doc, { x: i, y: 0 });
    await b.waitFor(() => b.snapshot().length === 20);

    const c = await connectRoomClient(room);
    await c.waitForSync();
    await c.waitFor(() => c.snapshot().length === 20);
    expect(sameNotes(c, a)).toBe(true);
    await a.close();
    await b.close();
    await c.close();
  }, 20000);

  it('TC-15: malformed traffic → A closed with 1003, B unaffected, room doc unchanged', async () => {
    const [a, b] = await pair();
    const nid = createSticky(a.doc, { x: 1, y: 1 })!;
    await b.waitFor(() => b.snapshot().length === 1);

    // A text (string) frame is undecodable as binary → CLOSE_UNSUPPORTED_DATA.
    a.sendRaw('hello text frame');
    await a.waitFor(() => a.closeCode === 1003, { timeout: 5000 });
    expect(a.closeCode).toBe(1003);

    // B is still open and the room doc is unchanged.
    expect(b.isConnected()).toBe(true);
    expect(b.snapshot().some((s) => s.id === nid)).toBe(true);
    await b.close();  });

  it('TC-16: awareness bytes are relayed verbatim to both peers', async () => {
    const [a, b] = await pair();
    const awarenessBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    a.sendAwareness(awarenessBytes);
    await b.waitFor(() => b.received.some((m) => m.type === 'awareness'));
    const bGot = b.received.find((m) => m.type === 'awareness')!.data;
    // The relayed frame is [MESSAGE_AWARENESS][varUint(awarenessBytes.length)][awarenessBytes]
    // (y-websocket length-prefixes awareness payloads), relayed byte-for-byte.
    expect(bGot[0]).toBe(1); // MESSAGE_AWARENESS
    expect(Array.from(bGot.slice(2))).toEqual(Array.from(awarenessBytes));
    await a.close();    await b.close();  });

  it('TC-18: restart → board reloads from storage with all notes intact', async () => {
    const boardId = newBoardId();
    const [a, b] = await pair(boardId);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: i });
    await b.waitFor(() => b.snapshot().length === 10);
    const before = sortedKey(a);

    // Everyone leaves; the idle room is evicted and its in-memory doc discarded.
    await a.close();    await b.close();    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));

    // Reconnect: the room is rebuilt from storage and serves the same notes.
    const a2 = await connectRoomClient(boardId);
    await a2.waitForSync();
    await a2.waitFor(() => a2.snapshot().length === 10, { timeout: 10000 });
    expect(sortedKey(a2)).toBe(before);
    await a2.close();  }, 45000);

  it('TC-31: abruptly closed peer does not break the room; later sockets receive', async () => {
    const room = newBoardId();
    const [a, b] = await pair(room);

    b.ws.close();
    await new Promise((r) => setTimeout(r, 30));

    createSticky(a.doc, { x: 9, y: 9 });
    await a.waitFor(() => a.snapshot().length === 1);

    const c = await connectRoomClient(room);
    await c.waitForSync();
    await c.waitFor(() => c.snapshot().length === 1);
    // c must see the exact same note a created (stored top-left, not centre).
    expect(c.snapshot()).toEqual(a.snapshot());
    await a.close();    await c.close();  });
});
