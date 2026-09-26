// Story 4, design "persist.room" capability — integration tests in the
// workerd pool.
//
// These exercise the ROOM's persistence behaviour end to end (WebSocket
// clients + the room's test-only RPC surface for storage inspection and
// fault injection). They are distinct from the story-3 realtime tests in
// board-room.test.ts even where the TC numbers overlap: this file's TC ids
// are the story-4 design's `persist.room` ids.
//
// The workerd test pool cannot hibernate/reconstruct a Durable Object, so
// the design's "new room instance over the same storage" (TC-13, TC-18) is
// simulated with the room's testWake() hook, which re-runs the exact load
// path a reconstructed object would run. The real process-restart proof is
// the e2e suite (tests/e2e/persistence.spec.ts).

import { expect, it } from 'vitest';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyAt } from '../../src/shared/board-model';
import { MESSAGE_SYNC, SYNC_UPDATE } from '../../src/shared/protocol';
import type { StickySnapshot } from '../../src/shared/board-model';
import { generateRetroBoard } from '../fixtures/boards';
import { exactBuffer, ids, room, sameBoard, stateToNotes } from './persist-helpers';
import { WsClient } from './ws-client';

/** Poll the store until the loaded state satisfies `check` (bounded). */
async function waitForStored(
  stub: ReturnType<typeof room>,
  check: (notes: readonly StickySnapshot[]) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const loaded = await stub.testStoreLoad();
    if (loaded.ok && loaded.state !== null && check(stateToNotes(loaded.state))) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for stored state');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Connect a client to an (optionally not-yet-constructed) room. */
function connect(boardId: string, opts?: { autoExchange?: boolean }): Promise<WsClient> {
  return WsClient.connect(boardId, opts);
}

/** Force the room to rebuild its doc from storage (simulated reconstruction). */
async function rebuild(stub: ReturnType<typeof room>): Promise<void> {
  await stub.testWake();
}

it('TC-12 (persist.room): a stored note is written before it is observed and survives to a fresh doc', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  const a = await connect(boardId);
  try {
    const noteId = a.applyLocal((doc) => createStickyAt(doc, 0, 0, 'yellow'));
    // The row is durably written BEFORE any second client is involved: poll
    // the store until the append has landed (it precedes the broadcast, so
    // it lands before B could ever observe the note).
    await waitForStored(stub, (notes) => notes.some((n) => n.id === noteId));
    expect((await stub.testStoreStats()).count).toBeGreaterThanOrEqual(1);

    const b = await connect(boardId);
    try {
      // B receives the note the room serves (which it read from storage).
      await b.waitUntil(() => b.hasNote(noteId));
    } finally {
      await b.destroy();
    }

    // A fresh doc built from storage contains the note.
    const loaded = await stub.testStoreLoad();
    expect(loaded.ok).toBe(true);
    if (loaded.state === null) throw new Error('expected loaded state');
    const freshNotes = stateToNotes(loaded.state);
    expect(ids(freshNotes)).toContain(noteId);
  } finally {
    await a.destroy();
  }
});

it('TC-13 (persist.room): after every client leaves, a reconstructed room serves the same 25 notes', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  const fixture = generateRetroBoard();
  const original = stateToNotes(exactBuffer(fixture.snapshot));

  // Seed storage, then rebuild so the room's live doc matches storage.
  await stub.testStoreAppendBatch(fixture.updates);
  await rebuild(stub);

  const a = await connect(boardId);
  try {
    await a.waitUntil(() => a.boardSnapshot().length === fixture.noteCount, 5000);
    expect(sameBoard(a.boardSnapshot(), original)).toBe(true);
  } finally {
    await a.destroy(); // all clients disconnect
  }

  // Reconstructed room over the SAME storage serves an identical board.
  await rebuild(stub);
  const c = await connect(boardId);
  try {
    await c.waitUntil(() => c.boardSnapshot().length === fixture.noteCount, 5000);
    expect(sameBoard(c.boardSnapshot(), original)).toBe(true);
  } finally {
    await c.destroy();
  }
}, 30_000);

it('TC-14 (persist.room): a failed append closes both with 1011; reconnect re-sends and the note is stored', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  // Touch the room so its constructor load has settled before injecting.
  await stub.testGetLifecycle();

  const a = await connect(boardId);
  const b = await connect(boardId);
  await a.waitForSync();
  await b.waitForSync();

  await stub.testFailNextAppend();
  const noteId = a.applyLocal((doc) => createStickyAt(doc, 0, 0, 'green'));
  // B must NEVER receive the unsaved change.
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(b.hasNote(noteId)).toBe(false);

  // Both sockets are closed with the storage-failure code.
  expect((await a.closeInfo()).code).toBe(1011);
  expect((await b.closeInfo()).code).toBe(1011);

  // The original clients are gone; their docs survive (the real client's
  // doc outlives a dropped connection).
  await a.destroy();
  await b.destroy();

  // A re-sends the change it still holds; the room stores it this time.
  const a2 = await WsClient.adopt(boardId, a.doc);
  try {
    await waitForStored(stub, (notes) => notes.some((n) => n.id === noteId));

    // B reconnects and receives the now-stored note.
    const b2 = await WsClient.adopt(boardId, b.doc);
    try {
      await b2.waitUntil(() => b2.hasNote(noteId), 5000);
    } finally {
      await b2.destroy();
    }
  } finally {
    await a2.destroy();
  }
}, 20_000);

it('TC-15 (persist.room): a damaged snapshot closes the connecting client with 4500 and stores nothing', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  const fixture = generateRetroBoard();
  await stub.testStoreAppendBatch(fixture.updates);
  const compacted = await stub.testStoreCompact(true);
  expect(compacted.committed).toBe(true);
  const corrupted = await stub.testCorruptSnapshotChunk0();
  expect(corrupted.ok).toBe(true);
  // The room now fails to load (snapshot unreadable) -> load-failed.
  await stub.testReload();

  const c = await connect(boardId, { autoExchange: false });
  const info = await Promise.race([
    c.closeInfo(),
    new Promise<{ code: number; reason: string }>((resolve) =>
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 3000),
    ),
  ]);
  expect(info.code).toBe(4500);
  await c.destroy();

  // Nothing was stored by the failed connection (log was compacted away).
  const inspect = await stub.testInspectStorage();
  expect(inspect.updatesRows.length).toBe(0);
  expect(await stub.testGetLifecycle()).toBe('load-failed');
}, 15_000);

it('TC-16 (persist.room): before the retry interval -> 4500; after repair + interval -> loads and syncs', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  const fixture = generateRetroBoard();
  const original = stateToNotes(exactBuffer(fixture.snapshot));
  await stub.testStoreAppendBatch(fixture.updates);
  await stub.testStoreCompact(true);
  expect((await stub.testCorruptSnapshotChunk0()).ok).toBe(true);
  await stub.testReload(); // -> load-failed, loadFailedAt = now

  // 1) Before the retry interval: closed 4500, no reload attempted.
  const early = await connect(boardId, { autoExchange: false });
  const earlyInfo = await Promise.race([
    early.closeInfo(),
    new Promise<{ code: number; reason: string }>((resolve) =>
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 3000),
    ),
  ]);
  expect(earlyInfo.code).toBe(4500);
  await early.destroy();
  expect(await stub.testGetLifecycle()).toBe('load-failed');

  // 2) Repair the snapshot, then wait past the retry interval.
  expect((await stub.testRepairSnapshotChunk0()).ok).toBe(true);
  const { LOAD_RETRY_MIN_INTERVAL_MS } = await import('../../src/shared/config');
  await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 300));

  // 3) After the interval the room retries the load and syncs the board.
  const late = await connect(boardId);
  try {
    await late.waitUntil(() => late.boardSnapshot().length === fixture.noteCount, 8000);
    expect(sameBoard(late.boardSnapshot(), original)).toBe(true);
    expect(await stub.testGetLifecycle()).toBe('ready');
  } finally {
    await late.destroy();
  }
}, 20_000);

it('TC-17 (persist.room): a garbage update closes the sender with 1003 and is not stored', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  await stub.testGetLifecycle();

  const a = await connect(boardId, { autoExchange: false });
  // Well-formed framing, garbage Yjs update: claims 255 client parts in 7 bytes.
  const enc = createEncoder();
  writeVarUint(enc, MESSAGE_SYNC);
  writeVarUint(enc, SYNC_UPDATE);
  writeVarUint8Array(enc, new Uint8Array([255, 255, 255, 255, 255, 255, 255]));
  a.sendRaw(toUint8Array(enc).buffer as ArrayBuffer);
  const info = await Promise.race([
    a.closeInfo(),
    new Promise<{ code: number; reason: string }>((resolve) =>
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 3000),
    ),
  ]);
  expect(info.code).toBe(1003);
  await a.destroy();

  const inspect = await stub.testInspectStorage();
  expect(inspect.updatesRows.length).toBe(0);
});

it('TC-18 (persist.room): a wake reconstructs the doc and a broadcast reaches the pre-reconstruction socket', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  const fixture = generateRetroBoard();
  await stub.testStoreAppendBatch(fixture.updates);
  await rebuild(stub);

  // A holds a socket that was accepted BEFORE the reconstruction.
  const a = await connect(boardId);
  try {
    await a.waitUntil(() => a.boardSnapshot().length === fixture.noteCount, 5000);

    // Reconstruct (simulate a hibernation wake); A's socket survives.
    await rebuild(stub);

    // A fresh client's update is broadcast to A's pre-reconstruction socket.
    const b = await connect(boardId);
    try {
      const noteId = b.applyLocal((doc) => createStickyAt(doc, 500, 500, 'blue'));
      await b.waitUntil(() => b.hasNote(noteId));
      // A (socket accepted before the wake) receives the post-wake broadcast.
      await a.waitUntil(() => a.hasNote(noteId), 5000);
    } finally {
      await b.destroy();
    }
  } finally {
    await a.destroy();
  }
}, 20_000);

it('TC-26 (persist.room): a SQL error on read puts the room in load-failed and closes the client with 4500', async () => {
  const boardId = newBoardId();
  const stub = room(boardId);
  await stub.testGetLifecycle(); // settle the constructor load
  await stub.testFailLoadSelect();
  await stub.testReload(); // the reload's SELECT throws -> load-failed
  expect(await stub.testGetLifecycle()).toBe('load-failed');

  const c = await connect(boardId, { autoExchange: false });
  const info = await Promise.race([
    c.closeInfo(),
    new Promise<{ code: number; reason: string }>((resolve) =>
      setTimeout(() => resolve({ code: -1, reason: 'timeout' }), 3000),
    ),
  ]);
  expect(info.code).toBe(4500);
  await c.destroy();
}, 15_000);
