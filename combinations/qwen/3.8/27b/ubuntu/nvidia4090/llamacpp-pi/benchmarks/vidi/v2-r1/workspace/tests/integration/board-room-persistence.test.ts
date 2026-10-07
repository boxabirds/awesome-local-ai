// Story 4, task 5: integration tests for the persistent BoardRoom
// (TC-12 to TC-18, TC-26) — durability, load/storage failure, hibernation
// path and the SQL read error path, with real Durable Object sockets and SQLite.

import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { BoardStore } from '../../src/worker/board-store';
import { createRetroBoard } from '../fixtures/boards';
import { createWsClient, type WsClient } from './ws-client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(cond: () => boolean, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
}

function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`timed out after ${ms}ms`); }),
  ]);
}

function boardStub(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Call a DO test hook directly (the same internal path the worker route
 * rewrites to; the route itself is gated on env.TEST_HOOKS). */
async function testHook(
  boardId: string,
  op: string,
  body?: Uint8Array,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const res = await boardStub(boardId).fetch(
    new Request(`http://internal/__test/${op}`, { method: 'POST', body: body ?? undefined }),
  );
  let json: Record<string, unknown> | null = null;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response
  }
  return { status: res.status, json };
}

/** Rows in the board's update log. */
async function updateRows(boardId: string): Promise<number> {
  return runInDurableObject(boardStub(boardId), (_instance, state) => {
    const r = state.storage.sql.exec<{ n: number | null }>('SELECT COUNT(*) AS n FROM updates').next();
    return r.done ? 0 : r.value.n ?? 0;
  });
}

/** Load the persisted state into a throwaway doc via a fresh BoardStore. */
async function loadFromStore(boardId: string): Promise<readonly StickySnapshot[]> {
  return runInDurableObject(boardStub(boardId), (_instance, state) => {
    const store = new BoardStore(state.storage);
    store.migrate();
    const doc = new Y.Doc();
    const res = store.load(doc);
    if (!res.ok) throw new Error(`store load failed: ${res.reason}`);
    return snapshot(doc);
  });
}

/** The 25-note retro board as a single state update (seed hook payload). */
function retroBoardUpdate(seed = 7): Uint8Array {
  const doc = new Y.Doc();
  createRetroBoard(doc, seed);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** A valid single-note update (for frames that would change the board). */
function singleNoteUpdate(): Uint8Array {
  const doc = new Y.Doc();
  createSticky(doc, { x: 1, y: 2 }, 'blue');
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** Encode one y-protocols sync frame (SyncStep2 / Update with `update`). */
function syncFrame(subType: number, update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, subType);
  encoding.writeVarUint8Array(enc, update);
  return encoding.toUint8Array(enc);
}

/** Seed a board through the hooks until it has a (corruptable) snapshot. */
async function seedAndCompact(boardId: string, seed = 7): Promise<void> {
  const seeded = await testHook(boardId, 'seed', retroBoardUpdate(seed));
  expect(seeded.status).toBe(200);
  const compacted = await testHook(boardId, 'compact');
  expect(compacted.status).toBe(200);
  expect(compacted.json?.['compacted']).toBe(true);
}

async function makeBrokenBoard(boardId: string, seed = 7): Promise<void> {
  await seedAndCompact(boardId, seed);
  const corrupted = await testHook(boardId, 'corrupt-snapshot');
  expect(corrupted.status).toBe(200);
  const reloaded = await testHook(boardId, 'reload');
  expect(reloaded.json?.['state']).toBe('load-failed');
}

describe('BoardRoom persistence (persist.room)', () => {
  it('TC-12: A creates a note; by the time B observes it the updates row exists; storage load contains it', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const noteId = createSticky(a.doc, { x: 100, y: 100 }, 'yellow');
    expect(noteId).not.toBeNull();

    await pollUntil(() => b.snapshot().count === 1);

    // Store-before-broadcast: B only observed the note after it was durably
    // appended, so the row already exists.
    expect(await updateRows(boardId)).toBeGreaterThanOrEqual(1);

    const stored = await loadFromStore(boardId);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(noteId);
    expect(stored[0].color).toBe('yellow');

    a.close();
    b.close();
  });

  it('TC-13: all clients leave; a new client on a reloaded room over the same storage sees the original snapshot', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    await a.waitForSync();

    const colors = ['yellow', 'blue', 'green', 'pink', 'violet'] as const;
    for (let i = 0; i < 5; i += 1) createSticky(a.doc, { x: i * 260, y: 0 }, colors[i]);
    await pollUntil(() => a.snapshot().count === 5);

    a.close();
    await sleep(200);
    const original = await loadFromStore(boardId);
    expect(original).toHaveLength(5);

    // Deterministic reconstruction: discard the in-memory doc and reload from
    // the same storage (the hibernation wake does the same).
    const reloaded = await testHook(boardId, 'reload');
    expect(reloaded.json?.['state']).toBe('ready');

    const a2 = await createWsClient(boardId);
    await a2.waitForSync();
    await pollUntil(() => a2.snapshot().count === 5);

    const reopened = a2.snapshot().notes
      .map((n) => ({ id: n.id, x: n.x, y: n.y, color: n.color, text: n.text }))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    const expected = original
      .map((n) => ({ id: n.id, x: n.x, y: n.y, color: n.color, text: n.text }))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(reopened).toEqual(expected);

    a2.close();
  });

  it('TC-14: append throws once → A and B closed 1011, B never received it; A reconnects holding the change → stored and delivered', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Wrap store.append: the first call throws without storing; later calls pass through.
    await runInDurableObject(boardStub(boardId), (instance, _state) => {
      const store = instance.store;
      const original = store.append.bind(store);
      let calls = 0;
      store.append = (update: Uint8Array) => {
        calls += 1;
        if (calls === 1) throw new Error('injected storage failure');
        return original(update);
      };
    });

    const noteId = createSticky(a.doc, { x: 50, y: 50 }, 'green');
    expect(noteId).not.toBeNull();

    const [aClose, bClose] = await Promise.all([
      withTimeout(a.closed),
      withTimeout(b.closed),
    ]);
    expect(aClose.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(bClose.code).toBe(CLOSE_STORAGE_FAILURE);
    // B never received the update (it was never stored, so never broadcast).
    expect(b.receivedUpdates.length).toBe(0);
    expect(b.snapshot().count).toBe(0);
    expect(await updateRows(boardId)).toBe(0);

    // A reconnects still holding the change; the story 3 handshake re-sends it.
    const a2 = await createWsClient(boardId, a.doc);
    const b2 = await createWsClient(boardId);
    await a2.waitForSync();
    await b2.waitForSync();

    await pollUntil(() => b2.snapshot().count === 1);
    expect(b2.snapshot().notes[0].id).toBe(noteId);

    // It is now durable.
    expect(await updateRows(boardId)).toBeGreaterThanOrEqual(1);
    const stored = await loadFromStore(boardId);
    expect(stored.map((n) => n.id)).toContain(noteId);

    a2.close();
    b2.close();
  });

  it('TC-15: corrupt snapshot → client closed 4500; a SyncStep2 sent before the close stores nothing', async () => {
    const boardId = newBoardId();
    await makeBrokenBoard(boardId);

    const c = await createWsClient(boardId);
    // The client sends a SyncStep2 with a real note update right away, before
    // it processes the close. (If the close wins the race the frame is simply
    // dropped; either way nothing may be stored.)
    try {
      c.ws.send(syncFrame(sync.messageYjsSyncStep2, singleNoteUpdate()));
    } catch {
      // socket already closed: the frame was not delivered
    }

    const close = await withTimeout(c.closed);
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // The board's log was empty after compaction; nothing was stored.
    expect(await updateRows(boardId)).toBe(0);
  });

  it('TC-16: connect before LOAD_RETRY_MIN_INTERVAL_MS → 4500 without reload; after the interval → loads and syncs', async () => {
    const boardId = newBoardId();
    await seedAndCompact(boardId);
    const corrupted = await testHook(boardId, 'corrupt-snapshot');
    expect(corrupted.status).toBe(200);

    const t0 = Date.now();
    const reloaded = await testHook(boardId, 'reload');
    expect(reloaded.json?.['state']).toBe('load-failed');

    // Within the retry interval: 4500, and no new load attempt (the interval
    // is still measured from t0 — proven by the successful connect below).
    const c1 = await createWsClient(boardId);
    const c1Close = await withTimeout(c1.closed);
    expect(c1Close.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the storage.
    const repair = await testHook(boardId, 'repair');
    expect(repair.status).toBe(200);

    // Wait until well past the retry interval since the failed load at t0.
    // (If the first connect had triggered a reload of its own, its attempt
    // timestamp would be ~0.3 s later and this connect would still be inside
    // the interval and fail — so success proves the connect did not reload.)
    await sleep(Math.max(0, LOAD_RETRY_MIN_INTERVAL_MS + 1500 - (Date.now() - t0)));

    const c2 = await createWsClient(boardId);
    await c2.waitForSync();
    await pollUntil(() => c2.snapshot().count === 25, 8000);

    c2.close();
  }, 30000);

  it('TC-17: garbage update → closed 1003, row count unchanged', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Valid lib0 framing, Yjs-invalid update: a varuint with a continuation
    // bit and no following byte.
    a.ws.send(syncFrame(sync.messageYjsUpdate, new Uint8Array([0x80])));

    const close = await withTimeout(a.closed);
    expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await updateRows(boardId)).toBe(0);

    // B is unaffected and the board still works.
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    createSticky(b.doc, { x: 300, y: 300 }, 'pink');
    await pollUntil(() => b.snapshot().count === 1);

    b.close();
  });

  it('TC-18: after the room is reloaded, updates from earlier accepted sockets are stored and delivered to them via getWebSockets()', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const noteId = createSticky(a.doc, { x: 10, y: 10 }, 'yellow');
    if (noteId === null) throw new Error('note creation failed');
    await pollUntil(() => b.snapshot().count === 1);

    // Reconstruct the room's in-memory state from storage.
    const reloaded = await testHook(boardId, 'reload');
    expect(reloaded.json?.['state']).toBe('ready');

    // A (socket accepted before the reload) moves the note; B (also accepted
    // before the reload) must receive it.
    moveObject(a.doc, noteId, 500, 600);
    await pollUntil(() => {
      const note = b.snapshot().notes.find((n) => n.id === noteId);
      return note !== undefined && note.x === 500 && note.y === 600;
    });

    expect(await updateRows(boardId)).toBeGreaterThanOrEqual(2);

    a.close();
    b.close();
  });

  it('TC-26: the SELECT in load throws → the room closes clients with 4500', async () => {
    const boardId = newBoardId();

    // Story 5: a load only reaches the log-read SELECT for a board that has
    // tables, so create this one first (the API's initialize RPC).
    await runInDurableObject(boardStub(boardId), (instance) => {
      return instance.initialize();
    });

    // Make the log-read SELECT inside store.load throw; load() maps that to
    // { ok: false, reason: 'sql-error' } and the room goes load-failed.
    await runInDurableObject(boardStub(boardId), (instance, _state) => {
      const store = instance.store as unknown as {
        readLogRows(throughSeq: number): unknown;
      };
      store.readLogRows = () => {
        throw new Error('injected SELECT failure');
      };
    });

    // Re-run the load with the injected fault (the constructor's load already
    // ran, before the injection).
    const reloaded = await testHook(boardId, 'reload');
    expect(reloaded.json?.['state']).toBe('load-failed');

    const c = await createWsClient(boardId);
    const close = await withTimeout(c.closed);
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await updateRows(boardId)).toBe(0);
  });
});
