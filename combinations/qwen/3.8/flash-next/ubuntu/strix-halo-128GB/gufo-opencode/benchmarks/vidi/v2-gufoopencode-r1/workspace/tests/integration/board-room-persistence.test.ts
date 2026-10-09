import { afterAll, beforeAll, expect, test } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createTestHarness } from 'wrangler';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import { writeSyncStep2 } from 'y-protocols/sync';
import type { TestHarness, WorkerHandle } from 'wrangler';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_SYNC,
  SYNC_UPDATE
} from '../../src/shared/protocol';
import { TestClient, createBoardId, rawSocket, waitFor } from './ws-client';

// Real BoardRoom over real Durable Object SQLite storage, driven through
// websockets and the /__test/ hooks (TEST_HOOKS=1 in this harness only).
let harness: TestHarness;
let worker: WorkerHandle;
let base = '';
let port = 0;

beforeAll(async () => {
  harness = createTestHarness({
    workers: [
      {
        config: {
          name: 'room-persistence-test',
          main: 'src/worker/index.ts',
          compatibility_date: '2026-09-17',
          durable_objects: { bindings: [{ name: 'BOARD_ROOM', class_name: 'BoardRoom' }] },
          migrations: [{ tag: 'v1', new_sqlite_classes: ['BoardRoom'] }],
          vars: { TEST_HOOKS: '1' }
        }
      }
    ]
  });
  const { url } = await harness.listen();
  base = url.toString().replace(/\/$/, '');
  port = Number(url.port);
  worker = harness.getWorker('room-persistence-test');
}, 180_000);

afterAll(async () => {
  await harness.close();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hook(boardId: string, action: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/__test/boards/${boardId}/${action}`, { method: 'POST' });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function rowCount(boardId: string, table: string): Promise<number> {
  const sql = (await worker.getDurableObjectStorage('BOARD_ROOM', { name: boardId })) as unknown as {
    exec(query: string): Promise<unknown>;
  };
  const result = await sql.exec(`SELECT COUNT(*) AS n FROM ${table}`);
  const rows = (Array.isArray(result) ? result : Array.from(result as Iterable<unknown>)) as Array<{
    n: number;
  }>;
  return rows[0]?.n ?? 0;
}

async function waitCount(boardId: string, table: string, atLeast: number, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await rowCount(boardId, table)) >= atLeast) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${atLeast} rows in ${table}`);
    await sleep(100);
  }
}

function closeCodeFromConnect(boardId: string, onOpen?: (socket: WebSocket) => void, timeout = 14_000): Promise<number> {
  return new Promise((resolve) => {
    const raw = rawSocket(port, boardId);
    raw.on('open', () => {
      onOpen?.(raw);
    });
    raw.on('close', (code) => resolve(code));
    // Miniflare delivers a close queued during the wake request only when its
    // internal ~10s handshake-completion timeout elapses; Cloudflare sends
    // it immediately. Budget for the local delay.
    setTimeout(() => resolve(-1), timeout);
  });
}

async function pair(boardId: string): Promise<{ a: TestClient; b: TestClient }> {
  const a = await TestClient.connected(port, boardId);
  const b = await TestClient.connected(port, boardId);
  return { a, b };
}

function syncStep2Payload(client: TestClient): Buffer {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeSyncStep2(encoder, client.doc, Y.encodeStateVector(client.doc));
  return Buffer.from(toUint8Array(encoder));
}

// Seed one note and make sure it reached storage, then compact so the board
// lives in the snapshot only. Returns the client holding the same state.
async function seededCompactBoard(boardId: string): Promise<TestClient> {
  const a = await TestClient.connected(port, boardId);
  createSticky(a.doc, { x: 5, y: 5 });
  await waitCount(boardId, 'updates', 1);
  const compacted = await hook(boardId, 'compact');
  expect(compacted.done).toBe(true);
  expect(await rowCount(boardId, 'updates')).toBe(0);
  return a;
}

test('TC-12 by the time B observes a change its row exists, and a fresh instance replays it from storage', async () => {
  const boardId = await createBoardId(port);
  const { a, b } = await pair(boardId);
  createSticky(a.doc, { x: 10, y: 20 });
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'B observes A');
  // Append-before-broadcast: the row was durable before the broadcast that
  // B just consumed, so it must be visible now.
  expect(await rowCount(boardId, 'updates')).toBeGreaterThanOrEqual(1);
  await a.close();
  await b.close();
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId });
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === a.boardSnapshot(), 'fresh instance replays storage');
  await c.close();
});

test('TC-13 after everyone leaves, a fresh instance over the same storage reopens an identical board', async () => {
  const boardId = await createBoardId(port);
  const { a, b } = await pair(boardId);
  const id = createSticky(a.doc, { x: 40, y: 60 }) as string;
  createSticky(a.doc, { x: 45, y: 65 });
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'both notes on B');
  void id;
  const original = a.boardSnapshot();
  await a.close();
  await b.close();
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId });
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === original, 'reopen identical');
  expect(c.boardSnapshot()).toBe(original);
  await c.close();
});

test('TC-14 a failed append closes both clients with 1011 without propagating; the change recovers on reconnect', async () => {
  const boardId = await createBoardId(port);
  const { a, b } = await pair(boardId);
  createSticky(a.doc, { x: 1, y: 1 });
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'seed note on B');
  await hook(boardId, 'fail-append');
  createSticky(a.doc, { x: 2, y: 2 });
  await waitFor(() => a.log.closes.includes(CLOSE_STORAGE_FAILURE), 'A closed 1011');
  await waitFor(() => b.log.closes.includes(CLOSE_STORAGE_FAILURE), 'B closed 1011');
  // Non-propagation: B never saw the unsavable change.
  expect(b.doc.getMap('objects').size).toBe(1);
  expect(a.doc.getMap('objects').size).toBe(2);
  // A's provider reconnects still holding the change; it must reach storage…
  await waitCount(boardId, 'updates', 1, 30_000);
  // …and a fresh joiner must see it.
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === a.boardSnapshot(), 'recovered change visible');
  await a.close();
  await b.close();
  await c.close();
});

test('TC-15 a corrupt snapshot closes connecting clients with 4500 and a SyncStep2 stores nothing', async () => {
  const boardId = await createBoardId(port);
  const a = await seededCompactBoard(boardId);
  expect((await hook(boardId, 'corrupt-snapshot')).ok).toBe(true);
  await a.close();
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId });
  const code = await closeCodeFromConnect(boardId);
  expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
  // A fully caught-up peer offering its state over a rejected connection
  // must store nothing.
  const offered = await closeCodeFromConnect(boardId, (raw) => raw.send(syncStep2Payload(a)));
  expect(offered).toBe(CLOSE_BOARD_LOAD_FAILED);
  expect(await rowCount(boardId, 'updates')).toBe(0);
});

test('TC-16 retrying before LOAD_RETRY_MIN_INTERVAL_MS keeps 4500 without a reload; repairing storage recovers after the interval', async () => {
  const boardId = await createBoardId(port);
  const a = await seededCompactBoard(boardId);
  expect(await rowCount(boardId, 'snapshot_chunks')).toBeGreaterThan(0);
  expect((await hook(boardId, 'corrupt-snapshot')).ok).toBe(true);
  await a.close();
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId });
  // First connect wakes the room: load fails (attempt 1), client sees 4500.
  expect(await closeCodeFromConnect(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);
  // Reconnecting immediately gets 4500 again without attempting a reload.
  expect(await closeCodeFromConnect(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);
  const state = await hook(boardId, 'state');
  expect(state.loadAttempts).toBe(1);
  expect((await hook(boardId, 'repair-snapshot')).ok).toBe(true);
  await sleep(LOAD_RETRY_MIN_INTERVAL_MS + 300);
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.provider.synced, 'sync after repair');
  await waitFor(() => c.boardSnapshot() === a.boardSnapshot(), 'board restored');
  await a.close();
  await c.close();
});

test('TC-17 garbage updates close 1003 and store no rows', async () => {
  const boardId = await createBoardId(port);
  const { a, b } = await pair(boardId);
  createSticky(a.doc, { x: 1, y: 1 });
  // Persistence is write-before-broadcast, so once B has the note the sticky
  // update row is already committed. Capturing earlier races the write.
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'sticky at B');
  const before = await rowCount(boardId, 'updates');
  const garbage: Buffer[] = [
    Buffer.from([MESSAGE_SYNC, SYNC_UPDATE, 100, 1, 2, 3]),
    Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb])
  ];
  for (const bytes of garbage) {
    const code = await closeCodeFromConnect(boardId, (raw) => {
      raw.send(bytes);
    });
    expect(code).toBe(CLOSE_UNSUPPORTED_DATA);
  }
  expect(await rowCount(boardId, 'updates')).toBe(before);
  // The room is still healthy.
  createSticky(a.doc, { x: 9, y: 9 });
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'room still live');
  await a.close();
  await b.close();
});

test('TC-18 hibernated sockets receive broadcasts through getWebSockets after the room is rebuilt', async () => {
  const boardId = await createBoardId(port);
  const a = await TestClient.connected(port, boardId);
  createSticky(a.doc, { x: 1, y: 1 });
  await waitCount(boardId, 'updates', 1);
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId, webSockets: 'hibernate' });
  // A new client wakes the room; A's hibernated socket stays open on the wire.
  const b = await TestClient.connected(port, boardId);
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'B synced after wake');
  createSticky(b.doc, { x: 3, y: 3 });
  await waitFor(() => a.boardSnapshot() === b.boardSnapshot(), 'hibernated A receives broadcast');
  await a.close();
  await b.close();
});

test('TC-26 an SQL read error during load closes clients with 4500 and recovery follows a repair', async () => {
  const boardId = await createBoardId(port);
  const a = await TestClient.connected(port, boardId);
  createSticky(a.doc, { x: 1, y: 1 });
  await waitCount(boardId, 'updates', 1);
  await hook(boardId, 'fail-load');
  await a.close();
  await worker.evictDurableObject('BOARD_ROOM', { name: boardId });
  expect(await closeCodeFromConnect(boardId)).toBe(CLOSE_BOARD_LOAD_FAILED);
  expect((await hook(boardId, 'clear-fail-load')).ok).toBe(true);
  await sleep(LOAD_RETRY_MIN_INTERVAL_MS + 300);
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === a.boardSnapshot(), 'recovered after clear');
  await a.close();
  await c.close();
});
