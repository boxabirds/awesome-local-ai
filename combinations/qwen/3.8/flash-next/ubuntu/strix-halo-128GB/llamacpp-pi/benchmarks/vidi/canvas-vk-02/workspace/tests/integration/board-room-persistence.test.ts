/**
 * tests/integration/board-room-persistence.test.ts
 *
 * The room with storage behind it: a change that is broadcast is a change that
 * was written first, a board comes back after the object holding it went away,
 * and the two ways a board can fail to be there — its bytes cannot be read, or
 * storage will not answer — are told apart on the wire, by 4500 and 1011.
 *
 * Everything here is the real thing: real sockets through the real worker, a real
 * `Y.Doc` on each side, and the SQLite database of a real Durable Object. What is
 * not real is the failure, because storage cannot be asked to break on demand:
 * the tests wrap the room's own `BoardStore`, or the storage underneath it, and
 * let real SQLite run underneath the throw.
 *
 * One thing this runtime will not do is carry a frame through a socket that was
 * hibernated by an eviction — neither client to room nor room to client. The
 * hibernation case below therefore tests what the room is responsible for (it
 * keeps no per-socket state in memory, so a rebuilt room still knows whom to
 * serve, with what), and the recovery cases run through a real reconnection,
 * which is what a browser actually does.
 */
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { snapshot } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  awarenessMessage,
  frameMessage,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import type { BoardRoom } from '../../src/worker/board-room';
import { BoardStore } from '../../src/worker/board-store';
import { unreadableBytes } from '../fixtures/boards';
import { RoomClient, awarenessUpdateOf, connectRoom, readAwarenessUpdate } from './helpers/client';
import { countRows, uniqueBoardId, withSql, withStore } from './helpers/store';

/** A socket as the hibernation API hands it back: state included, lazily. */
interface HibernatableSocket {
  deserializeAttachment(): unknown;
}

/** What only a test may see: the room's own state. */
interface RoomInternals {
  board: BoardStore;
  document: Y.Doc;
  lifecycle: string;
  loadFailedAt: number;
  keepAliveTimer: ReturnType<typeof setInterval> | null;
  ctx: { getWebSockets(): HibernatableSocket[] };
}

function internals(room: BoardRoom): RoomInternals {
  return room as unknown as RoomInternals;
}

/** Work inside the room object, with the storage it owns. */
function withRoom<T>(board: string, body: (room: BoardRoom, storage: DurableObjectStorage) => T): Promise<T> {
  return runInDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board)), (room, state) =>
    body(room, state.storage),
  );
}

const stub = (board: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board));

/**
 * The next `attempts` writes this room makes throw, and the writes after that go
 * through to SQLite as always. Wrapping the instance rather than the class keeps
 * the transaction, the chunking and the storage exactly as production uses them.
 */
function failNextAppends(board: string, attempts = 1): Promise<void> {
  return withRoom(board, (room) => {
    const store = internals(room).board;
    const append = store.append.bind(store);
    let left = attempts;
    store.append = (update: Uint8Array) => {
      if (left > 0) {
        left -= 1;
        throw new Error('injected storage failure');
      }
      append(update);
    };
  });
}

/**
 * A board whose snapshot cannot be read, with its log as it was: the rows a
 * compaction writes, holding bytes no decoder accepts. `updates` still has every
 * change the board ever took, which is why refusing to open the board is the
 * only honest answer — see `BoardStore.load`.
 */
function damageSnapshot(board: string): Promise<void> {
  return withSql(board, (sql) => {
    const through = sql.exec<{ total: number }>('SELECT COALESCE(MAX(seq), 0) AS total FROM updates').one().total;
    sql.exec('DELETE FROM snapshot_chunks');
    sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', 0, unreadableBytes(64).slice().buffer);
    setMeta(sql, 'snapshot_through_seq', String(through));
  });
}

/** Undo it: with no snapshot, the log is a whole board again. */
function dropSnapshot(board: string): Promise<void> {
  return withSql(board, (sql) => {
    sql.exec('DELETE FROM snapshot_chunks');
    setMeta(sql, 'snapshot_through_seq', '0');
  });
}

function setMeta(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/** What this board's storage would give a document loaded into it. */
function loadFromStorage(board: string): Promise<{ ok: boolean; notes: ReturnType<typeof snapshot> }> {
  return withStore(board, ({ store }) => {
    const doc = new Y.Doc();
    const result = store.load(doc);
    return result.ok ? { ok: true, notes: snapshot(doc) } : { ok: false, notes: [] };
  });
}

/** The board as one comparable value, order and all. */
const boardOf = (notes: ReturnType<typeof snapshot>): string =>
  JSON.stringify([...notes].sort((left, right) => left.id.localeCompare(right.id)));

/**
 * Put a board of `count` notes on disk and say what it holds.
 *
 * The author seeds them offline, so they arrive with the handshake; a second
 * client then sees the board, which — the room storing before it broadcasts —
 * means storage has them. Closing both afterwards is what lets the object go:
 * an idle board is read again from disk, which is most of what follows.
 */
async function boardOnDisk(board: string, count: number): Promise<string> {
  const author = RoomClient.prepared(board);
  for (let index = 0; index < count; index++) author.seedNote(`note ${String(index + 1)}`);
  await author.open();

  const witness = await connectRoom(board);
  await witness.waitFor(() => (witness.count === count ? true : undefined));
  const original = boardOf(witness.notes);

  await witness.close();
  await author.close();
  return original;
}

/** The presence one client has been told about another, if it has been yet. */
function presenceOf(client: RoomClient, other: RoomClient): unknown {
  for (const frame of client.received) {
    const update = awarenessUpdateOf(frame);
    if (update === null) continue;
    for (const [clientId, state] of readAwarenessUpdate(update)) {
      if (clientId === other.clientId) return state;
    }
  }
  return undefined;
}

/** What a socket's attachment looked like to the room: string, object, or nothing. */
function attachmentOf(socket: HibernatableSocket): { awareness: string | null; lastWriteAt: number } {
  const raw = socket.deserializeAttachment();
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const fields = (value ?? {}) as { awareness?: unknown; lastWriteAt?: unknown };
  return {
    awareness: typeof fields.awareness === 'string' ? fields.awareness : null,
    lastWriteAt: typeof fields.lastWriteAt === 'number' ? fields.lastWriteAt : 0,
  };
}

/** Connect and report how the room ended it. */
async function closedWith(board: string): Promise<number> {
  const client = RoomClient.prepared(board);
  await client.open().catch(() => undefined);
  return (await client.untilClosed()).code;
}

describe('a change is stored before it is broadcast (persist.save_failure)', () => {
  it('TC-12: by the time another client sees a change, storage holds it', async () => {
    const id = uniqueBoardId('room12');
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    const note = a.seedNote('stored first, then shown');
    await b.waitFor(() => b.text(note));

    // B has it, so the row is there. Read backwards, this is the order that
    // makes a change nobody can lose: nothing is ever presented as shared that
    // is not already written.
    expect(await withSql(id, (sql) => countRows(sql, 'updates'))).toBeGreaterThanOrEqual(2);

    const stored = await loadFromStorage(id);
    expect(stored.ok).toBe(true);
    expect(stored.notes.find((entry) => entry.id === note)?.text).toBe('stored first, then shown');
  });

  it('TC-17: a change that is not a Yjs update is closed and not stored', async () => {
    const id = uniqueBoardId('room17');
    const a = await connectRoom(id);
    const witness = await connectRoom(id);
    const note = a.seedNote('a real change, first');
    await witness.waitFor(() => witness.text(note));

    // The baseline: with the witness holding the change, the rows for everything
    // up to it are in, so any row after this is the rubbish's.
    const before = await withSql(id, (sql) => countRows(sql, 'updates'));

    // A sync *update* frame whose body is not a Yjs update: the frame is legal,
    // its contents are not.
    a.send(frameMessage(MESSAGE_SYNC, new Uint8Array([2, ...unreadableBytes(48)])));

    expect((await a.untilClosed()).code).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await withSql(id, (sql) => countRows(sql, 'updates'))).toBe(before);

    // The board itself is unaffected: the rubbish was one socket's, not the
    // room's.
    const later = witness.seedNote('after the rubbish');
    const joiner = await connectRoom(id);
    await joiner.waitFor(() => joiner.text(later));
    expect(joiner.count).toBe(2);
  });

  it('TC-17b: presence the room cannot read costs its sender its socket, and not the room its composure', async () => {
    const id = uniqueBoardId('room17b');
    const broken = await connectRoom(id);
    const careful = await connectRoom(id);

    // A body that is the right shape for a presence message and nonsense inside:
    // the length prefix is honest, so `awarenessUpdateOf` hands it over, and the
    // room has to read what it remembers — the removal a disconnect announces is
    // built from the update that socket last sent. Reading is where it fails.
    //
    // This is the expensive kind of rubbish, not the cheap kind TC-17 covers.
    // An uncaught error anywhere in a Durable Object handler abandons the events
    // the room has already been handed, so accepting these bytes meant one client
    // could stop other people's edits from ever being stored, with their sockets
    // open and their badges green.
    broken.send(frameMessage(MESSAGE_AWARENESS, awarenessMessage(unreadableBytes(64))));
    expect((await broken.untilClosed()).code).toBe(CLOSE_UNSUPPORTED_DATA);

    // Nothing was remembered, because nothing here could be read back.
    const remembered = await withRoom(id, (room) =>
      internals(room).ctx.getWebSockets().map((socket) => attachmentOf(socket).awareness),
    );
    expect(remembered).toEqual([null]);

    // The disconnect is the other half, and the half that actually broke: the
    // room reads the remembered presence when a socket goes away. Poisoned the
    // way an accepted rubbish frame would have left it, that read must not be
    // allowed to abandon the rest of the handler — which is where the document is
    // released and an idle board stops costing anything.
    await withRoom(id, (room) => {
      for (const socket of internals(room).ctx.getWebSockets()) {
        socket.serializeAttachment({
          awareness: String.fromCharCode(...unreadableBytes(32)),
          lastWriteAt: 1,
        });
      }
    });
    await careful.close();

    expect(await withRoom(id, (room) => internals(room).lifecycle)).toBe('hibernated');
    expect(await withRoom(id, (room) => internals(room).document === null)).toBe(true);

    // And the room is still a room.
    const keeper = await connectRoom(id);
    const note = keeper.seedNote('after the rubbish');
    const joiner = await connectRoom(id);
    await joiner.waitFor(() => joiner.text(note));
    expect(joiner.count).toBe(1);
    await keeper.close();
    await joiner.close();
  });
});

describe('the board comes back (persist.reload)', () => {
  it('TC-13: a new room instance over the same storage serves the same board', async () => {
    const id = uniqueBoardId('room13');
    const original = await boardOnDisk(id, 25);

    // The object holding it is gone: everybody left, which is when the document
    // is dropped, and then the object itself is evicted.
    await evictDurableObject(stub(id), { webSockets: 'close' });

    const joiner = await connectRoom(id);
    await joiner.waitFor(() => (joiner.count === 25 ? true : undefined));
    expect(boardOf(joiner.notes)).toBe(original);

    // Reading the same storage into a bare document agrees with the room.
    expect(boardOf((await loadFromStorage(id)).notes)).toBe(original);
  });

  it('TC-18: a rebuilt room addresses the sockets it accepted, from the socket', async () => {
    // Hibernation means the object may be replaced while its connections stay
    // open, so a room that kept its clients in memory would come back knowing
    // nobody. This one keeps nothing there: `ctx.getWebSockets()` says who is
    // connected, and each socket carries what the room needed to remember about
    // it — the presence it is announcing, and when it last heard from us.
    const id = uniqueBoardId('room18');
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const note = a.seedNote('here before the rebuild');
    await b.waitFor(() => b.text(note));
    a.sendAwareness({ name: 'Ada', color: '#f00' }, 7);
    await b.waitFor(() => presenceOf(b, a));

    // The timers die with the instance they belong to; evicting with them still
    // running is not a thing that happens to a hibernated object.
    await withRoom(id, (room) => {
      const timer = internals(room).keepAliveTimer;
      if (timer !== null) clearInterval(timer);
      internals(room).keepAliveTimer = null;
    });
    await evictDurableObject(stub(id), { webSockets: 'hibernate' });

    const rebuilt = await withRoom(id, (room) => ({
      sockets: internals(room).ctx.getWebSockets().map(attachmentOf),
      lifecycle: internals(room).lifecycle,
      notes: snapshot(internals(room).document).map((entry) => entry.text),
    }));

    // Both connections are still there for the rebuilt room to write to, and
    // the presence it was holding for one of them is still on that socket —
    // including in the shape a woken socket hands it back in, which is why
    // `attachmentOf` accepts a string, an object, or nothing at all.
    expect(rebuilt.sockets).toHaveLength(2);
    expect(rebuilt.sockets.filter((attachment) => attachment.awareness !== null)).toHaveLength(1);
    expect(rebuilt.sockets.every((attachment) => attachment.lastWriteAt > 0)).toBe(true);
    // The board is not in memory any more: it came off disk, whole.
    expect(rebuilt.lifecycle).toBe('ready');
    expect(rebuilt.notes).toEqual(['here before the rebuild']);

    // And a client that arrives at the rebuilt room is served from it.
    const joiner = await connectRoom(id);
    await joiner.waitFor(() => joiner.text(note));
    expect(joiner.text(note)).toBe('here before the rebuild');
  });
});

describe('storage that will not answer (persist.save_failure)', () => {
  it('TC-14: a change that cannot be stored is not broadcast, and is not lost', async () => {
    const id = uniqueBoardId('room14');
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    const settled = a.seedNote('the board before the failure');
    await b.waitFor(() => b.text(settled));

    await failNextAppends(id);

    const note = a.seedNote('the change that could not be saved');

    // Both are closed with the code a browser reconnects to, and B never saw the
    // change: an edit that is not saved is never shown as a shared one.
    expect((await a.untilClosed()).code).toBe(CLOSE_STORAGE_FAILURE);
    expect((await b.untilClosed()).code).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.text(note)).toBeUndefined();

    const after = await loadFromStorage(id);
    expect(after.notes.find((entry) => entry.id === note)).toBeUndefined();
    expect(after.notes.find((entry) => entry.id === settled)?.text).toBe('the board before the failure');

    // A reconnects still holding what it could not save. The room reads storage
    // again, the change arrives with the handshake, and this time it goes in —
    // and only then out.
    await a.open();
    const back = await connectRoom(id);
    await back.waitFor(() => back.text(note));
    expect(back.text(note)).toBe('the change that could not be saved');
    expect((await loadFromStorage(id)).notes.find((entry) => entry.id === note)?.text).toBe(
      'the change that could not be saved',
    );
  });

  it('TC-26: a board whose rows cannot be read is refused, not served empty', async () => {
    const id = uniqueBoardId('room26');
    const original = await boardOnDisk(id, 3);

    // A read failure, injected underneath real SQLite: the SELECT the load makes
    // throws after running.
    await withRoom(id, (room, storage) => {
      const failing = {
        sql: {
          exec(query: string, ...bindings: SqlStorageValue[]) {
            const cursor = storage.sql.exec(query, ...bindings);
            if (query.includes('FROM updates')) throw new Error('injected read failure');
            return cursor;
          },
        },
        transactionSync: (callback: () => unknown) => storage.transactionSync(callback),
      } as unknown as DurableObjectStorage;
      internals(room).board = new BoardStore(failing);
    });

    // A client holding changes of its own is refused like anybody else: a room
    // that cannot read the board must not write to it, or those changes would be
    // filed against a board nobody can see.
    const holder = RoomClient.prepared(id);
    const held = holder.seedNote('held locally while the board would not open');
    await expect(holder.open()).rejects.toThrow(String(CLOSE_BOARD_LOAD_FAILED));
    expect(holder.closed?.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Nothing was served, and nothing of the client's was written: the board on
    // disk is exactly what it was, and the change is still the client's to keep.
    const loaded = await loadFromStorage(id);
    expect(boardOf(loaded.notes)).toBe(original);
    expect(loaded.notes.some((entry) => entry.id === held)).toBe(false);
    expect(holder.text(held)).toBe('held locally while the board would not open');
  });
});

describe('a board that cannot be opened (persist.load_failure)', () => {
  it('TC-15: a damaged snapshot closes the connection with 4500 and stores nothing', async () => {
    const id = uniqueBoardId('room15');
    const original = await boardOnDisk(id, 25);
    const rows = await withSql(id, (sql) => countRows(sql, 'updates'));

    await damageSnapshot(id);

    const refused = RoomClient.prepared(id);
    const note = refused.seedNote('made while the board would not open');
    await expect(refused.open()).rejects.toThrow(String(CLOSE_BOARD_LOAD_FAILED));
    expect(refused.closed?.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Not one row was written against a board the room could not read...
    expect(await withSql(id, (sql) => countRows(sql, 'updates'))).toBe(rows);
    // ...and the board is still unopenable, rather than quietly a different one.
    expect((await loadFromStorage(id)).ok).toBe(false);

    // The client keeps its own work: it is the board that is broken, not the
    // person's changes. And the board it could not open is still the board it
    // was — 25 notes, not an empty one.
    expect(refused.text(note)).toBe('made while the board would not open');
    expect(JSON.parse(original)).toHaveLength(25);
  });

  it('TC-16: a failed board is left alone for LOAD_RETRY_MIN_INTERVAL_MS, then opens', async () => {
    const id = uniqueBoardId('room16');
    const original = await boardOnDisk(id, 25);

    await damageSnapshot(id);
    expect(await closedWith(id)).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repaired: with the unreadable snapshot gone, the log is a whole board.
    await dropSnapshot(id);

    // Still inside the interval, so the room does not read storage again and the
    // answer is the same refusal — one broken board is one attempt, not a loop.
    expect(await closedWith(id)).toBe(CLOSE_BOARD_LOAD_FAILED);
    const failedAt = await withRoom(id, (room) => internals(room).loadFailedAt);
    expect(Date.now() - failedAt).toBeLessThan(LOAD_RETRY_MIN_INTERVAL_MS);

    // Past the interval, the very same connection is served the board.
    await withRoom(id, (room) => {
      internals(room).loadFailedAt = Date.now() - LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const joiner = await connectRoom(id);
    await joiner.waitFor(() => (joiner.count === 25 ? true : undefined));
    expect(boardOf(joiner.notes)).toBe(original);
  });
});
