import { describe, it, expect, beforeEach } from 'vitest';
import {
  SELF,
  env,
  runInDurableObject,
  evictDurableObject,
  reset,
} from 'cloudflare:test';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { BoardRoom } from '../../src/worker/board-room';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { PERSIST_TESTED_NOTES, COMPACTION_UPDATE_COUNT } from '../../src/shared/config';

/**
 * Story 4 — persistent-room integration tests (TC-12 to TC-18, TC-26).
 *
 * These run against the in-process workerd pool, so they can both drive real
 * WebSocket traffic (via `SELF.fetch` upgrade + `response.webSocket`) and inspect
 * the room's SQLite storage (via `runInDurableObject`). All Yjs encoding is done
 * with the no-argument `Y.encodeStateAsUpdate(doc)` form: the workerd pool's Yjs
 * build throws on the `(doc, [])` overload, so the no-arg form is used everywhere.
 */

// --- framing / sync helpers -------------------------------------------------

function syncFrame(payload: Uint8Array): Uint8Array {
  const f = new Uint8Array(1 + payload.length);
  f[0] = MESSAGE_SYNC;
  f.set(payload, 1);
  return f;
}

/** A note update, framed for the wire (no-arg encode). */
function noteUpdate(x: number, y: number, color: string): Uint8Array {
  const doc = new Y.Doc();
  createSticky(doc, { x, y }, color as never);
  const u = Y.encodeStateAsUpdate(doc);
  const enc = createEncoder();
  sync.writeUpdate(enc, u);
  return syncFrame(toUint8Array(enc));
}

/** An empty SyncStep1, used by a joiner to request the room's full state. */
function emptySyncStep1(): Uint8Array {
  const doc = new Y.Doc();
  const enc = createEncoder();
  sync.writeSyncStep1(enc, doc);
  return syncFrame(toUint8Array(enc));
}

interface Client {
  ws: any;
  frames: Uint8Array[];
  boardId: string;
  closeInfo: { code: number };
}

async function connect(boardId: string): Promise<Client> {
  const res = await SELF.fetch(
    new Request(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    }),
  );
  const ws: any = (res as any).webSocket;
  ws.accept();
  ws.binaryType = 'arraybuffer';
  const frames: Uint8Array[] = [];
  const closeInfo = { code: 0 };
  ws.onmessage = (e: any) => frames.push(new Uint8Array(e.data));
  ws.onclose = (e: any) => {
    closeInfo.code = e.code;
  };
  return { ws, frames, boardId, closeInfo };
}

/** Applies a client's received sync frames to a fresh doc. */
function applyFrames(frames: Uint8Array[]): { notes: number; texts: Record<string, string> } {
  const doc = new Y.Doc();
  for (const f of frames) {
    if (f[0] !== MESSAGE_SYNC) continue;
    const decoder = createDecoder(f.slice(1));
    const reply = createEncoder();
    sync.readSyncMessage(decoder, reply, doc, null, () => {});
  }
  const texts: Record<string, string> = {};
  for (const s of snapshot(doc)) texts[s.id] = s.text;
  return { notes: doc.getMap('objects').size, texts };
}

interface InspectResult {
  updateRows: number;
  freshNotes: number;
  events: string[];
}

async function inspect(boardId: string): Promise<InspectResult> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject<BoardRoom, InspectResult>(stub, (room) => {
    const sql = (room as any).state.storage.sql;
    return {
      updateRows: sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c,
      freshNotes: (() => {
        const d = new Y.Doc();
        (room as any).store.load(d);
        return d.getMap('objects').size;
      })(),
      events: (room as any).__testEvents.slice(),
    };
  });
}

/** Sets a room test hook (e.g. __testFailAppend) by id. */
async function setHook(boardId: string, hook: (room: BoardRoom) => void): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject<BoardRoom, void>(stub, (room) => hook(room));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates a board via the real API (story 5): rooms can no longer be created
 * implicitly by connecting, so every test creates its board first.
 * (TC-16 keeps a raw `newBoardId()` + direct storage write: it exercises the
 * legacy-board path, updates rows without `created_at`.)
 */
async function createBoardId(): Promise<string> {
  const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  await reset();
});

// --- tests ------------------------------------------------------------------

describe('persistent room (story 4)', () => {
  it('TC-12: an edit is stored before it is observed, and a fresh load has it', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);

    // A creates a note and sends it.
    a.ws.send(noteUpdate(1, 1, 'yellow'));
    // Give the room time to apply + persist + (not) broadcast.
    await sleep(300);

    // The update is in storage...
    const after = await inspect(boardId);
    expect(after.updateRows).toBeGreaterThanOrEqual(1);
    // ...and a fresh doc loaded from storage contains the note.
    expect(after.freshNotes).toBe(1);

    // A second client now sees the note.
    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(300);
    const bState = applyFrames(b.frames);
    expect(bState.notes).toBe(1);
    a.ws.close();
    b.ws.close();
  }, 30000);

  it('TC-13: a board survives everyone disconnecting', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);
    a.ws.send(noteUpdate(2, 2, 'pink'));
    await sleep(300);
    a.ws.close();
    await sleep(200);

    // Everyone is gone. The data is in storage.
    const after = await inspect(boardId);
    expect(after.freshNotes).toBe(1);

    // A new client reconnects and finds the note.
    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(300);
    expect(applyFrames(b.frames).notes).toBe(1);
    b.ws.close();
  }, 30000);

  it('TC-14: a late joiner receives the full existing state', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);
    for (let i = 0; i < 3; i++) a.ws.send(noteUpdate(i, i, 'blue'));
    await sleep(400);

    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(400);
    const bState = applyFrames(b.frames);
    expect(bState.notes).toBe(3);
    a.ws.close();
    b.ws.close();
  }, 30000);

  it('TC-15: two creators at once — both notes are kept', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    const b = await connect(boardId);
    await sleep(200);

    a.ws.send(noteUpdate(0, 0, 'yellow'));
    b.ws.send(noteUpdate(9, 9, 'green'));
    await sleep(500);

    const info = await inspect(boardId);
    expect(info.freshNotes).toBe(2);

    // Both clients see both notes.
    a.ws.send(emptySyncStep1());
    b.ws.send(emptySyncStep1());
    await sleep(400);
    expect(applyFrames(a.frames).notes).toBe(2);
    expect(applyFrames(b.frames).notes).toBe(2);
    a.ws.close();
    b.ws.close();
  }, 30000);

  it('TC-16: a service restart keeps the board (evict + reconnect)', async () => {
    const boardId = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

    // Write a note to storage with no sockets open (so eviction is clean).
    await runInDurableObject<BoardRoom, void>(stub, (room) => {
      (room as any).store.migrate();
      const doc = new Y.Doc();
      createSticky(doc, { x: 3, y: 3 }, 'violet');
      (room as any).store.append(Y.encodeStateAsUpdate(doc));
    });

    // Simulate a service restart: evict the DO instance (memory wiped).
    await evictDurableObject(stub);

    // A new client reconnects; the room reloads from storage.
    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(400);
    expect(applyFrames(b.frames).notes).toBe(1);
    const info = await inspect(boardId);
    expect(info.freshNotes).toBe(1);
    b.ws.close();
  }, 30000);

  it('TC-17: a storage failure closes every socket with 1011', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);

    // Inject a storage failure on the next append.
    await setHook(boardId, (room) => {
      room.__testFailAppend = true;
    });

    a.ws.send(noteUpdate(4, 4, 'orange'));
    await sleep(400);

    // The socket was closed with CLOSE_STORAGE_FAILURE.
    expect(a.closeInfo?.code).toBe(CLOSE_STORAGE_FAILURE);
    const info = await inspect(boardId);
    expect(info.events.some((e) => e.startsWith('state:storage-failed'))).toBe(true);
  }, 30000);

  it('TC-18: a large board is delivered whole to a late joiner', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);

    // Build a large board as many small updates (one note each).
    for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
      a.ws.send(noteUpdate((i % 20) * 30, Math.floor(i / 20) * 30, 'yellow'));
    }
    await sleep(1500);

    const info = await inspect(boardId);
    expect(info.freshNotes).toBe(PERSIST_TESTED_NOTES);

    // A late joiner receives all of them.
    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(1500);
    expect(applyFrames(b.frames).notes).toBe(PERSIST_TESTED_NOTES);
    a.ws.close();
    b.ws.close();
  }, 60000);

  it('TC-26: compaction during activity — a late joiner still gets the truth', async () => {
    const boardId = await createBoardId();
    const a = await connect(boardId);
    await sleep(150);

    // Push enough updates to trigger compaction (COMPACTION_UPDATE_COUNT).
    for (let i = 0; i < COMPACTION_UPDATE_COUNT + 5; i++) {
      a.ws.send(noteUpdate((i % 10) * 40, Math.floor(i / 10) * 40, 'pink'));
    }
    await sleep(2000);

    const total = COMPACTION_UPDATE_COUNT + 5;
    const info = await inspect(boardId);
    expect(info.freshNotes).toBe(total);

    const b = await connect(boardId);
    b.ws.send(emptySyncStep1());
    await sleep(2000);
    expect(applyFrames(b.frames).notes).toBe(total);
    a.ws.close();
    b.ws.close();
  }, 60000);
});
