import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';
import {
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  CLOSE_BOARD_LOAD_FAILED,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  connectClient,
  connectClientWithDoc,
  connectRawClient,
  noteCount,
  updateFrame,
} from './ws-client';
import { buildNoteBoard } from '../fixtures/note-updates';
import type { BoardRoom } from '../../src/worker/board-room';

/**
 * Story 4, `persist.room`: the BoardRoom's write-before-broadcast, wake and
 * failure paths (integration tests TC-12..TC-18, TC-26).
 *
 * Hibernation is simulated with `BoardRoom.resetForTest()`: it discards the
 * in-memory doc and awareness, moves the state machine to `hibernated`, and
 * keeps the platform-accepted sockets — exactly the state a wake
 * (fetch or webSocketMessage) must recover from by reloading from storage.
 * The production platform reconstructs real hibernated objects itself;
 * TC-19 (e2e) covers a real process restart.
 *
 * Storage-failure injection (TC-14, TC-26) wraps `BoardStore` methods inside
 * the DO — real disk failures cannot be produced on demand (design: "Mock
 * vs real boundaries"). TC-14's wrapper throws once and restores itself,
 * matching the spec ("stub store.append to throw once").
 *
 * Persistence assertions are content-based: a fresh doc loaded from the
 * store must contain exactly what the board showed. Update-row counts are
 * timing-dependent (Yjs coalesces handshake and edit traffic), so row
 * counts are only asserted where the traffic is fully deterministic (an
 * empty log stays empty).
 */

type ClosedInfo = { code: number; reason: string };

const room = (boardId: string) =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

const onRoom = <T>(boardId: string, fn: (r: BoardRoom) => T): Promise<T> =>
  runInDurableObject(room(boardId), (r) => fn(r as BoardRoom));

const hibernate = (boardId: string): Promise<void> =>
  onRoom(boardId, (r) => {
    r.resetForTest();
    return undefined;
  });

const logCount = (boardId: string): Promise<number> =>
  onRoom(boardId, (r) => r.storeForTest.logStats().count);

/** Poll until the updates log holds at least n rows. */
async function awaitLogCount(boardId: string, n: number, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const c = await logCount(boardId);
    if (c >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Note count in a fresh doc loaded from storage; null when the load fails. */
async function freshNotes(boardId: string): Promise<number | null> {
  return onRoom(boardId, (r) => {
    const doc = new Y.Doc();
    const res = r.storeForTest.load(doc);
    return res.ok ? doc.getMap('objects').size : null;
  });
}

/** Poll until a fresh doc loaded from storage contains at least n notes. */
async function awaitFreshNotes(boardId: string, n: number, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const c = await freshNotes(boardId);
    if (c !== null && c >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Break the board's snapshot (TC-10's failure mode) and hibernate the room,
 * so the next connection wakes into a failed load. Returns the original
 * chunk-0 bytes for repair.
 */
async function makeLoadFailed(boardId: string): Promise<Uint8Array> {
  const original = await onRoom(boardId, (r) => {
    r.compactForTest();
    const rows = r.storageForTest.sql
      .exec('SELECT data FROM snapshot_chunks WHERE idx = 0')
      .toArray();
    if (rows.length === 0) throw new Error('no snapshot chunk 0 found');
    const chunk = new Uint8Array(rows[0].data as ArrayBuffer);
    r.storageForTest.sql.exec(
      'UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0',
      new Uint8Array(64).fill(0xff),
    );
    r.resetForTest();
    return chunk;
  });
  return original;
}

const setChunk0 = (boardId: string, data: Uint8Array): Promise<void> =>
  onRoom(boardId, (r) => {
    r.storageForTest.sql.exec(
      'UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0',
      data,
    );
    return undefined;
  });

/** Stub `store.append` to throw exactly once, then restore itself (TC-14). */
const injectOneShotAppendFailure = (boardId: string): Promise<void> =>
  onRoom(boardId, (r) => {
    const store = r.storeForTest;
    const original = store.append.bind(store);
    let thrown = false;
    store.append = (update: Uint8Array): void => {
      if (!thrown) {
        thrown = true;
        store.append = original; // self-restore for the resync
        throw new Error('injected append failure');
      }
      original(update);
    };
    return undefined;
  });

/** Make `store.load` throw (a failing SELECT) — TC-26. */
const injectLoadFailure = (boardId: string): Promise<void> =>
  onRoom(boardId, (r) => {
    // A throwing arrow has return type `never`, assignable to any result.
    r.storeForTest.load = () => {
      throw new Error('injected SELECT failure');
    };
    return undefined;
  });

describe('persist.room', () => {
  it('TC-12 an update is stored before it is broadcast', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'green');
    await b.waitForNote(id);
    // B observed the note, so its row is already in storage.
    expect(await logCount(boardId)).toBeGreaterThanOrEqual(1);
    const fresh = await onRoom(boardId, (r) => {
      const doc = new Y.Doc();
      const res = r.storeForTest.load(doc);
      return { ok: res.ok, has: doc.getMap('objects').get(id) instanceof Y.Map };
    });
    expect(fresh).toEqual({ ok: true, has: true });
    a.close();
    b.close();
  }, 30_000);

  it('TC-13 the stored updates reconstruct the board after hibernation', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 25);
    const a = await connectClientWithDoc(boardId, fixture.doc);
    await a.waitForSync();
    // Storage holds all 25 notes before the room is hibernated.
    await awaitFreshNotes(boardId, 25, 'all 25 notes in storage');
    a.close();
    await hibernate(boardId);

    const c = await connectClient(boardId);
    await c.waitForSync();
    expect(noteCount(c.doc)).toBe(25);
    expect([...snapshot(c.doc)]).toEqual([...snapshot(fixture.doc)]);
    c.close();
  }, 30_000);

  it('TC-14 a failed append is not broadcast; the resynced client catches up', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    // The next append fails (a storage write error) and recovers.
    await injectOneShotAppendFailure(boardId);
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'green');
    // The failed update is not broadcast: B never sees the note...
    await expect(b.waitForNote(id, 1500)).rejects.toThrow();
    // ...and the room closes everyone with 1011 (never 4500).
    const aClosed = (await a.closed) as ClosedInfo;
    const bClosed = (await b.closed) as ClosedInfo;
    expect(aClosed.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(bClosed.code).toBe(CLOSE_STORAGE_FAILURE);
    // A reconnects still holding the change; the room reloads (the change
    // is not in storage yet), A resends it through the sync handshake, the
    // append now succeeds, and B (re)connects and receives it.
    const a2 = await connectClientWithDoc(boardId, a.doc);
    await a2.waitForSync();
    await awaitFreshNotes(boardId, 1, 'the resynced note in storage');
    const b2 = await connectClient(boardId);
    await b2.waitForNote(id);
    expect(noteCount(b2.doc)).toBe(1);
    a2.close();
    b2.close();
  }, 30_000);

  it('TC-15 a refused SyncStep2 (4500) is not stored', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 25);
    const a = await connectClientWithDoc(boardId, fixture.doc);
    await a.waitForSync();
    await awaitFreshNotes(boardId, 25, 'all 25 notes in storage');
    // Empty the log (compact), then break the snapshot and hibernate.
    expect(await onRoom(boardId, (r) => r.compactForTest())).toBe(true);
    a.close();
    await makeLoadFailed(boardId);
    // A connection wakes the room; the load fails; 4500.
    const c = await connectClient(boardId);
    expect((await c.closed).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    // A raw client pushes a note to the load-failed room (before or after
    // its close arrives): it must never be stored.
    const d = await connectRawClient(boardId);
    const dDoc = new Y.Doc();
    initDoc(dDoc);
    let last: Uint8Array | undefined;
    const cap = (u: Uint8Array): void => {
      last = u;
    };
    dDoc.on('update', cap);
    createSticky(dDoc, { x: 9, y: 9 }, 'yellow');
    dDoc.off('update', cap);
    if (last === undefined) throw new Error('no update captured');
    d.sendRaw(updateFrame(last));
    await new Promise((r) => setTimeout(r, 400));
    // The log is still empty: the update was refused, not stored.
    expect(await logCount(boardId)).toBe(0);
    d.close();
  }, 30_000);

  it('TC-16 no retry before the interval; after repair and the interval, loads and syncs', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    createSticky(a.doc, { x: 0, y: 0 }, 'green');
    await awaitFreshNotes(boardId, 1, 'the note in storage');
    expect(await onRoom(boardId, (r) => r.compactForTest())).toBe(true);
    a.close();
    const original = await makeLoadFailed(boardId);
    // First connection: wakes the room, the load fails, 4500.
    const c1 = await connectClient(boardId);
    expect((await c1.closed).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Repair the storage...
    await setChunk0(boardId, original);
    // ...but the retry interval has not elapsed: still 4500, and no reload
    // was attempted (a load would now succeed, so a ready room would have
    // synced this client with the note).
    const c2 = await connectClient(boardId);
    expect((await c2.closed).code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(noteCount(c2.doc)).toBe(0);
    // After the interval the next connection retries, loads and syncs.
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 500));
    const c3 = await connectClient(boardId);
    await c3.waitForSync();
    expect(noteCount(c3.doc)).toBe(1);
    c3.close();
  }, 30_000);

  it('TC-17 garbage update bytes are dropped, never stored', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    // Let the handshake's meta-append settle: it is the only legitimate row,
    // so the count before the garbage frame is a stable baseline.
    await awaitLogCount(boardId, 1, 'the handshake meta row');
    const before = await logCount(boardId);
    // A well-formed sync frame whose update bytes are not a valid Yjs
    // update: the room refuses it (1003) and stores nothing.
    a.sendRaw(updateFrame(new Uint8Array(32).fill(0xff)));
    const closed = (await a.closed) as ClosedInfo;
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await logCount(boardId)).toBe(before);
    // The room is still healthy: a second client syncs fine.
    const b = await connectClient(boardId);
    await b.waitForSync();
    b.close();
  }, 30_000);

  it('TC-18 a message on a pre-accepted socket survives a wake', async () => {
    const boardId = newBoardId();
    const fixture = buildNoteBoard(boardId, 25);
    const a = await connectClientWithDoc(boardId, fixture.doc);
    await a.waitForSync();
    await awaitFreshNotes(boardId, 25, 'all 25 notes in storage');
    const b = await connectClient(boardId);
    await b.waitForSync();
    // Hibernate the room; both sockets remain platform-accepted.
    await hibernate(boardId);
    // A edit now: the message wakes the room, which reloads from storage,
    // stores the update and broadcasts it to B (accepted before the
    // reconstruct).
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'green');
    await b.waitForNote(id);
    await awaitFreshNotes(boardId, 26, 'the 26th note in storage');
    a.close();
    b.close();
  }, 30_000);

  it('TC-26 a failing SELECT (load) yields 4500, never 1011', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    await a.waitForSync();
    createSticky(a.doc, { x: 0, y: 0 }, 'green');
    await awaitFreshNotes(boardId, 1, 'the note in storage');
    a.close();
    // Make the store's load (its SELECTs) fail, then hibernate so the next
    // connection wakes into a fresh load.
    await injectLoadFailure(boardId);
    await hibernate(boardId);
    const c = await connectClient(boardId);
    const info = (await c.closed) as ClosedInfo;
    // An unreadable board is a load failure (4500), not a storage failure
    // (1011): 1011 is reserved for a write failing on a healthy room.
    expect(info.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(info.code).not.toBe(CLOSE_STORAGE_FAILURE);
  }, 30_000);
});
