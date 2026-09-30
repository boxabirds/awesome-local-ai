import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import WebSocket from 'ws';
import { startServer, stopServer, URL, createBoard } from './server';
import {
  createTestClient,
  connectRaw,
  waitForCondition,
  sendRaw,
  type TestClient,
} from './ws-client';
import { createSticky, snapshot, initDoc } from '../../src/shared/board-model';
import { MESSAGE_SYNC, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

// ---------------------------------------------------------------------------
// Hook helpers
// ---------------------------------------------------------------------------

async function sqlHook(boardId: string, query: string, params: any[] = []): Promise<any[][]> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`sql hook failed: ${body.detail}`);
  return body.rows;
}

async function storeHook(boardId: string, op: string, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...extra }),
  });
  return res.json();
}

async function corruptHook(boardId: string): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/corrupt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
}

async function repairHook(boardId: string): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/repair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
}

async function faultsHook(boardId: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/faults`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * Simulates hibernation + reconstruction: discards the room's in-memory state
 * and reloads from storage like the constructor would. (`wrangler dev` keeps
 * DO instances alive, so a real "fresh instance" requires this.)
 */
async function resetHook(boardId: string): Promise<any> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
}

function updateCount(rows: any[][]): number {
  return Number(rows[0]?.[0] ?? 0);
}

async function countUpdates(boardId: string): Promise<number> {
  return updateCount(await sqlHook(boardId, 'SELECT COUNT(*) FROM updates'));
}

/** Waits until `client`'s doc contains `count` notes. */
async function waitForNotes(client: TestClient, count: number, timeoutMs = 10000): Promise<void> {
  await waitForCondition(() => snapshot(client.doc).length >= count, timeoutMs, `${count} notes on client`);
}

/**
 * Connects, retrying while the room is mid-reload (it answers 4500 until the
 * reload finishes). The room's wake-reload is async, so a connection racing
 * it gets a fast 4500 close.
 */
async function connectUntilReady(boardId: string, doc?: Y.Doc, attempts = 15): Promise<TestClient> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await createTestClient(URL, boardId, doc);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`could not connect to ${boardId} after ${attempts} attempts: ${String(lastErr)}`);
}

/** A note's text, found by id prefix match in the snapshot. */
function noteWithText(doc: Y.Doc, text: string) {
  return snapshot(doc).find((n) => n.text === text);
}

/**
 * Seeds a board with `n` notes through a real client, then destroys the
 * client (so the board exists only in storage).
 */
async function seedBoard(boardId: string, n: number): Promise<Y.Doc> {
  const client = await createTestClient(URL, boardId);
  initDoc(client.doc);
  for (let i = 0; i < n; i++) {
    createSticky(client.doc, { x: 100 + i * 120, y: 100 + (i % 5) * 120 }, 'yellow');
  }
  // Give the server time to append everything.
  await new Promise((r) => setTimeout(r, 300));
  const doc = client.doc;
  client.destroy();
  // Let the room hibernate so the next connection is a fresh instance.
  await new Promise((r) => setTimeout(r, 500));
  return doc;
}

// Builds a y-websocket sync frame carrying an *update* (type 2) with raw
// bytes. Framing matches the protocol: [MESSAGE_SYNC][raw payload] (no
// length prefix on the sync payload).
function syncUpdateFrame(updateBytes: Uint8Array): Uint8Array {
  const inner = encoding.createEncoder();
  encoding.writeVarUint(inner, 2); // y-protocols sync message: update
  encoding.writeVarUint8Array(inner, updateBytes);
  return frameSyncRaw(encoding.toUint8Array(inner));
}

/** [MESSAGE_SYNC varuint][raw payload] frame. */
function frameSyncRaw(payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  const header = encoding.toUint8Array(enc);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

describe('Persistent room: durability, failures, hibernation (story 4)', () => {
  beforeAll(async () => {
    await startServer();
  }, 60000);
  afterAll(async () => {
    await stopServer();
  });

  it('TC-12: by the time B observes A\'s note, the updates row exists and storage contains it', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    initDoc(a.doc);
    createSticky(a.doc, { x: 300, y: 200 }, 'green');
    // The note we just created is the last one in the snapshot.
    const note = snapshot(a.doc)[snapshot(a.doc).length - 1];

    const b = await createTestClient(URL, boardId);
    await waitForNotes(b, 1);

    // By now the update must be durable.
    const rows = await sqlHook(boardId, 'SELECT COUNT(*) FROM updates');
    expect(updateCount(rows)).toBeGreaterThanOrEqual(1);

    // A fresh doc loaded from storage contains the note.
    const load = await storeHook(boardId, 'load');
    expect(load.ok).toBe(true);
    expect(load.notes.some((n: any) => n.id === note.id)).toBe(true);
    expect(noteWithText(b.doc, note.text)).toBeTruthy();

    a.destroy();
    b.destroy();
  });

  it('TC-13: everyone leaves; a fresh room instance over the same storage sees the snapshot', async () => {
    const boardId = await createBoard();
    const original = await seedBoard(boardId, 6);
    const originalNotes = snapshot(original);
    expect(originalNotes).toHaveLength(6);

    // Everyone has left; the room hibernates and is reconstructed on the
    // next connection (simulated by the reset hook in wrangler dev).
    const r = await resetHook(boardId);
    expect(r.ok).toBe(true);
    expect(r.state).toBe('ready');

    const b = await createTestClient(URL, boardId);
    await waitForNotes(b, 6);
    expect(snapshot(b.doc)).toEqual(originalNotes);
    b.destroy();
  });

  it('TC-14: append failure closes both 1011, B never got the note; A reconnects holding it → stored and delivered', async () => {
    const boardId = await createBoard();
    // Arm the one-shot append failure: the room's update handler reads the
    // fault registry live, so it works for an already-constructed room.
    const f = await faultsHook(boardId, { appendFailures: 1 });
    expect(f.ok).toBe(true);

    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);
    // This append consumes the injected failure → both sockets closed 1011
    // before the note below is ever delivered.
    initDoc(a.doc);
    const before = await countUpdates(boardId);

    // This append hits the injected failure.
    createSticky(a.doc, { x: 400, y: 300 }, 'blue');
    const note = snapshot(a.doc)[snapshot(a.doc).length - 1];

    // Both sockets are closed with 1011.
    await waitForCondition(() => a.closeCode === CLOSE_STORAGE_FAILURE, 10000, 'A closed 1011');
    await waitForCondition(() => b.closeCode === CLOSE_STORAGE_FAILURE, 10000, 'B closed 1011');

    // B never received the note (store-before-broadcast: no broadcast on failure).
    expect(noteWithText(b.doc, note.text)).toBeUndefined();

    // Nothing new was stored for the failed note.
    expect(await countUpdates(boardId)).toBe(before);

    // A reconnects still holding the change (same doc). The room reloads
    // (empty), A re-sends the note via SyncStep2, it is stored this time.
    const a2 = await connectUntilReady(boardId, a.doc);
    const b2 = await connectUntilReady(boardId);
    await waitForNotes(b2, 1);
    expect(noteWithText(b2.doc, note.text)).toBeTruthy();
    expect(await countUpdates(boardId)).toBeGreaterThan(before);

    // Clear the fault config for subsequent tests.
    await faultsHook(boardId, { reset: true });
    a.destroy();
    b.destroy();
    a2.destroy();
    b2.destroy();
  });

  it('TC-15: corrupted snapshot → client closed 4500; a SyncStep2 sent before close stores nothing', async () => {
    const boardId = await createBoard();
    await seedBoard(boardId, 4);
    const c = await corruptHook(boardId);
    expect(c.ok).toBe(true);

    // Reconstruct the room over the corrupted storage → load fails.
    const r = await resetHook(boardId);
    expect(r.ok).toBe(true);
    expect(r.state).toBe('load-failed');

    // Connect raw and immediately push a sync update frame; the room is
    // load-failed, so it closes 4500 and must not store anything.
    const wsUrl = URL.replace('http', 'ws') + `/api/rooms/${boardId}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    const closed = new Promise<{ code: number }>((resolve) => {
      ws.on('close', (code: number) => resolve({ code }));
    });
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    // A non-empty "update" frame (garbage is fine — it must not be stored).
    // Resend every 300ms until the close arrives: frames sent immediately
    // after the upgrade can be dropped by the runtime.
    const frame = syncUpdateFrame(new Uint8Array([1, 2, 3, 4, 5]));
    const resender = setInterval(() => {
      try {
        if (ws.readyState === 1) ws.send(frame);
      } catch {
        // socket already closing
      }
    }, 300);
    setTimeout(() => {
      try {
        if (ws.readyState === 1) ws.send(frame);
      } catch { /* ignore */ }
    }, 50);
    const { code } = await Promise.race([
      closed,
      new Promise<{ code: number }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for 4500')), 10000)
      ),
    ]);
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Nothing new was stored (the seeded 4 notes' updates were compacted away
    // by the corrupt hook's force-compact, so the log should be empty).
    clearInterval(resender);
    expect(await countUpdates(boardId)).toBe(0);
    ws.close();
  });

  it('TC-16: connect before the retry interval → 4500 without reload; after repair + interval → loads', async () => {
    const boardId = await createBoard();
    const original = await seedBoard(boardId, 5);
    const originalNotes = snapshot(original);
    const c = await corruptHook(boardId);
    expect(c.ok).toBe(true);

    // Reconstruct over the corrupted storage: the load fails → 4500.
    const r0 = await resetHook(boardId);
    expect(r0.state).toBe('load-failed');
    const r1 = await connectRaw(URL, boardId);
    expect(r1.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair storage immediately.
    const rp = await repairHook(boardId);
    expect(rp.ok).toBe(true);

    // Still within LOAD_RETRY_MIN_INTERVAL_MS of the failed attempt: no reload
    // is attempted, so the room still refuses with 4500 even though storage is
    // healthy now.
    const r2 = await connectRaw(URL, boardId);
    expect(r2.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Wait out the retry interval (measured from the first failed attempt).
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 500));

    // Now a reload is attempted and succeeds.
    const client = await connectUntilReady(boardId);
    await waitForNotes(client, 5);
    expect(snapshot(client.doc)).toEqual(originalNotes);
    client.destroy();
  }, 30000);

  it('TC-17: garbage update → closed 1003, row count unchanged', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    initDoc(a.doc);
    const before = await countUpdates(boardId);

    // A sync frame whose "update" payload is not a valid Yjs update.
    sendRaw(a, syncUpdateFrame(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01])));

    await waitForCondition(() => a.closeCode === CLOSE_UNSUPPORTED_DATA, 10000, 'A closed 1003');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await countUpdates(boardId)).toBe(before);
    a.destroy();
  });

  it('TC-18: after the room is reconstructed, messages reach sockets via ctx.getWebSockets()', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    initDoc(a.doc);
    createSticky(a.doc, { x: 100, y: 100 }, 'yellow');
    await new Promise((r) => setTimeout(r, 300));

    // A leaves → the room hibernates and is reconstructed on the next wake
    // (simulated by the reset hook in wrangler dev).
    a.destroy();
    const r = await resetHook(boardId);
    expect(r.state).toBe('ready');

    // B wakes the room (fresh instance, loads the note).
    const b = await createTestClient(URL, boardId);
    await waitForNotes(b, 1);

    // A comes back into the reconstructed room.
    const a2 = await createTestClient(URL, boardId);
    await waitForNotes(a2, 1);

    // B creates a note; the reconstructed room must deliver it to A's socket.
    const secondId = createSticky(b.doc, { x: 500, y: 500 }, 'pink');
    expect(secondId).toBeTruthy();
    await waitForCondition(
      () => snapshot(a2.doc).some((n) => n.id === secondId),
      10000,
      'A2 receives B\'s note'
    );

    a2.destroy();
    b.destroy();
  });

  it('TC-26: load SELECT throws → room closes clients with 4500', async () => {
    const boardId = await createBoard();
    // Make every SELECT that reads the snapshot chunks throw. This hits
    // BoardStore.load's first read → sql-error → load-failed.
    const f = await faultsHook(boardId, { failSelectsMatching: 'FROM snapshot_chunks' });
    expect(f.ok).toBe(true);

    // Reconstruct with the fault armed: the load's SELECT throws.
    const r0 = await resetHook(boardId);
    expect(r0.state).toBe('load-failed');

    const r1 = await connectRaw(URL, boardId);
    expect(r1.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Clear the fault and verify the room recovers after the retry interval.
    const reset = await faultsHook(boardId, { reset: true });
    expect(reset.ok).toBe(true);
    await new Promise((r) => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 500));
    const client = await connectUntilReady(boardId);
    expect(snapshot(client.doc)).toEqual([]);
    client.destroy();
  }, 30000);
});
