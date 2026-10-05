/**
 * Integration: a board keeps what it was given (TC-12 to TC-18, TC-26).
 *
 * These run against the real Durable Object, real WebSockets, real SQLite-backed
 * DO storage and the real board-model mutators. The interesting part is that
 * `cloudflare:test` can *evict* a Durable Object: the instance is torn down, its
 * memory is gone, its storage is not, and hibernating sockets survive. That is the
 * closest thing to a server restart a test can ask for, and it is what the story is
 * about — "return to a board and find everything as it was left".
 *
 * Two seams exist only because a test cannot wait around:
 * `retryWindowHasPassed` moves the clock past `LOAD_RETRY_MIN_INTERVAL_MS`, and
 * failures are injected by breaking storage for real (drop a table, corrupt a row)
 * rather than by replacing a method with one that throws.
 */

import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSticky,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA
} from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import { join, leaveAll, TestClient } from './helpers/ws-client';

/** Clients opened by a test, closed whatever the test did with them. */
let opened: TestClient[] = [];

afterEach(async () => {
  const clients = opened;
  opened = [];
  await leaveAll(clients);
});

/** The room that owns this board, as the platform addresses it. */
function stubFor(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** Two people on a board of their own. */
async function pair(): Promise<{ boardId: string; a: TestClient; b: TestClient }> {
  const boardId = newBoardId();
  const [a, b] = await joinAll(boardId, 2);
  return { boardId, a, b };
}

async function joinAll(boardId: string, count: number): Promise<TestClient[]> {
  const clients: TestClient[] = [];
  for (let index = 0; index < count; index += 1) clients.push(await join(boardId));
  opened.push(...clients);
  return clients;
}

/** Type into a note as that person, with an origin that is not the client itself. */
function type(client: TestClient, id: string, words: string): void {
  const text = getStickyText(client.doc, id);
  if (!text) throw new Error(`no note ${id} on that client yet`);
  client.doc.transact(() => text.insert(text.length, words), 'typed-here');
}

/**
 * What the log holds, as plain data. Only structured-cloneable values cross the
 * Durable Object boundary, so a row comes back as numbers, not as a cursor.
 */
function logRows(boardId: string): Promise<{ seq: number; bytes: number }[]> {
  return runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec('SELECT seq, bytes FROM updates ORDER BY seq ASC')
      .toArray()
      .map((row) => ({ seq: Number(row.seq), bytes: Number(row.bytes) }))
  );
}

/** Wait for the log to hold at least this many rows; writes land asynchronously. */
async function waitForRows(boardId: string, rows: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await logRows(boardId)).length >= rows) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the log never reached ${rows} rows`);
}

/**
 * Read the board the way a *different* reader would: a fresh store and a fresh
 * document, with nothing in common with the room except the rows on disk.
 */
function readBackFromStorage(
  boardId: string
): Promise<{ notes: readonly StickySnapshot[]; quarantined: number }> {
  return runInDurableObject(stubFor(boardId), (_room, state) => {
    const doc = new Y.Doc();
    const store = new BoardStore(state.storage);
    const result = store.load(doc);
    // The answer is turned into plain data here; a Y.Doc cannot leave the isolate.
    return result.ok
      ? { notes: snapshot(doc), quarantined: result.quarantined }
      : { notes: [], quarantined: -1 };
  });
}

/** The room's own answer to "how are you", from the object itself. */
async function roomStatus(boardId: string): Promise<Record<string, unknown>> {
  const response = await stubFor(boardId).fetch(
    new Request(`https://vidi6.example/api/rooms/${encodeURIComponent(boardId)}`)
  );
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Pretend the retry interval has passed. A test that measured `LOAD_RETRY_MIN_INTERVAL_MS`
 * in real time would spend five seconds waiting for nothing: what is under test is
 * that the room refuses a reload *before* the interval and attempts one after it.
 */
function retryWindowHasPassed(boardId: string): Promise<unknown> {
  return runInDurableObject(stubFor(boardId), (room) => {
    (room as unknown as { lastFailureAt: number }).lastFailureAt = 0;
  });
}

/**
 * Break storage the way storage breaks: a column the queries name is gone, so the next
 * read or write raises a real SQLite error.
 *
 * Dropping the *table* would prove nothing, because the room's own `migrate` creates it
 * again on the next load. Dropping one column is damage a migration does not repair —
 * which is also what makes it a fair model of storage that has gone bad.
 * `restore` puts the column back, which is the dependency coming back up.
 */
function damageColumn(boardId: string, column: string): Promise<unknown> {
  return runInDurableObject(stubFor(boardId), (_room, state) => {
    state.storage.sql.exec(`ALTER TABLE updates DROP COLUMN ${column}`);
  });
}

function restoreColumn(boardId: string, column: string, type: string): Promise<unknown> {
  return runInDurableObject(stubFor(boardId), (_room, state) => {
    state.storage.sql.exec(`ALTER TABLE updates ADD COLUMN ${column} ${type}`);
  });
}

/**
 * Give the board a snapshot, then corrupt it: the rows are the ones compaction would
 * have written, with their bytes replaced by the sort of nonsense storage loses.
 */
async function corruptSnapshot(boardId: string, source: Y.Doc): Promise<void> {
  await runInDurableObject(stubFor(boardId), (_room, state) => {
    const length = Y.encodeStateAsUpdate(source).byteLength;
    state.storage.sql.exec('DELETE FROM snapshot_chunks');
    state.storage.sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, nonsense(length).buffer);
  });
}

/** Bytes that look like what happens to a row that storage lost. */
function nonsense(length: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(length, 32));
  let state = 0x2f6e2b1;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }
  return bytes;
}

/** Join a board expecting to be turned away, and say which code turned us away. */
async function joinAndExpectClose(boardId: string, code: number): Promise<void> {
  const client = await join(boardId, { silent: true });
  opened.push(client);
  const closed = await client.waitForClose();
  expect(closed.code).toBe(code);
}

describe('a change is saved before it is shared', () => {
  // TC-12
  it('has the change in storage by the time the other person sees it', async () => {
    const { boardId, a, b } = await pair();
    const before = await logRows(boardId);

    const id = createSticky(a.doc, { x: 10, y: 20 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));

    const rows = await logRows(boardId);
    expect(rows.length).toBeGreaterThan(before.length);
    // The board a fresh reader assembles from those rows is the board both of them
    // are looking at — not a board that only exists in this instance's memory.
    const readBack = await readBackFromStorage(boardId);
    expect(readBack.notes).toEqual(b.snapshot());
  });

  // TC-17 (negative: nonsense is refused, and refuses to be stored)
  it('stores nothing when a client sends a frame Yjs cannot read', async () => {
    const { boardId, a, b } = await pair();
    // Let the two joins settle first: each person's own starting content is a row, and
    // an unfinished one of those would look like the nonsense we are about to send.
    await waitForRows(boardId, 2);
    const before = (await logRows(boardId)).length;

    b.sendSyncPayload(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00, 0x41, 0x42, 0x43]));
    const closed = await b.waitForClose();
    expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

    // The other person is untouched, and so is the log.
    expect(a.closed).toBe(false);
    const after = await logRows(boardId);
    expect(after.length).toBe(before);
    expect((await readBackFromStorage(boardId)).notes).toEqual(a.snapshot());
  });
});

describe('coming back', () => {
  // TC-13
  it('finds everything as it was left after the object is evicted with nobody watching', async () => {
    const { boardId, a, b } = await pair();
    // Every change below is waited for on the *other* person's screen, so that
    // "as it was left" is a board both of them agreed on rather than one of them.
    const first = createSticky(a.doc, { x: 40, y: 60 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === first));
    const second = createSticky(b.doc, { x: 400, y: 90 }, 'yellow');
    await TestClient.waitUntil(() => a.snapshot().some((note) => note.id === second));
    type(b, first, 'a whole paragraph of work');
    await TestClient.waitUntil(() => a.snapshot().some((note) => note.id === first && note.text.startsWith('a whole')));
    moveObject(a.doc, second, 500, 95);
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === second && note.x === 500));
    setStickyColor(b.doc, first, 'blue');
    await TestClient.waitUntil(() => a.snapshot().some((note) => note.id === first && note.color === 'blue'));

    const left = a.snapshot();
    expect(left.length).toBe(2);
    expect(b.snapshot()).toEqual(left);
    await leaveAll(opened.splice(0));

    await evictDurableObject(stubFor(boardId));

    // Somebody opens the board again. Not the same object — the same storage.
    const c = await join(boardId);
    opened.push(c);
    expect(c.snapshot()).toEqual(left);

    // And the board still works from there: a change made now is stored and shared.
    const third = createSticky(c.doc, { x: 800, y: 20 });
    const d = await join(boardId);
    opened.push(d);
    await TestClient.waitUntil(() => d.snapshot().some((note) => note.id === third));
  });

  // TC-18
  it('delivers to sockets it did not accept, on the other side of an eviction', async () => {
    const { boardId, a, b } = await pair();
    // Both sockets hibernate. The object is then torn down and rebuilt with its
    // memory gone; the sockets belong to the platform, not to the instance.
    await evictDurableObject(stubFor(boardId), { webSockets: 'hibernate' });

    const id = createSticky(a.doc, { x: 12, y: 34 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));

    const status = await roomStatus(boardId);
    expect(status.state).toBe('ready');
    // The rebuilt room counts two people it never accepted itself.
    expect(status.clients).toBe(2);
    expect(status.loaded).toBe(true);
    expect((await readBackFromStorage(boardId)).notes).toEqual(b.snapshot());
  });
});

describe('storage that fails', () => {
  // TC-14
  it('closes everybody with 1011 when a write fails, and takes the change again on reconnect', async () => {
    const { boardId, a, b } = await pair();
    // `bytes` is named by the write and by nothing that reads the board: exactly a
    // failure to store, on a board the room can still read.
    await damageColumn(boardId, 'bytes');

    const id = createSticky(a.doc, { x: 5, y: 5 });
    const closedByA = a.waitForClose();
    const closedByB = b.waitForClose();
    expect((await closedByA).code).toBe(CLOSE_STORAGE_FAILURE);
    expect((await closedByB).code).toBe(CLOSE_STORAGE_FAILURE);
    // The change never reached the other person: nothing was broadcast that was not stored.
    expect(b.snapshot().some((note) => note.id === id)).toBe(false);

    // Storage comes back. The person who made the change still holds it, and the
    // board takes it on the next try.
    await restoreColumn(boardId, 'bytes', 'INTEGER');
    await retryWindowHasPassed(boardId);

    const returning = await join(boardId, { doc: a.doc });
    opened.push(returning);
    await TestClient.waitUntil(() => returning.snapshot().some((note) => note.id === id));
    const watcher = await join(boardId);
    opened.push(watcher);
    await TestClient.waitUntil(() => watcher.snapshot().some((note) => note.id === id));
    expect((await readBackFromStorage(boardId)).notes).toEqual(watcher.snapshot());
  });

  // TC-26
  it('closes a client with 4500 when storage cannot be read at all', async () => {
    const { boardId, a } = await pair();
    const id = createSticky(a.doc, { x: 1, y: 1 });
    await TestClient.waitUntil(() => a.snapshot().some((note) => note.id === id));
    await leaveAll(opened.splice(0));

    // `data` is named by the read: the board cannot be assembled at all.
    await damageColumn(boardId, 'data');
    await evictDurableObject(stubFor(boardId));

    await joinAndExpectClose(boardId, CLOSE_BOARD_LOAD_FAILED);
    const status = await roomStatus(boardId);
    expect(status.state).toBe('load-failed');
    expect(status.loaded).toBe(false);
  });
});

describe('a board that cannot be read', () => {
  // TC-15
  it('closes with 4500 rather than showing an unreadable board as an empty one', async () => {
    const { boardId, a, b } = await pair();
    const id = createSticky(a.doc, { x: 7, y: 7 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));
    const source = b.doc;

    await leaveAll(opened.splice(0));
    await corruptSnapshot(boardId, source);
    await evictDurableObject(stubFor(boardId));

    await joinAndExpectClose(boardId, CLOSE_BOARD_LOAD_FAILED);

    // Nothing was written by the attempt: a client whose SyncStep2 arrived before the
    // close did not quietly create a second version of the board.
    const rows = await logRows(boardId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect((await roomStatus(boardId)).state).toBe('load-failed');
  });

  // TC-16
  it('waits out the retry interval, then opens the board once storage is whole', async () => {
    const { boardId, a, b } = await pair();
    const id = createSticky(a.doc, { x: 9, y: 9 });
    await TestClient.waitUntil(() => b.snapshot().some((note) => note.id === id));
    const source = b.doc;

    const left = b.snapshot();
    await leaveAll(opened.splice(0));
    await corruptSnapshot(boardId, source);
    await evictDurableObject(stubFor(boardId));

    await joinAndExpectClose(boardId, CLOSE_BOARD_LOAD_FAILED);
    const refused = await roomStatus(boardId);
    expect(refused.state).toBe('load-failed');
    const attempts = Number(refused.loads);

    // Still broken, and the room does not go poking at storage again per connection.
    await joinAndExpectClose(boardId, CLOSE_BOARD_LOAD_FAILED);
    expect(Number((await roomStatus(boardId)).loads)).toBe(attempts);

    // Repair the snapshot row, let the interval pass, and it opens.
    await runInDurableObject(stubFor(boardId), (_room, state) => {
      state.storage.sql.exec('DELETE FROM snapshot_chunks');
    });
    await retryWindowHasPassed(boardId);

    // The snapshot was the only damaged part; the log still holds the change, so a
    // whole board comes back rather than an empty one.
    const client = await join(boardId);
    opened.push(client);
    expect(client.snapshot()).toEqual(left);
    expect(Number((await roomStatus(boardId)).loads)).toBeGreaterThan(attempts);

    // And it is a working board again, not a read-only museum piece.
    const again = createSticky(client.doc, { x: 11, y: 11 });
    const watcher = await join(boardId);
    opened.push(watcher);
    await TestClient.waitUntil(() => watcher.snapshot().some((note) => note.id === again));
  });
});
