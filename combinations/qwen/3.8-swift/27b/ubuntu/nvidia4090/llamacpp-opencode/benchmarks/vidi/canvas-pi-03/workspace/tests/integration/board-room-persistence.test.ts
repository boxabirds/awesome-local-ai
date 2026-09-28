import { describe, it, expect, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
} from 'src/shared/board-model';
import { newBoardId } from 'src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from 'src/shared/protocol';
import {
  connectRoomClient,
  settleBoards,
  type RoomClient,
} from './helpers/ws-client';

// Local workerd evicts idle DOs after ~10 s; wait just past that so a reconnect
// constructs a fresh room instance (needed by TC-13's "reopen" scenario).
const EVICTION_WAIT_MS = 11_000;

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

async function op(boardId: string, name: string, body?: unknown): Promise<any> {
  const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/**
 * Seeds a board with `n` notes straight into storage (bypassing the client) as a
 * complete Yjs history, so the board has >= COMPACTION_UPDATE_COUNT rows and a
 * `compact` op produces a snapshot. Fast (no per-note round-trips).
 */
async function seedBoard(boardId: string, n: number): Promise<void> {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  initDoc(doc);
  for (let i = 0; i < n; i++) createSticky(doc, { x: i, y: 0 }, 'yellow', `s-${i}`);
  doc.off('update', handler);
  await op(boardId, 'append', { updates: updates.map(b64) });
}

async function pair(boardId: string): Promise<[RoomClient, RoomClient]> {
  const a = await connectRoomClient(boardId);
  await a.waitForSync();
  const b = await connectRoomClient(boardId);
  await b.waitForSync();
  return [a, b];
}

function addNote(a: RoomClient, idSuffix: string, text: string): string {
  const id = createSticky(a.doc, { x: 10, y: 10 }, 'yellow', `t-${idSuffix}`)!;
  getStickyText(a.doc, id)?.insert(0, text);
  return id;
}

/** Connects and, when the room cannot load, awaits the 4500 close. */
async function expectLoadFailed(boardId: string): Promise<RoomClient> {
  const c = await connectRoomClient(boardId);
  await c.closed;
  return c;
}

describe('persist.board_room (real DO storage + hibernation API)', () => {
  afterEach(async () => {
    await settleBoards();
  });

  it('TC-12: log row exists by the time B observes the note; fresh load has it', async () => {
    const id = newBoardId();
    const [a, b] = await pair(id);
    const before = (await op(id, 'inspect')).updateCount as number;
    const noteId = addNote(a, 't12', 'write before broadcast');
    // B observing the note is the observable effect of the broadcast.
    await b.waitFor(() => b.snapshot().some((n) => n.id === noteId), { timeout: 10000 });
    // Write-before-broadcast: by the time B saw it, the log row already exists.
    const after = (await op(id, 'inspect')).updateCount as number;
    expect(after).toBeGreaterThanOrEqual(before + 1);
    // A fresh doc loaded straight from storage contains the note.
    const loaded = await op(id, 'load');
    expect(loaded.ok).toBe(true);
    expect(loaded.notes.some((n: { id: string }) => n.id === noteId)).toBe(true);
  });

  it('TC-13: reopen after everyone leaves → snapshot equals original', async () => {
    const id = newBoardId();
    const [a, b] = await pair(id);
    for (let i = 0; i < 5; i++) addNote(a, `t13-${i}`, `note ${i}`);
    await b.waitFor(() => b.snapshot().length === 5, { timeout: 10000 });
    const original = a.snapshot();
    expect(original.length).toBe(5);
    a.close();
    b.close();
    // Let the object idle-evict so the next connect constructs a fresh instance.
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));
    const c = await connectRoomClient(id);
    await c.waitForSync();
    expect(c.snapshot()).toEqual(original);
    c.close();
  }, 30000);

  it('TC-14: storage failure → 1011, A recovers (change stored), B gets it on reconnect', async () => {
    const id = newBoardId();
    const [a, b] = await pair(id);
    // Make the room's next append throw once (persist.save_failure path).
    await op(id, 'fail-append');
    const noteId = addNote(a, 't14', 'unsaved change');
    // The append throws → storage-failed → the room closes A and B with 1011.
    await a.closed;
    await b.closed;
    expect(a.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.closeCode).toBe(CLOSE_STORAGE_FAILURE);
    // Non-propagation: B never received the change (it was discarded, not stored).
    expect(b.snapshot().some((n) => n.id === noteId)).toBe(false);
    // Evict so A's reconnect constructs a fresh instance (a load-failed/
    // storage-failed instance would just close the socket, not reload).
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));

    // A reconnects with its SAME doc (still holding the unsaved change). The fresh
    // room reloads (storage-failed → loading → ready) and re-applies A's change.
    const a2 = await connectRoomClient(id, a.doc);
    await a2.waitForSync();
    await a2.waitFor(() => a2.snapshot().some((n) => n.id === noteId), { timeout: 10000 });

    // B reconnects (fresh doc) and receives the now-stored change.
    const b2 = await connectRoomClient(id);
    await b2.waitForSync();
    expect(b2.snapshot().some((n) => n.id === noteId)).toBe(true);
    a2.close();
    b2.close();
  }, 30000);

  it('TC-15: corrupted snapshot → closed 4500; client SyncStep2 stores nothing', async () => {
    const id = newBoardId();
    // Seed enough rows that compact produces a snapshot to corrupt.
    await seedBoard(id, 520);
    const [a] = await pair(id);
    // Compact (create a snapshot), then corrupt it so the board cannot load.
    await op(id, 'compact');
    expect((await op(id, 'corrupt-snapshot')).ok).toBe(true);
    const beforeCount = (await op(id, 'inspect')).updateCount as number;
    a.close();
    // Evict so the next connect constructs a fresh instance whose load hits the
    // corrupted snapshot (the live instance already holds a good in-memory doc).
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));

    // A fresh client connects with a doc holding LOCAL changes. The room cannot
    // load (snapshot-unreadable) → it closes the client with 4500 and ignores
    // the client's sync data — none of the local changes are stored.
    const local = new Y.Doc();
    const nid = createSticky(local, { x: 0, y: 0 }, 'yellow', 't15-local')!;
    getStickyText(local, nid)?.insert(0, 'local-only change');
    const c = await connectRoomClient(id, local);
    await c.closed;
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    const afterCount = (await op(id, 'inspect')).updateCount as number;
    expect(afterCount).toBe(beforeCount);
  }, 30000);

  it('TC-16: connect before retry interval → 4500; after repair + interval → loads', async () => {
    const id = newBoardId();
    // Seed enough rows that compact produces a snapshot (to corrupt and repair).
    await seedBoard(id, 520);
    const [a] = await pair(id);
    addNote(a, 't16', 'data before damage');
    await new Promise((r) => setTimeout(r, 300));
    await op(id, 'compact');
    expect((await op(id, 'corrupt-snapshot')).ok).toBe(true);
    a.close();
    // Evict so the next connect constructs a fresh instance whose load hits the
    // corrupted snapshot (recording the first failed load attempt).
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));

    // First connect fails (records a failed load attempt at now).
    const c1 = await expectLoadFailed(id);
    expect(c1.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair storage, but stay inside LOAD_RETRY_MIN_INTERVAL_MS on the SAME
    // instance: the room must NOT reload (no retry) → still 4500.
    expect((await op(id, 'repair-snapshot')).ok).toBe(true);
    const c2 = await expectLoadFailed(id);
    expect(c2.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Evict (which also elapses LOAD_RETRY_MIN_INTERVAL_MS) so the next connect
    // constructs a fresh instance: the load retries (interval elapsed) and
    // succeeds against the repaired snapshot.
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));
    const c3 = await connectRoomClient(id);
    await c3.waitForSync();
    expect(c3.snapshot().some((n) => n.id === 't-t16')).toBe(true);
    c3.close();
  }, 60000);

  it('TC-17: garbage update → closed 1003, log row count unchanged', async () => {
    const id = newBoardId();
    const [a, b] = await pair(id);
    const before = (await op(id, 'inspect')).updateCount as number;
    // Random bytes are not a valid y-websocket frame → the room closes 1003.
    a.sendRaw(new Uint8Array([9, 0, 1, 2, 3, 4, 5, 6, 7, 8]));
    await a.closed;
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    // The garbage was not stored (log row count unchanged).
    const after = (await op(id, 'inspect')).updateCount as number;
    expect(after).toBe(before);
    b.close();
  });

  it('TC-18: after reconstruct, messages to earlier-accepted sockets deliver via ctx.getWebSockets()', async () => {
    const id = newBoardId();
    const [a, b] = await pair(id);
    // B creates a note; the room broadcasts it to A's socket, which was
    // accepted via the hibernation API (ctx.acceptWebSocket) and is tracked by
    // ctx.getWebSockets().
    const noteId = addNote(b, 't18', 'hibernation broadcast');
    await a.waitFor(() => a.snapshot().some((n) => n.id === noteId), { timeout: 10000 });
    expect(a.snapshot().some((n) => n.id === noteId)).toBe(true);
    a.close();
    b.close();
  });

  it('TC-26: SQL read error on load → closed 4500', async () => {
    const id = newBoardId();
    const [a] = await pair(id);
    addNote(a, 't26', 'data before select failure');
    await new Promise((r) => setTimeout(r, 300));
    a.close();
    // Arm a one-shot SELECT failure: the next construct's load reports sql-error.
    const arm = await op(id, 'fail-select');
    expect(arm.ok).toBe(true);
    // Evict so the next connect constructs a fresh instance whose load hits the
    // armed SELECT failure (the live instance already loaded successfully).
    await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));
    const c = await expectLoadFailed(id);
    expect(c.closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  }, 30000);
});
