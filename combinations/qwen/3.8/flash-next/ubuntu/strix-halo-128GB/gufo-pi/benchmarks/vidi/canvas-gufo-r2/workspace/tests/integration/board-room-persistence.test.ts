/**
 * Integration tests for the persistent, hibernating BoardRoom:
 * TC-12 to TC-18 and TC-26.
 *
 * Storage is inspected and damaged through `runInDurableObject`, which runs in
 * the same isolate as the room, so injected store failures sit outside SQLite
 * and the real transaction semantics still apply.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { createSticky, getStickyText, setStickyColor } from '../../src/shared/board-model';
import { BoardStore } from '../../src/worker/board-store';
import { connectRoom, snapEqual, type TestClient } from './ws-client';
import type { BoardRoom } from '../../src/worker/board-room';
import { truncateUpdate, undecodableBytes } from '../fixtures/boards';
import type { Env } from '../../src/worker';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

type Note = { id: string; text: string; x: number; y: number; color: string };

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stubFor(boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/** BLOB bindings are typed as ArrayBuffer, even though the runtime takes bytes. */
function toBlob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function boardNotes(doc: Y.Doc): Note[] {
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  const notes: Note[] = [];
  objects.forEach((obj, id) => {
    if (obj.get('type') !== 'sticky') return;
    notes.push({
      id,
      text: (obj.get('text') as Y.Text | undefined)?.toString() ?? '',
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as string,
    });
  });
  notes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return notes;
}

/** Read the board back the way a woken room does: fresh store, fresh doc. */
function readBack(boardId: string): Promise<{
  ok: boolean;
  updateRows: number;
  snapshotRows: number;
  notes: Note[];
}> {
  return runInDurableObject(stubFor(boardId), (room) => {
    const store = room.store;
    const doc = new Y.Doc();
    const result = store.load(doc);
    return {
      ok: result.ok,
      updateRows: store.updateRowCount(),
      snapshotRows: store.snapshotRowCount(),
      notes: boardNotes(doc),
    };
  });
}

/** Fill a connected client's doc with `count` notes and let the room store them. */
async function seed(client: TestClient, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const id = createSticky(client.doc, { x: i * 40, y: (i % 5) * 120 }, 'yellow');
    getStickyText(client.doc, id)?.insert(0, `note ${i}`);
    if (i % 4 === 0) setStickyColor(client.doc, id, 'blue');
  }
  await wait(300);
}

/** Write and fold a board straight into storage, without connecting a client. */
async function seedStorage(boardId: string, count: number): Promise<Note[]> {
  return runInDurableObject(stubFor(boardId), (room) => {
    const store = room.store;
    store.migrate();
    const doc = new Y.Doc();
    for (let i = 0; i < count; i++) {
      const id = createSticky(doc, { x: i * 30, y: (i % 4) * 100 }, 'green');
      getStickyText(doc, id)?.insert(0, `stored ${i}`);
    }
    store.append(Y.encodeStateAsUpdate(doc));
    store.compact(doc);
    return boardNotes(doc);
  });
}

/** Every snapshot row, so damaged bytes can be put back afterwards. */
function captureSnapshot(boardId: string): Promise<{ index: number; data: Uint8Array }[]> {
  return runInDurableObject(stubFor(boardId), (_room, state) =>
    state.storage.sql
      .exec('SELECT idx, data FROM snapshot_chunks ORDER BY idx ASC')
      .toArray()
      .map((row) => ({
        index: Number(row.idx),
        data: row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(0),
      })),
  );
}

/** Overwrite every chunk with bytes that will not decode. */
async function damageSnapshot(boardId: string): Promise<void> {
  await runInDurableObject(stubFor(boardId), (_room, state) => {
    const rows = state.storage.sql.exec('SELECT idx FROM snapshot_chunks').toArray();
    for (const row of rows) {
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
        toBlob(undecodableBytes(48, 3)),
        Number(row.idx),
      );
    }
  });
}

async function restoreSnapshot(
  boardId: string,
  chunks: { index: number; data: Uint8Array }[],
): Promise<void> {
  await runInDurableObject(stubFor(boardId), (_room, state) => {
    for (const chunk of chunks) {
      state.storage.sql.exec(
        'UPDATE snapshot_chunks SET data = ? WHERE idx = ?',
        toBlob(chunk.data),
        chunk.index,
      );
    }
  });
}

describe('TC-12: an applied update is stored before it is broadcast', () => {
  it('client A creates a note: the row exists and a fresh doc from storage has it', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);

    createSticky(a.doc, { x: 20, y: 30 }, 'pink');
    await wait(300);

    // B has seen the change, so its row must already be in the log.
    expect(b.snapshot().length).toBe(1);
    const stored = await readBack(id);
    expect(stored.ok).toBe(true);
    expect(stored.updateRows).toBeGreaterThanOrEqual(1);
    expect(stored.notes.length).toBe(1);

    a.close();
    b.close();
    await wait(150);
  });
});

describe('TC-13: a woken room reads what the previous one wrote', () => {
  it('a client connecting after the room rebuilt its doc sees the same 25 notes', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    await seed(a, 25);
    const expected = a.snapshot();
    expect(expected.length).toBe(25);
    a.close();
    await wait(200);

    // The object discards its doc and rebuilds it purely from storage, which is
    // what a wake from eviction does.
    const state = await runInDurableObject(stubFor(id), (room) => room.reload());
    expect(state).toBe('ready');

    const late = await connectRoom(id);
    await wait(300);
    expect(snapEqual(late.snapshot(), expected)).toBe(true);
    late.close();
  });
});

describe('TC-14: a failed write resets the room and is not broadcast', () => {
  it('both sockets close 1011, nothing is delivered, reconnect stores the change', async () => {
    const id = newBoardId();
    const closedA: number[] = [];
    const closedB: number[] = [];
    const a = await connectRoom(id, { onclose: (code) => closedA.push(code) });
    const b = await connectRoom(id, { onclose: (code) => closedB.push(code) });
    await wait(200);
    expect((await readBack(id)).notes.length).toBe(0);

    // Fail exactly one insert, the way a disk error would.
    await runInDurableObject(stubFor(id), (room) => {
      let failures = 1;
      const store = room.store;
      store.append = (update: Uint8Array) => {
        if (failures-- > 0) throw new Error('injected insert failure');
        return BoardStore.prototype.append.call(store, update);
      };
    });

    createSticky(a.doc, { x: 10, y: 10 }, 'green');
    await wait(300);

    // Nothing was broadcast, and every socket was closed with 1011.
    expect(b.snapshot().length).toBe(0);
    expect(closedA).toContain(CLOSE_STORAGE_FAILURE);
    expect(closedB).toContain(CLOSE_STORAGE_FAILURE);
    expect((await readBack(id)).notes.length).toBe(0);

    // A still holds the change and re-sends it when it reconnects (story 3
    // SyncStep1/SyncStep2 exchange); the write works again by then.
    const a2 = await connectRoom(id, { doc: a.doc });
    await wait(300);
    const b2 = await connectRoom(id);
    await wait(300);

    expect(b2.snapshot().length).toBe(1);
    const stored = await readBack(id);
    expect(stored.notes.length).toBe(1);
    expect(snapEqual(b2.snapshot(), stored.notes)).toBe(true);

    a2.close();
    b2.close();
  });
});

describe('TC-15: a damaged snapshot puts the room into load-failed', () => {
  it('the client is closed 4500 and nothing it sends is stored', async () => {
    const id = newBoardId();
    await seedStorage(id, 25);
    await damageSnapshot(id);
    // The object wakes and tries to read its board back.
    expect(await runInDurableObject(stubFor(id), (room) => room.reload())).toBe('load-failed');

    const closed: number[] = [];
    const client = await connectRoom(id, { onclose: (code) => closed.push(code) });
    // Even a full-state SyncStep2 sent immediately must not be stored.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep2(encoder, client.doc);
    client.send(encoding.toUint8Array(encoder));
    await wait(400);

    expect(closed).toContain(CLOSE_BOARD_LOAD_FAILED);
    const stored = await readBack(id);
    expect(stored.ok).toBe(false);
    expect(stored.updateRows).toBe(0);
    client.close();
  });
});

describe('TC-16: load failure retries only after LOAD_RETRY_MIN_INTERVAL_MS', () => {
  it(
    'connects inside the interval are refused without a reload; after it the board loads',
    async () => {
      const id = newBoardId();
      const expected = await seedStorage(id, 25);
      const saved = await captureSnapshot(id);
      await damageSnapshot(id);
      expect(await runInDurableObject(stubFor(id), (room) => room.reload())).toBe('load-failed');

      const first: number[] = [];
      const c1 = await connectRoom(id, { onclose: (code) => first.push(code) });
      await wait(300);
      expect(first).toContain(CLOSE_BOARD_LOAD_FAILED);

      // Storage repaired, but still inside the retry interval: no reload is
      // attempted, so the board is still refused.
      await restoreSnapshot(id, saved);
      const second: number[] = [];
      const c2 = await connectRoom(id, { onclose: (code) => second.push(code) });
      await wait(300);
      expect(second).toContain(CLOSE_BOARD_LOAD_FAILED);
      c1.close();
      c2.close();

      await wait(LOAD_RETRY_MIN_INTERVAL_MS + 200);
      const third: number[] = [];
      const c3 = await connectRoom(id, { onclose: (code) => third.push(code) });
      await wait(400);
      expect(third).toEqual([]);
      expect(snapEqual(c3.snapshot(), expected)).toBe(true);
      c3.close();
    },
    30_000,
  );
});

describe('TC-17: garbage is rejected without touching storage', () => {
  it('a garbage update closes the sender 1003 and stores nothing', async () => {
    const id = newBoardId();
    const closed: number[] = [];
    const a = await connectRoom(id, { onclose: (code) => closed.push(code) });
    await wait(200);

    // A SyncStep2 carrying a real update with its tail removed: it cannot be
    // applied, and must not be stored either.
    const source = new Y.Doc();
    createSticky(source, { x: 1, y: 1 });
    const truncated = truncateUpdate(Y.encodeStateAsUpdate(source), 10);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint8Array(encoder, truncated);
    a.send(encoding.toUint8Array(encoder));
    await wait(300);

    expect(closed).toContain(CLOSE_UNSUPPORTED_DATA);
    const stored = await readBack(id);
    expect(stored.updateRows).toBe(0);
    expect(stored.notes.length).toBe(0);
    a.close();
  });
});

describe('TC-18: hibernated sockets still receive broadcasts', () => {
  it('a socket accepted before the object was rebuilt gets the next update', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    await wait(200);

    // Sockets stay accepted while the object rebuilds its doc from storage: the
    // broadcast list comes from ctx.getWebSockets(), not from memory.
    const state = await runInDurableObject(stubFor(id), (room) => room.reload());
    expect(state).toBe('ready');

    createSticky(a.doc, { x: 5, y: 5 }, 'orange');
    await wait(300);

    expect(b.snapshot().length).toBe(1);
    expect(snapEqual(a.snapshot(), b.snapshot())).toBe(true);
    a.close();
    b.close();
  });
});

describe('TC-26: a SQL error while reading is a load failure', () => {
  it('new connections are closed 4500 and storage is left alone', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    await seed(a, 5);
    const expected = a.snapshot();
    a.close();
    await wait(200);

    // Make the load's SELECT throw.
    const state = await runInDurableObject(stubFor(id), (room) => {
      room.store.load = () => {
        throw new Error('injected SELECT failure');
      };
      return room.reload();
    });
    expect(state).toBe('load-failed');

    const closed: number[] = [];
    const client = await connectRoom(id, { onclose: (code) => closed.push(code) });
    await wait(300);
    expect(closed).toContain(CLOSE_BOARD_LOAD_FAILED);
    client.close();

    // The failure was on the read path only: the board is still in storage.
    await runInDurableObject(stubFor(id), (room) => {
      room.store.load = BoardStore.prototype.load.bind(room.store);
    });
    const after = await runInDurableObject(stubFor(id), (room) => room.reload());
    expect(after).toBe('ready');
    const late = await connectRoom(id);
    await wait(300);
    expect(snapEqual(late.snapshot(), expected)).toBe(true);
    late.close();
  });
});

describe('room served through the worker entry point', () => {
  it('a second upgrade to the same board finds the same stored board', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    await seed(a, 3);
    const expected = a.snapshot();
    a.close();
    await wait(200);

    const res = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } }),
    );
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();

    const late = await connectRoom(id);
    await wait(300);
    expect(snapEqual(late.snapshot(), expected)).toBe(true);
    late.close();
  });
});

describe('TC-25: opening a board stores nothing', () => {
  it('creates tables but no rows when nobody edits', async () => {
    const id = newBoardId();
    const a = await connectRoom(id);
    const b = await connectRoom(id);
    await wait(400);
    // Awareness only: no document updates crossed the wire.
    expect(a.snapshot().length).toBe(0);
    expect(b.snapshot().length).toBe(0);
    a.close();
    b.close();
    await wait(200);

    const stored = await runInDurableObject(stubFor(id), (_room, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .toArray()
        .map((row) => row.name);
      const count = (table: string) =>
        Number(
          state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]?.n ?? 0,
        );
      return {
        tables: tables.sort(),
        updates: count('updates'),
        snapshots: count('snapshot_chunks'),
        quarantined: count('quarantined_updates'),
      };
    });

    expect(stored.tables).toEqual(['quarantined_updates', 'snapshot_chunks', 'storage_meta', 'updates']);
    expect(stored.updates).toBe(0);
    expect(stored.snapshots).toBe(0);
    expect(stored.quarantined).toBe(0);
  });
});

/**
 * The production configuration (wrangler.jsonc) does not set TEST_HOOKS, so the
 * storage hooks must not exist there.
 */
describe('storage hooks are absent without TEST_HOOKS', () => {
  it('does not handle /__test routes', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(`http://localhost/__test/boards/${id}/seed?notes=1`, {
      method: 'POST',
    });
    // Handled by the asset router, never by the room: no JSON answer.
    expect(res.headers.get('content-type') ?? '').not.toContain('application/json');
  });
});
