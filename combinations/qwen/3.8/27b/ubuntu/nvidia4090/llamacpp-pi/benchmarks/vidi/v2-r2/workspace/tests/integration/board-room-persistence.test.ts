/**
 * Persistent BoardRoom against real Durable Object sockets + SQLite
 * (design TC-12 to TC-18, TC-26).
 *
 * Real Worker + real Durable Object in workerd, real Y.Doc clients, real
 * protocol frames — no mocks. The live room instance is reached through
 * `runInDurableObject` to (a) inspect storage and (b) inject failures
 * (failing append / failing SELECT), drive the retry clock, and emulate a
 * post-eviction wake. workerd cannot be told to evict a DO mid-test, so
 * "reopen after everyone leaves" and "post-eviction wake" exercise the
 * room's own reload-from-storage path — the same code a cold construct runs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { chunkBytes } from '../../src/shared/storage-chunks';
import { bringToFront } from '../../src/shared/board-model';
import { BoardRoom } from '../../src/worker/board-room';
import { BoardSql, BoardStore, fromStorage } from '../../src/worker/board-store';
import { WsClient, sameNotes } from './fixtures/ws-client';
import {
  applySpecs,
  buildRetroBoard,
  retroNoteSpecs,
  scrambleUpdate,
  RETRO_NOTE_COUNT,
} from '../fixtures/boards';

const clients: WsClient[] = [];

function track(client: WsClient): WsClient {
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close();
  }
});

/** Runs `fn` on the board's live room instance (constructs it if needed). */
async function withRoomInstance<T>(
  boardId: string,
  fn: (instance: BoardRoom) => T | Promise<T>,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return await runInDurableObject<BoardRoom, T>(stub, (instance) => fn(instance));
}

/** Runs `fn` with a fresh BoardStore + raw SQL over the board's real storage. */
async function withStore<T>(
  boardId: string,
  fn: (store: BoardStore, sql: BoardSql) => T | Promise<T>,
): Promise<T> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return await runInDurableObject<BoardRoom, T>(stub, (_instance, state) => {
    const store = new BoardStore(fromStorage(state.storage));
    store.migrate();
    return fn(store, store.storage.sql);
  });
}

function rowCount(sql: BoardSql, table: string): number {
  return Number(sql.exec(`SELECT COUNT(*) AS c FROM ${table}`).one().c);
}

/** Builds the 25-note retro board on the client's doc (sent to the room). */
function buildRetroOnClient(client: WsClient): void {
  const ids = applySpecs(client.doc, retroNoteSpecs());
  bringToFront(client.doc, ids[22]);
  bringToFront(client.doc, ids[23]);
  bringToFront(client.doc, ids[24]);
}

/**
 * Writes the retro board's full state to storage as a snapshot (chunked,
 * `snapshot_through_seq` = 0, empty log). `corrupt` scrambles chunk 0.
 * `reload` makes the live room re-read storage afterwards, so the room's
 * in-memory state reflects what was just written.
 */
async function writeRetroSnapshot(
  boardId: string,
  corrupt: boolean,
  reload: boolean,
): Promise<void> {
  await withRoomInstance(boardId, async (instance) => {
    const doc = new Y.Doc();
    buildRetroBoard(doc);
    const full = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(full);
    const sql = instance.store.storage.sql;
    instance.store.storage.transactionSync(() => {
      sql.exec('DELETE FROM snapshot_chunks').toArray();
      chunks.forEach((data, idx) => {
        const toWrite = corrupt && idx === 0 ? scrambleUpdate(data) : data;
        sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, toWrite).toArray();
      });
      sql
        .exec(
          'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          'snapshot_through_seq',
          '0',
        )
        .toArray();
      sql.exec('DELETE FROM updates').toArray();
    });
    if (reload) {
      await instance.reload();
    }
  });
}

describe('TC-12 store before broadcast', () => {
  it('a note is in the update log and in a fresh doc loaded from storage', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    a.addNote('persisted note');
    await b.waitForObjects((o) => o.some((n) => n.text === 'persisted note'));

    let rows = 0;
    await withStore(board, (_store, sql) => {
      rows = rowCount(sql, 'updates');
    });
    expect(rows).toBeGreaterThanOrEqual(1);

    // A fresh doc loaded straight from storage contains the note.
    let loadedTexts: string[] = [];
    await withStore(board, (store) => {
      const fresh = new Y.Doc();
      expect(store.load(fresh).ok).toBe(true);
      const objects = fresh.getMap('objects');
      loadedTexts = Array.from(objects.values())
        .filter((v): v is Y.Map<any> => v instanceof Y.Map)
        .map((m) => {
          const t = m.get('text');
          return t instanceof Y.Text ? t.toString() : '';
        });
    });
    expect(loadedTexts).toContain('persisted note');
  });
});

describe('TC-13 reopen after everyone leaves', () => {
  it('a new client over the same storage sees the identical board', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    await a.waitForSync();
    buildRetroOnClient(a);
    await a.waitForObjects((o) => o.length === RETRO_NOTE_COUNT);
    const original = a.objects();
    expect(original).toHaveLength(RETRO_NOTE_COUNT);

    // Everyone leaves (self-initiated closes do not surface a close event on
    // the client side in this harness, so give the room a moment to hibernate).
    a.close();
    await new Promise((r) => setTimeout(r, 200));

    // A new client over the same storage (the room reloads from it on wake).
    const b = track(await WsClient.connect(board));
    await b.waitForSync();
    await b.waitForObjects((o) => o.length === RETRO_NOTE_COUNT);

    expect(sameNotes(b.objects(), original)).toBe(true);
  });
});

describe('TC-14 storage write failure', () => {
  it('append throwing resets the room (1011, no broadcast); reconnect re-sends and stores', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    // Make the next append throw once.
    await withRoomInstance(board, (instance) => {
      const realAppend = instance.store.append.bind(instance.store);
      let threw = false;
      instance.store.append = (update: Uint8Array): void => {
        if (!threw) {
          threw = true;
          throw new Error('injected append failure');
        }
        realAppend(update);
      };
    });

    const noteText = 'survives a storage failure';
    a.addNote(noteText);

    // Both sockets are closed with 1011; B never received the note.
    await a.waitForClose();
    await b.waitForClose();
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.objects().some((n) => n.text === noteText)).toBe(false);

    // A still holds the change locally; reconnect carrying its state.
    const aState = Y.encodeStateAsUpdate(a.doc);
    const a2 = track(await WsClient.connect(board, { initialState: aState }));
    const b2 = track(await WsClient.connect(board));
    await a2.waitForSync();
    await b2.waitForSync();

    // The change is now stored and delivered to B.
    await b2.waitForObjects((o) => o.some((n) => n.text === noteText));
    let rows = 0;
    await withStore(board, (_store, sql) => {
      rows = rowCount(sql, 'updates');
    });
    expect(rows).toBeGreaterThanOrEqual(1);
  });
});

describe('TC-15 damaged snapshot refuses to serve', () => {
  it('client is closed 4500 and an in-flight update stores nothing', async () => {
    const board = newBoardId();
    // Corrupt the snapshot and make the live room re-read it -> LoadFailed.
    await writeRetroSnapshot(board, true, true);

    // A client that carries the (healthy) board state.
    const doc = new Y.Doc();
    buildRetroBoard(doc);
    const client = track(
      await WsClient.connect(board, { initialState: Y.encodeStateAsUpdate(doc) }),
    );
    // An update in flight while the room is LoadFailed must store nothing.
    client.sendUpdateFrame(Y.encodeStateAsUpdate(doc));
    await client.waitForClose();
    expect(client.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    let rows = 0;
    await withStore(board, (_store, sql) => {
      rows = rowCount(sql, 'updates');
    });
    expect(rows).toBe(0);
  });
});

describe('TC-16 load retry interval boundary', () => {
  it('too-early reconnect gets 4500 without a reload; after the interval it loads and syncs', async () => {
    const board = newBoardId();
    // Corrupt the snapshot in storage.
    await writeRetroSnapshot(board, true, false);

    // Present the room as LoadFailed with a known, fresh attempt time.
    const t0 = Date.now();
    await withRoomInstance(board, (instance) => {
      instance.state = 'load-failed';
      instance.loadFailureReason = 'snapshot-unreadable';
      instance.lastLoadAttemptMs = t0;
    });

    // Connect before the interval: 4500 and no reload attempt (clock unchanged).
    const c1 = track(await WsClient.connect(board));
    await c1.waitForClose();
    expect(c1.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    let clockAfterC1 = 0;
    await withRoomInstance(board, (instance) => {
      clockAfterC1 = instance.lastLoadAttemptMs;
    });
    expect(clockAfterC1).toBe(t0);

    // Repair the storage (the room stays LoadFailed until a retry is due).
    await writeRetroSnapshot(board, false, false);

    // Make the retry due.
    await withRoomInstance(board, (instance) => {
      instance.lastLoadAttemptMs = Date.now() - 10 * 60 * 1000;
    });

    // Connect after the interval: the room reloads (storage is healthy) and syncs.
    const c2 = track(await WsClient.connect(board));
    await c2.waitForSync();
    await c2.waitForObjects((o) => o.length === RETRO_NOTE_COUNT);
    expect(c2.objects()).toHaveLength(RETRO_NOTE_COUNT);
  });
});

describe('TC-17 garbage update is rejected and not stored', () => {
  it('a decodable-but-invalid sync frame closes 1003 and leaves the log unchanged', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    a.addNote('real note');
    // Wait until the note is stored + broadcast (B sees it) so the log is stable.
    await b.waitForObjects((o) => o.some((n) => n.text === 'real note'));
    let before = 0;
    await withStore(board, (_store, sql) => {
      before = rowCount(sql, 'updates');
    });
    expect(before).toBeGreaterThanOrEqual(1);

    // Valid outer envelope (MESSAGE_SYNC) wrapping a garbage sync sub-message.
    const inner = new Uint8Array([9, 0xff, 0xfe, 0xfd]);
    const frame = new Uint8Array([0, inner.byteLength, ...inner]);
    a.sendRaw(frame);
    await a.waitForClose();
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    let after = 0;
    await withStore(board, (_store, sql) => {
      after = rowCount(sql, 'updates');
    });
    expect(after).toBe(before);
  });
});

describe('TC-18 hibernation: pre-rebuild sockets keep receiving', () => {
  it('after a reload, an update to a socket accepted earlier is delivered via getWebSockets', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();
    a.addNote('before rebuild');
    await b.waitForObjects((o) => o.some((n) => n.text === 'before rebuild'));

    // Emulate an eviction + wake: rebuild the room from storage while the
    // ctx-accepted sockets survive.
    await withRoomInstance(board, (instance) => instance.reload());

    const after = 'after rebuild';
    a.addNote(after);
    await b.waitForObjects((o) => o.some((n) => n.text === after));
    expect(b.objects().some((n) => n.text === 'before rebuild')).toBe(true);
  });
});

describe('TC-26 SQL read error on load', () => {
  it('a failing SELECT during load closes the client 4500', async () => {
    const board = newBoardId();
    // Seed a real board so the failing load is over data, not an empty board.
    const a = track(await WsClient.connect(board));
    await a.waitForSync();
    buildRetroOnClient(a);
    await a.waitForObjects((o) => o.length === RETRO_NOTE_COUNT);

    // Make the snapshot SELECT throw and present the room as woken (hibernated).
    await withRoomInstance(board, (instance) => {
      const realExec = instance.store.storage.sql.exec.bind(instance.store.storage.sql);
      instance.store.storage.sql = {
        exec: (query: string, ...bindings: unknown[]) => {
          if (/SELECT .* FROM snapshot_chunks/i.test(query)) {
            throw new Error('injected SQL read failure');
          }
          return realExec(query, ...bindings);
        },
        databaseSize: 0,
      };
      // A new connection will wake (reload); the wake's snapshot SELECT throws.
      instance.state = 'hibernated';
    });

    const c = track(await WsClient.connect(board));
    await c.waitForClose();
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});
