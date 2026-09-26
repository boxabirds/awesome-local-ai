import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';

import { BoardStore, type BoardStorage, type LoadResult } from '../../src/worker/board-store';
import { createSticky, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { damagedUpdate } from '../fixtures/boards';
import { bindings } from './helpers/bindings';
import { connectClient, RoomClient, waitUntil } from './helpers/ws-client';

/**
 * persist.room integration (TC-12..TC-18, TC-26): durability, failure handling
 * and hibernation in the real Durable Object, over real sockets and real SQLite.
 * Nothing here mocks storage — every assertion reads the same tables the room
 * writes, from inside the object so the writes are visible.
 */

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));
const jsonOf = (client: RoomClient): string => JSON.stringify(client.board());

function stubFor(boardId: string) {
  return bindings.BOARD_ROOM.get(bindings.BOARD_ROOM.idFromName(boardId));
}

interface BoardView {
  load: LoadResult;
  logRows: number;
  chunkRows: number;
  notes: number;
  board: string;
}

/** Load the board straight from its storage into a throwaway document. */
function readBoard(boardId: string): Promise<BoardView> {
  return runInDurableObject(stubFor(boardId), (_instance, state) => {
    const storage = state.storage as unknown as BoardStorage;
    const count = (table: string): number =>
      Number(
        (
          storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0] as { n: number }
        ).n,
      );
    const doc = new Y.Doc();
    const load = new BoardStore(storage).load(doc);
    return {
      load,
      logRows: count('updates'),
      chunkRows: count('snapshot_chunks'),
      notes: snapshot(doc).length,
      board: JSON.stringify(snapshot(doc)),
    };
  });
}

/** Run statements against the board's storage, optionally reading rows back. */
function writeBoard(
  boardId: string,
  statements: Array<{ query: string; bindings?: unknown[] }>,
  select?: string,
): Promise<Record<string, unknown>[]> {
  return runInDurableObject(stubFor(boardId), (_instance, state) => {
    const storage = state.storage as unknown as BoardStorage;
    for (const statement of statements) {
      storage.sql.exec(statement.query, ...(statement.bindings as never[] ?? []));
    }
    return select === undefined ? [] : [...storage.sql.exec(select).toArray()];
  });
}

/** An ArrayBuffer copy, because workerd detaches buffers it is given. */
function blob(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

/** Count `BoardStore.load` calls for as long as the returned handle is open. */
function countLoads(): { count: () => number; stop: () => void } {
  const proto = BoardStore.prototype as unknown as { load(doc: Y.Doc): LoadResult };
  const real = proto.load;
  let calls = 0;
  proto.load = function (this: BoardStore, doc: Y.Doc): LoadResult {
    calls += 1;
    return real.call(this, doc);
  };
  return {
    count: () => calls,
    stop: () => {
      proto.load = real;
    },
  };
}

describe('persistent BoardRoom', () => {
  it('TC-12: a note is in storage by the time another client sees it', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      const id = createSticky(a.doc, { x: 300, y: 200 });
      await waitUntil(() => b.board().some((note) => note.id === id), 'B never received the note');

      // Broadcast happens after the write, so the row is already there.
      const stored = await readBoard(boardId);
      expect(stored.logRows).toBeGreaterThanOrEqual(1);
      expect(stored.notes).toBe(1);
      expect(stored.board).toContain(id);
      expect(stored.load).toEqual({ ok: true, quarantined: 0 });
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-13: the board is intact for a client who joins after everyone left and the object was evicted', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    Y.transact(a.doc, () => {
      for (let index = 0; index < 5; index++) createSticky(a.doc, { x: index * 50, y: 0 });
    });
    const expected = jsonOf(a);
    a.close();
    await a.whenClosed();

    // Memory gone, storage kept: the next client rebuilds from SQLite alone.
    await evictDurableObject(stubFor(boardId));

    const late = await connectClient(boardId);
    try {
      await waitUntil(() => jsonOf(late) === expected, 'the reloaded board did not match');
    } finally {
      late.close();
    }
  });

  it('TC-13b: text, colour and deletions survive an eviction exactly', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const kept = createSticky(a.doc, { x: 100, y: 100 });
    getStickyText(a.doc, kept)?.insert(0, 'first line\nsecond line');
    const coloured = createSticky(a.doc, { x: 140, y: 120 }, 'green');
    deleteObject(a.doc, createSticky(a.doc, { x: 900, y: 900 }));
    const expected = jsonOf(a);

    a.close();
    await a.whenClosed();
    await evictDurableObject(stubFor(boardId));

    const back = await connectClient(boardId);
    try {
      await waitUntil(() => jsonOf(back) === expected, 'the reloaded board differs from what was left');
      const notes = back.board();
      expect(notes.map((note) => note.id).sort()).toEqual([kept, coloured].sort());
      expect(notes.find((note) => note.id === coloured)?.color).toBe('green');
      expect(notes.find((note) => note.id === kept)?.text).toBe('first line\nsecond line');
    } finally {
      back.close();
    }
  });

  it('TC-14: a change that cannot be stored is shown to nobody, and arrives after reconnect', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);

    const proto = BoardStore.prototype as unknown as { append(update: Uint8Array): void };
    const real = proto.append;
    let failNext = true;
    proto.append = function (this: BoardStore, update: Uint8Array): void {
      if (failNext) {
        failNext = false;
        throw new Error('injected storage write failure');
      }
      real.call(this, update);
    };

    try {
      createSticky(a.doc, { x: 80, y: 80 });

      // Both sockets close with 1011 and B never saw the change.
      await Promise.all([a.whenClosed(), b.whenClosed()]);
      expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
      expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
      expect(b.board()).toHaveLength(0);
      expect((await readBoard(boardId)).notes).toBe(0);

      // B comes back first, then A — whose document still holds the change.
      // A re-sends it, storage takes it this time, and B is told.
      await b.connect(boardId);
      await b.sync();
      expect(b.board()).toHaveLength(0);

      await a.connect(boardId);
      await a.sync();
      await waitUntil(() => b.board().length === 1, 'B never received the recovered change');

      const stored = await readBoard(boardId);
      expect(stored.notes).toBe(1);
      expect(stored.board).toBe(jsonOf(b));
    } finally {
      proto.append = real;
      a.close();
      b.close();
    }
  });

  it('TC-15: an unreadable snapshot closes clients with 4500 and stores nothing from the attempt', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    createSticky(a.doc, { x: 10, y: 10 });
    await settle();
    a.close();
    await a.whenClosed();

    // A snapshot that cannot be decoded, on top of a perfectly good log.
    await writeBoard(boardId, [
      {
        query: 'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        bindings: [0, blob(damagedUpdate())],
      },
    ]);
    const before = await readBoard(boardId);
    expect(before.chunkRows).toBe(1);
    expect(before.load.ok).toBe(false);
    await evictDurableObject(stubFor(boardId));

    const client = new RoomClient();
    await client.connect(boardId);
    await client.whenClosed();
    expect(client.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    // The user is not shown an empty board.
    expect(client.board()).toHaveLength(0);

    // What the refused client sent — its own SyncStep2 among it — stored nothing.
    const after = await readBoard(boardId);
    expect(after.logRows).toBe(before.logRows);
    expect(after.chunkRows).toBe(before.chunkRows);
    expect(after.notes).toBe(0);
  });

  it(
    'TC-16: inside the retry window the room refuses without touching storage, and recovers on its own once repaired',
    async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    createSticky(a.doc, { x: 20, y: 20 });
    await settle();
    a.close();
    await a.whenClosed();

    // Damage: a snapshot row that cannot be decoded. Repair is simply removing
    // it, which leaves the log the board was written from.
    await writeBoard(boardId, [
      {
        query: 'INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)',
        bindings: [0, blob(new Uint8Array([1, 2, 3]))],
      },
    ]);
    await evictDurableObject(stubFor(boardId));

    const first = new RoomClient();
    await first.connect(boardId);
    await first.whenClosed();
    expect(first.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Second attempt within the interval: refused, and refused from the state
    // machine alone — storage is not read again.
    const loads = countLoads();
    try {
      const second = new RoomClient();
      await second.connect(boardId);
      await second.whenClosed();
      expect(second.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(loads.count()).toBe(0);
    } finally {
      loads.stop();
    }

    // Repair, then the next connection after the retry interval loads for real
    // without anyone reloading the page.
    await writeBoard(boardId, [{ query: 'DELETE FROM snapshot_chunks' }]);
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 200));

    const third = new RoomClient();
    await third.connect(boardId);
    await third.sync();
    expect(third.board()).toHaveLength(1);
    third.close();
    },
    // The retry interval is part of the behaviour under test.
    LOAD_RETRY_MIN_INTERVAL_MS + 15_000,
  );

  it('TC-17: an update Yjs refuses closes the socket with 1003 and adds no row', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    createSticky(a.doc, { x: 1, y: 1 });
    await settle();
    const before = await readBoard(boardId);

    const rogue = new RoomClient();
    await rogue.connect(boardId);
    // A sync frame carrying an Update whose payload cannot be decoded.
    const frame = new Uint8Array([MESSAGE_SYNC, 2, 250, 250, 250, 250, 7]);
    rogue.sendRaw(frame.slice().buffer);
    await rogue.whenClosed();
    expect(rogue.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    const after = await readBoard(boardId);
    expect(after.logRows).toBe(before.logRows);
    expect(after.load).toEqual({ ok: true, quarantined: 0 });
    a.close();
  });

  it('TC-18: after the object is evicted, a message on a socket accepted before eviction still reaches the others', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    const b = await connectClient(boardId);
    try {
      // Sockets stay open, the object behind them is discarded: what an idle
      // board with people connected looks like in production.
      await evictDurableObject(stubFor(boardId));

      const id = createSticky(a.doc, { x: 500, y: 500 });
      await waitUntil(
        () => b.board().some((note) => note.id === id),
        'the woken room did not reach the socket it accepted earlier',
      );
      expect((await readBoard(boardId)).notes).toBe(1);
    } finally {
      a.close();
      b.close();
    }
  });

  it('TC-26: a storage read error on load closes clients with 4500 instead of serving an empty board', async () => {
    const boardId = newBoardId();
    const a = await connectClient(boardId);
    createSticky(a.doc, { x: 1, y: 1 });
    await settle();
    a.close();
    await a.whenClosed();

    // Break the read the room depends on: `updates` becomes a view over a table
    // that is not there, so the room's own `CREATE TABLE IF NOT EXISTS` is a
    // no-op and the SELECT in `load` is what fails.
    await writeBoard(boardId, [
      { query: 'DROP TABLE updates' },
      { query: 'CREATE VIEW updates AS SELECT seq, bytes FROM missing_table' },
    ]);
    await evictDurableObject(stubFor(boardId));

    const client = new RoomClient();
    await client.connect(boardId);
    await client.whenClosed();
    expect(client.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(client.board()).toHaveLength(0);

    // Nothing was written to the broken store in the meantime.
    const rows = await writeBoard(boardId, [], 'SELECT COUNT(*) AS n FROM snapshot_chunks');
    expect(Number(rows[0]?.['n'] ?? -1)).toBe(0);
  });
});
