import { evictDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import { retroBoard, truncated } from '../fixtures/boards';
import { count, failingStorage, inRoom, loadFromStorage, roomStub } from './storage-helpers';
import { TestClient, createBoardId, settle, syncFrame, waitForConvergence } from './ws-client';

const clients: TestClient[] = [];
async function join(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const client = await TestClient.join(boardId, doc);
  clients.push(client);
  return client;
}
async function connect(boardId: string, doc?: Y.Doc): Promise<TestClient> {
  const client = await TestClient.connect(boardId, doc);
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  vi.restoreAllMocks();
});

function copyOf(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

/** A board whose 25 notes are saved in the room's storage; everyone has left. */
async function savedRetroBoard(boardId: string) {
  const board = retroBoard();
  const seeder = await join(boardId, copyOf(board.doc));
  // The seeder's state reaches the room in its SyncStep2; a probe proves it arrived.
  const probe = await join(boardId);
  await waitForConvergence([seeder, probe]);
  seeder.close();
  probe.close();
  return snapshot(board.doc);
}

/** Saved 25-note board compacted into a snapshot whose chunk 0 is then damaged; room restarted. */
async function brokenBoard(boardId: string) {
  const original = await savedRetroBoard(boardId);
  const saved = await inRoom(boardId, (room, storage) => {
    const doc = room.loadedDoc();
    if (!doc || !room.store.compact(doc)) throw new Error('compaction failed');
    const chunk = storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks WHERE idx = 0').one();
    storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', truncated(new Uint8Array(chunk.data)).slice().buffer);
    return chunk.data.slice(0);
  });
  await evictDurableObject(roomStub(boardId), { webSockets: 'close' });
  return { original, saved };
}

async function closeCode(client: TestClient): Promise<number | undefined> {
  await vi.waitFor(() => {
    if (!client.closeEvent) throw new Error('still open');
  });
  return client.closeEvent?.code;
}

describe('persistent board room (persist.room)', () => {
  it('TC-12: a change is stored by the time another participant sees it, and reloads from storage', async () => {
    const boardId = await createBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const rowsBefore = await inRoom(boardId, (_room, storage) => count(storage, 'updates'));
    expect(rowsBefore).toBe(0);
    createSticky(a.doc, { x: 40, y: 60 }, 'pink');
    await waitForConvergence([a, b]);
    expect(b.snapshot()).toHaveLength(1);
    expect(await inRoom(boardId, (_room, storage) => count(storage, 'updates'))).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    const { result, notes } = await inRoom(boardId, (_room, storage) => loadFromStorage(storage));
    expect(result).toEqual({ ok: true, quarantined: 0 });
    expect(notes).toEqual(a.snapshot());
  });

  it('TC-13: after everyone leaves and the room restarts, a new participant gets the identical board', async () => {
    const boardId = await createBoardId();
    const original = await savedRetroBoard(boardId);
    await evictDurableObject(roomStub(boardId), { webSockets: 'close' });
    const late = await join(boardId);
    expect(late.snapshot()).toEqual(original);
    expect(late.snapshot()).toHaveLength(25);
  });

  it('TC-14: a failed save is not broadcast; both are closed 1011; the change is saved and delivered after reconnecting', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boardId = await createBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    await inRoom(boardId, (room) => {
      const append = room.store.append.bind(room.store);
      let failures = 1;
      room.store.append = (update) => {
        if (failures-- > 0) throw new Error('injected disk failure');
        append(update);
      };
    });
    const id = createSticky(a.doc, { x: 1, y: 2 }, 'blue');
    expect(await closeCode(a)).toBe(CLOSE_STORAGE_FAILURE);
    expect(await closeCode(b)).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.updatesReceived()).toHaveLength(0);
    expect(b.snapshot()).toEqual([]);
    expect(await inRoom(boardId, (_room, storage) => count(storage, 'updates'))).toBe(0);

    // A still holds the change and re-sends it on reconnection (SyncStep2).
    const b2 = await join(boardId, b.doc);
    const a2 = await join(boardId, a.doc);
    await waitForConvergence([a2, b2]);
    expect(b2.snapshot().map((n) => n.id)).toEqual([id]);
    const { notes } = await inRoom(boardId, (_room, storage) => loadFromStorage(storage));
    expect(notes.map((n) => n.id)).toEqual([id]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('board-append-failed'));
  });

  it('TC-15: a board whose snapshot is damaged closes clients with 4500 and stores nothing they send', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boardId = await createBoardId();
    await brokenBoard(boardId);
    const before = await inRoom(boardId, (room, storage) => ({
      state: room.state,
      updates: count(storage, 'updates'),
      chunks: count(storage, 'snapshot_chunks'),
    }));
    expect(before.state).toBe('load-failed');

    const doc = new Y.Doc();
    createSticky(doc, { x: 0, y: 0 });
    const client = await connect(boardId, doc);
    client.send(syncFrame((e) => syncProtocol.writeSyncStep2(e, doc)));
    expect(await closeCode(client)).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Never presented as an (empty) board.
    expect(client.synced).toBe(false);
    await settle();
    const after = await inRoom(boardId, (_room, storage) => ({
      updates: count(storage, 'updates'),
      chunks: count(storage, 'snapshot_chunks'),
      quarantined: count(storage, 'quarantined_updates'),
    }));
    expect(after).toEqual({ updates: before.updates, chunks: before.chunks, quarantined: 0 });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('snapshot-unreadable'));
  });

  it('TC-16: a failed room retries loading only after LOAD_RETRY_MIN_INTERVAL_MS, then loads the repaired board', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boardId = await createBoardId();
    const { original, saved } = await brokenBoard(boardId);
    const loads = await inRoom(boardId, (room) => {
      expect(room.state).toBe('load-failed');
      return vi.spyOn(room.store, 'load');
    });

    const early = await connect(boardId);
    expect(await closeCode(early)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loads).not.toHaveBeenCalled();

    await inRoom(boardId, (_room, storage) => {
      storage.sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = 0', saved);
    });
    // Repaired, but still inside the interval: no reload attempt yet.
    const stillEarly = await connect(boardId);
    expect(await closeCode(stillEarly)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(loads).not.toHaveBeenCalled();

    await inRoom(boardId, (room) => {
      room.loadFailedAt -= LOAD_RETRY_MIN_INTERVAL_MS;
    });
    const later = await join(boardId);
    expect(loads).toHaveBeenCalledTimes(1);
    expect(later.snapshot()).toEqual(original);
    expect(later.closeEvent).toBeNull();
  });

  it('TC-17: a garbage update closes the sender with 1003 and nothing is stored', async () => {
    const boardId = await createBoardId();
    const a = await join(boardId);
    createSticky(a.doc, { x: 5, y: 5 });
    const probe = await join(boardId);
    await waitForConvergence([a, probe]);
    const rows = await inRoom(boardId, (_room, storage) => count(storage, 'updates'));
    a.send(syncFrame((e) => syncProtocol.writeUpdate(e, new Uint8Array([200, 1, 2, 3, 4, 5, 6, 7]))));
    expect(await closeCode(a)).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await inRoom(boardId, (_room, storage) => count(storage, 'updates'))).toBe(rows);
    expect(probe.closeEvent).toBeNull();
  });

  it('TC-18: after the room hibernates and is rebuilt, sockets accepted earlier still receive broadcasts', async () => {
    const boardId = await createBoardId();
    const board = retroBoard();
    const a = await join(boardId, copyOf(board.doc));
    const b = await join(boardId);
    await waitForConvergence([a, b]);
    await evictDurableObject(roomStub(boardId), { webSockets: 'hibernate' });

    // A's message wakes a new instance, which reloads the doc and broadcasts via ctx.getWebSockets().
    const id = createSticky(a.doc, { x: -300, y: -300 }, 'green');
    await waitForConvergence([a, b]);
    expect(b.snapshot().some((n) => n.id === id)).toBe(true);
    expect(b.snapshot()).toHaveLength(26);
    expect(a.closeEvent).toBeNull();
    expect(b.closeEvent).toBeNull();
    const state = await inRoom(boardId, (room) => room.state);
    expect(state).toBe('ready');
  });

  it('TC-26: a SQL error while loading puts the room in load-failed and closes new sockets with 4500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boardId = await createBoardId();
    await savedRetroBoard(boardId);
    await inRoom(boardId, (room, storage) => {
      room.store = new BoardStore(failingStorage(storage, /^SELECT/));
      room.unload();
    });
    const client = await connect(boardId);
    expect(await closeCode(client)).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(client.synced).toBe(false);
    const failure = await inRoom(boardId, (room) => {
      const doc = new Y.Doc();
      return { state: room.state, result: room.store.load(doc) };
    });
    expect(failure.state).toBe('load-failed');
    expect(failure.result).toMatchObject({ ok: false, reason: 'sql-error' });
  });
});
