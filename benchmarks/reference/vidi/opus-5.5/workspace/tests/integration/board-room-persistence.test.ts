import { env, SELF } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { BoardRoom } from '../../src/worker/board-room';
import type { BoardStore } from '../../src/worker/board-store';
import { RETRO_NOTES, retroLog, truncated } from '../fixtures/boards';
import { blobRows, count, inRoom, overwrite, reload, restartRoom, writeLog } from './storage';
import { ORIGIN, connect, docJson, ensureBoard, eventually, join, type TestClient } from './ws-client';

const NOTE_AT = { x: 40, y: 60 } as const;
/** Margin past LOAD_RETRY_MIN_INTERVAL_MS so the retry is clearly after the interval. */
const RETRY_MARGIN_MS = 250;
const RETRY_TEST_TIMEOUT_MS = LOAD_RETRY_MIN_INTERVAL_MS * 4;
const GARBAGE = new Uint8Array([255, 255, 255, 255, 255]);

function closeAll(...clients: TestClient[]): void {
  clients.forEach((c) => c.close());
}

/** A y-websocket frame: sync `syncType` carrying `update`. */
function syncFrame(syncType: number, update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  encoding.writeVarUint(e, syncType);
  encoding.writeVarUint8Array(e, update);
  return encoding.toUint8Array(e);
}

/** The update produced by creating one note on an otherwise empty client. */
function noteUpdate(at: { x: number; y: number } = NOTE_AT): { id: string; update: Uint8Array } {
  const doc = new Y.Doc();
  let update: Uint8Array | undefined;
  doc.on('update', (u: Uint8Array) => {
    update = u;
  });
  const id = createSticky(doc, at);
  return { id, update: update! };
}

/** Saves a 25-note board as snapshot + log, then damages snapshot chunk 0. Returns the original chunk. */
async function seedCorruptBoard(boardId: string): Promise<Uint8Array> {
  const log = retroLog();
  const original = await inRoom(boardId, (storage) => {
    const store = writeLog(storage, log.updates);
    expect(store.compact(log.doc)).toBe(true);
    const chunk0 = Uint8Array.from(blobRows(storage, 'snapshot_chunks')[0]![1]);
    overwrite(storage, 'snapshot_chunks', 0, truncated(chunk0));
    return chunk0;
  });
  await restartRoom(boardId);
  return original;
}

function loadAttempts(boardId: string): Promise<number> {
  return inRoom(boardId, (_s, room) => room.loadAttempts);
}

describe('persist.room: durability', () => {
  it('TC-12 a change is stored by the time another client has it; a fresh doc from storage contains it', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    const id = createSticky(a.doc, NOTE_AT);
    await eventually(() => expect(snapshot(b.doc).map((n) => n.id)).toEqual([id]));
    const stored = await inRoom(boardId, (storage) => count(storage, 'updates'));
    expect(stored).toBeGreaterThanOrEqual(1);
    closeAll(a, b);
    await inRoom(boardId, (storage) => {
      const { doc, result } = reload(storage);
      expect(result).toEqual({ ok: true, quarantined: 0 });
      expect(snapshot(doc)).toEqual(snapshot(a.doc));
    });
  });

  it(`TC-13 after everyone leaves and the object restarts, a new client gets all ${RETRO_NOTES} notes`, async () => {
    const boardId = newBoardId();
    const log = retroLog();
    const a = await join(boardId);
    const b = await join(boardId);
    for (const u of log.updates) Y.applyUpdate(a.doc, u);
    await eventually(() => expect(docJson(b.doc)).toEqual(docJson(a.doc)));
    closeAll(a, b);
    await restartRoom(boardId);

    const c = await join(boardId);
    expect(snapshot(c.doc)).toHaveLength(RETRO_NOTES);
    expect(docJson(c.doc)).toEqual(docJson(log.doc));
    expect(snapshot(c.doc)).toEqual(snapshot(log.doc));
    c.close();
  });

  it('TC-18 hibernation path: a reconstructed room serves sockets accepted before it existed', async () => {
    const boardId = newBoardId();
    const log = retroLog();
    await inRoom(boardId, (storage) => {
      writeLog(storage, log.updates);
    });
    await restartRoom(boardId);
    const a = await join(boardId);
    const b = await join(boardId);
    expect(snapshot(a.doc)).toHaveLength(RETRO_NOTES);
    const { id, update } = noteUpdate({ x: 3000, y: 3000 });

    const rowsBefore = await inRoom(boardId, (storage) => count(storage, 'updates'));
    await inRoom(boardId, async (storage, _room, state) => {
      // A new instance over the same storage, as after hibernation: only ctx.getWebSockets()
      // knows the sockets accepted earlier.
      const woken = new BoardRoom(state, env);
      await woken.loaded;
      expect(woken.state).toBe('ready');
      const sockets = state.getWebSockets();
      expect(sockets).toHaveLength(2);
      woken.webSocketMessage(sockets[0]!, syncFrame(syncProtocol.messageYjsUpdate, update).slice().buffer);
      expect(count(storage, 'updates')).toBe(rowsBefore + 1);
    });
    // The sender socket gets no echo; the other one receives the change.
    await eventually(() => {
      const withNote = [a, b].filter((c) => snapshot(c.doc).some((n) => n.id === id));
      expect(withNote).toHaveLength(1);
    });
    closeAll(a, b);
  });
});

describe('persist.room: failures', () => {
  it('TC-14 a failed save is not broadcast; everyone is closed 1011; the change is saved from the open page on reconnect', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    await inRoom(boardId, (_s, room) => {
      const store = (room as unknown as { store: BoardStore }).store;
      const real = store.append.bind(store);
      let failNext = true;
      store.append = (u) => {
        if (failNext) {
          failNext = false;
          throw new Error('injected append failure');
        }
        real(u);
      };
    });
    const rowsBefore = await inRoom(boardId, (storage) => count(storage, 'updates'));

    const id = createSticky(a.doc, NOTE_AT);
    expect(await a.closed).toBe(CLOSE_STORAGE_FAILURE);
    expect(await b.closed).toBe(CLOSE_STORAGE_FAILURE);
    expect(snapshot(b.doc)).toHaveLength(0);
    expect(b.updateCount()).toBe(0);
    expect(await inRoom(boardId, (storage) => count(storage, 'updates'))).toBe(rowsBefore);

    // B comes back first (room reloads from storage: no note), then A with its unsaved change.
    const b2 = await join(boardId, b.doc);
    expect(snapshot(b2.doc)).toHaveLength(0);
    const a2 = await join(boardId, a.doc);
    await eventually(() => expect(snapshot(b2.doc).map((n) => n.id)).toEqual([id]));
    await inRoom(boardId, (storage) => {
      expect(count(storage, 'updates')).toBeGreaterThan(rowsBefore);
      expect(snapshot(reload(storage).doc).map((n) => n.id)).toEqual([id]);
    });
    closeAll(a2, b2);
  });

  it('TC-15 damaged snapshot → closed 4500, no board served, and an update sent before the close is not stored', async () => {
    const boardId = newBoardId();
    await seedCorruptBoard(boardId);
    const before = await inRoom(boardId, (storage) => blobRows(storage, 'updates'));
    const client = await connect(boardId);
    try {
      client.sendRaw(syncFrame(syncProtocol.messageYjsSyncStep2, noteUpdate().update));
    } catch {
      // The socket may already be closing.
    }
    expect(await client.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(client.received.filter((m) => m.type === 'sync')).toHaveLength(0);
    await inRoom(boardId, (storage, room) => {
      expect(room.state).toBe('load-failed');
      expect(blobRows(storage, 'updates')).toEqual(before);
      expect(count(storage, 'quarantined_updates')).toBe(0);
    });
  });

  it(
    'TC-16 retries load only after LOAD_RETRY_MIN_INTERVAL_MS; after repair the board loads and syncs',
    async () => {
      const boardId = newBoardId();
      const original = await seedCorruptBoard(boardId);
      const first = await connect(boardId);
      expect(await first.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
      const failedAt = Date.now();
      expect(await loadAttempts(boardId)).toBe(1);

      // Before the interval: closed again without a reload attempt.
      const early = await connect(boardId);
      expect(await early.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
      expect(await loadAttempts(boardId)).toBe(1);

      await inRoom(boardId, (storage) => overwrite(storage, 'snapshot_chunks', 0, original));
      const wait = failedAt + LOAD_RETRY_MIN_INTERVAL_MS + RETRY_MARGIN_MS - Date.now();
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));

      const later = await join(boardId);
      expect(snapshot(later.doc)).toHaveLength(RETRO_NOTES);
      expect(await loadAttempts(boardId)).toBe(2);
      expect(await inRoom(boardId, (_s, room) => room.state)).toBe('ready');
      later.close();
    },
    RETRY_TEST_TIMEOUT_MS,
  );

  const garbage: [string, () => Uint8Array][] = [
    ['random bytes', () => GARBAGE],
    ['a truncated real update', () => truncated(noteUpdate().update)],
  ];
  for (const [name, bytes] of garbage) {
    it(`TC-17 garbage update (${name}) → closed 1003; nothing stored`, async () => {
      const boardId = newBoardId();
      const a = await join(boardId);
      createSticky(a.doc, NOTE_AT);
      await a.barrier();
      const before = await inRoom(boardId, (storage) => blobRows(storage, 'updates'));
      const bad = await join(boardId);
      bad.sendRaw(syncFrame(syncProtocol.messageYjsUpdate, bytes()));
      expect(await bad.closed).toBe(CLOSE_UNSUPPORTED_DATA);
      await a.barrier();
      expect(await inRoom(boardId, (storage) => blobRows(storage, 'updates'))).toEqual(before);
      const probe = await join(boardId);
      expect(docJson(probe.doc)).toEqual(docJson(a.doc));
      closeAll(a, probe);
    });
  }

  it('TC-26 an SQL error while loading → clients closed 4500', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId); // story 5: tables exist only once the board was created
    await inRoom(boardId, (storage) => {
      // A table the loader cannot read (real SQLite error: no such column).
      storage.sql.exec('DROP TABLE snapshot_chunks');
      storage.sql.exec('CREATE TABLE snapshot_chunks (unexpected INTEGER)');
    });
    await restartRoom(boardId);
    const client = await connect(boardId);
    expect(await client.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await inRoom(boardId, (_s, room) => room.state)).toBe('load-failed');
  });
});

describe('persist.room: test hooks are absent unless TEST_HOOKS=1', () => {
  it('POST /__test/boards/:id/corrupt-snapshot is not handled and changes nothing', async () => {
    expect(env.TEST_HOOKS).toBeUndefined();
    const boardId = newBoardId();
    const a = await join(boardId);
    createSticky(a.doc, NOTE_AT);
    await a.barrier();
    a.close();
    const res = await SELF.fetch(`${ORIGIN}/__test/boards/${boardId}/corrupt-snapshot`, { method: 'POST' });
    const body = await res.text();
    expect(body).not.toContain('"result"');
    await expect(inRoom(boardId, (_s, room) => room.testCorruptSnapshot())).rejects.toThrow(/disabled/);
    const probe = await join(boardId);
    expect(snapshot(probe.doc)).toHaveLength(1);
    probe.close();
  });
});
