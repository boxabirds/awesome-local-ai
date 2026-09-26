import { describe, it, expect } from 'vitest';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { RoomClient, settle } from './ws-client';
import { snapshotsEqual } from './random-ops';
import { newBoardId } from '@/shared/board-id';
import { createSticky } from '@/shared/board-model';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '@/shared/config';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '@/shared/protocol';
import { buildBoardUpdates, retroBoardSpecs } from '../fixtures/boards';
import {
  appendUpdates,
  compact,
  corruptSnapshot,
  loadFresh,
  repair,
  roomState,
  setFailure,
  simulateReconstruct,
  storageInfo,
} from './hooks';

const MESSAGE_SYNC = 0;

/** Seed `retroBoardSpecs` (25 notes) into a board's storage via the hooks. */
async function seed25(boardId: string) {
  const { updates, notes } = buildBoardUpdates(retroBoardSpecs());
  await appendUpdates(boardId, updates);
  return notes;
}

describe('BoardRoom persistence (real wrangler dev + DO SQLite)', () => {
  it('TC-12: write-before-broadcast — note durable after both clients disconnect', async () => {
    const boardId = newBoardId();
    const a = new RoomClient(boardId);
    const b = new RoomClient(boardId);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();
    const id = createSticky(a.doc, { x: 10, y: 20 }, 'yellow');
    await settle(600);
    expect(b.notes().some((n) => n.id === id)).toBe(true);
    a.close();
    b.close();
    await settle(200);
    // The change is durable: an update row exists and a fresh load has the note.
    const info = await storageInfo(boardId);
    expect(info.updates).toBeGreaterThanOrEqual(1);
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(lf.notes.some((n) => n.id === id)).toBe(true);
  }, 30_000);

  it('TC-13: reload on a new room instance over the same storage', async () => {
    const boardId = newBoardId();
    const notes = await seed25(boardId);
    // The seed hooks already constructed the room (on empty storage); force a
    // reload so the room's doc reflects the seeded rows.
    await simulateReconstruct(boardId);
    const a = new RoomClient(boardId);
    await a.connect();
    await a.waitSync();
    await settle(300);
    expect(a.notes()).toHaveLength(25);
    a.close();
    await settle(200);
    // Simulate a new room instance: drop the doc, reload from storage.
    const rec = await simulateReconstruct(boardId);
    expect(rec.after).toBe('ready');
    const b = new RoomClient(boardId);
    await b.connect();
    await b.waitSync();
    await settle(300);
    expect(snapshotsEqual(b.notes(), notes)).toBe(true);
    b.close();
  }, 30_000);

  it('TC-14: append failure -> 1011 closes; reconnect resyncs and persists the change', async () => {
    const boardId = newBoardId();
    const a = new RoomClient(boardId);
    const b = new RoomClient(boardId);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();
    // Arm a one-shot append failure.
    await setFailure(boardId, 'append');
    const id = createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    // The insert throws -> storage-failed -> every socket closes 1011.
    expect(await a.waitClose()).toBe(CLOSE_STORAGE_FAILURE);
    expect(await b.waitClose()).toBe(CLOSE_STORAGE_FAILURE);
    // B never received the unsaved change; A still holds it locally.
    expect(b.notes().some((n) => n.id === id)).toBe(false);
    expect(a.notes().some((n) => n.id === id)).toBe(true);
    // A reconnects (same doc, still holds the note); the room reloads empty.
    const a2 = new RoomClient(boardId, a.doc);
    await a2.connect();
    await a2.waitSync();
    await settle(500); // let the resynced note be stored
    // A fresh B reconnects and receives the note from storage/sync.
    const b2 = new RoomClient(boardId);
    await b2.connect();
    await b2.waitSync();
    await settle(300);
    expect(b2.notes().some((n) => n.id === id)).toBe(true);
    expect(snapshotsEqual(a2.notes(), b2.notes())).toBe(true);
    // The change is now durable.
    const lf = await loadFresh(boardId);
    expect(lf.result.ok).toBe(true);
    expect(lf.notes.some((n) => n.id === id)).toBe(true);
    a2.close();
    b2.close();
  }, 30_000);

  it('TC-15: damaged snapshot -> 4500; nothing stored', async () => {
    const boardId = newBoardId();
    await seed25(boardId);
    await compact(boardId, true);
    await corruptSnapshot(boardId, 0);
    // Force the room to (re)load: it now hits the damaged snapshot -> LoadFailed.
    await simulateReconstruct(boardId);
    const a = new RoomClient(boardId);
    await a.connect();
    expect(await a.waitClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    const info = await storageInfo(boardId);
    expect(info.updates).toBe(0); // no incoming update was stored
    const rs = await roomState(boardId);
    expect(rs.state).toBe('load-failed');
  }, 30_000);

  it('TC-16: damaged snapshot then repaired -> retry after interval loads and syncs', async () => {
    const boardId = newBoardId();
    const notes = await seed25(boardId);
    await compact(boardId, true);
    await corruptSnapshot(boardId, 0);
    // Force the room to (re)load: damaged snapshot -> LoadFailed (T0).
    await simulateReconstruct(boardId);
    // First connection (before the retry interval): refused 4500, no reload.
    const a = new RoomClient(boardId);
    await a.connect();
    expect(await a.waitClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    // Repair the snapshot, then wait past the retry interval.
    await repair(boardId);
    await settle(LOAD_RETRY_MIN_INTERVAL_MS + 500);
    // Second connection (after the interval): the load is retried and succeeds.
    const b = new RoomClient(boardId);
    await b.connect();
    await b.waitSync();
    await settle(300);
    expect(snapshotsEqual(b.notes(), notes)).toBe(true);
    const rs = await roomState(boardId);
    expect(rs.state).toBe('ready');
    b.close();
  }, 30_000);

  it('TC-17: garbage update -> 1003; not stored', async () => {
    const boardId = newBoardId();
    const a = new RoomClient(boardId);
    await a.connect();
    await a.waitSync();
    const before = (await storageInfo(boardId)).updates;
    // A well-formed sync Update frame carrying bytes Yjs rejects.
    const enc = createEncoder();
    const garbage = new Uint8Array(24);
    crypto.getRandomValues(garbage);
    sync.writeUpdate(enc, garbage);
    a.sendFrame(MESSAGE_SYNC, toUint8Array(enc));
    expect(await a.waitClose()).toBe(CLOSE_UNSUPPORTED_DATA);
    const after = (await storageInfo(boardId)).updates;
    expect(after).toBe(before); // the rejected update was not stored
  }, 30_000);

  it('TC-18: hibernation simulation — broadcast reaches sockets accepted before reconstruct', async () => {
    const boardId = newBoardId();
    await seed25(boardId);
    // Load the seeded notes into the room (the seed hooks constructed it empty).
    await simulateReconstruct(boardId);
    const a = new RoomClient(boardId);
    const b = new RoomClient(boardId);
    await a.connect();
    await b.connect();
    await a.waitSync();
    await b.waitSync();
    await settle(300);
    expect(a.notes()).toHaveLength(25);
    // Simulate hibernate + wake: drop the doc and reload from storage.
    const rec = await simulateReconstruct(boardId);
    expect(rec.after).toBe('ready');
    // A new client adds a note; the broadcast must reach a and b (pre-reconstruct).
    const c = new RoomClient(boardId);
    await c.connect();
    await c.waitSync();
    await settle(300);
    const id = createSticky(c.doc, { x: 500, y: 500 }, 'green');
    await settle(700);
    expect(a.notes().some((n) => n.id === id)).toBe(true);
    expect(b.notes().some((n) => n.id === id)).toBe(true);
    a.close();
    b.close();
    c.close();
  }, 30_000);

  it('TC-26: SQL error on read -> LoadFailed; room closes 4500', async () => {
    const boardId = newBoardId();
    await seed25(boardId);
    await compact(boardId, true);
    // Arm a one-shot load (SELECT) failure, then force a reload to consume it.
    await setFailure(boardId, 'load-select');
    await simulateReconstruct(boardId);
    const a = new RoomClient(boardId);
    await a.connect();
    expect(await a.waitClose()).toBe(CLOSE_BOARD_LOAD_FAILED);
    const rs = await roomState(boardId);
    expect(rs.state).toBe('load-failed');
  }, 30_000);
});
