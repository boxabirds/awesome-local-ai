// Story 4 — durability across a PROCESS RESTART (Task 3, design table
// TC-13, TC-15 after a restart, TC-19). These are the cases that cannot be
// tested against the shared dev server: they need their own workerd instance, its own DO
// SQLite file, and a genuine kill + re-spawn in the middle, so "the board is
// still there" means it came off the disk, not out of someone's memory.
//
// Everything else stays unmocked: real Y.Doc clients, real WebSockets, real
// SQLite, real Durable Object. The only test-only ingredient is the /__test/
// storage hooks (`--var TEST_HOOKS:1`, see helpers/server.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { restartServer, startFreshServer, type DevServer } from './helpers/server';
import { RoomHooks, until } from './helpers/hooks';
import { createRoom, rawClient, yClient } from './helpers/ws-client';
import * as Y from 'yjs';

const PORT = 8797;

let server: DevServer;
// A restart moves to a new port over the same storage file, so every request
// has to ask the CURRENT server where it lives.
const hooks = () => new RoomHooks(server.httpOrigin);
const ws = () => server.wsOrigin;

beforeAll(async () => {
  // A leftover server or storage file from a previous run would make these
  // tests lie: they must start from a new process and an empty database.
  server = await startFreshServer(PORT);
}, 120_000);

afterAll(async () => {
  await server?.stop();
});

describe('board durability across a workerd restart', () => {
  it('TC-13: data written before a restart is read back after it', async () => {
    const boardId = await createRoom(server.httpOrigin);
    const author = yClient(boardId, undefined, { origin: ws() });
    expect(await until(() => author.provider.wsconnected, 10_000)).toBe(true);

    const key = createSticky(author.doc, { x: 3, y: 3 });
    const text = author.doc.getMap<Y.Map<unknown>>('objects').get(key)!.get('text') as Y.Text;
    text.insert(0, 'persisted');
    expect(await until(async () => ((await hooks().logBytes(boardId)) ?? 0) > 0, 10_000)).toBe(true);

    // Hard kill: the object, its isolate and its in-memory document all go
    // away. The only copy of the board left is the SQLite file on disk.
    server = await restartServer(server);

    const reader = yClient(boardId, undefined, { origin: ws() });
    expect(await until(() => reader.provider.wsconnected, 20_000)).toBe(true);
    expect(await until(() => snapshot(reader.doc).length === 1, 20_000)).toBe(true);
    // …and it is the same content, not a coincidentally similar board.
    const readBack = reader.doc.getMap<Y.Map<unknown>>('objects').get(key);
    expect(readBack).toBeDefined();
    expect((readBack!.get('text') as Y.Text).toString()).toBe('persisted');
    reader.destroy();
  }, 90_000);

  it('TC-19 (workerd level): a compacted board is rebuilt from snapshot chunks after a restart', async () => {
    const boardId = await createRoom(server.httpOrigin);
    const author = yClient(boardId, undefined, { origin: ws() });
    expect(await until(() => author.provider.wsconnected, 10_000)).toBe(true);
    for (let i = 0; i < 4; i++) createSticky(author.doc, { x: i * 20, y: 0 });
    expect(await until(async () => ((await hooks().logBytes(boardId)) ?? 0) > 0, 10_000)).toBe(true);

    // One real compaction: journal -> snapshot chunks, journal cleared.
    const before = await hooks().compact(boardId);
    expect(before.chunkCount).toBeGreaterThanOrEqual(1);
    expect(before.snapshotBytes).toBeGreaterThan(0);
    expect(before.log.length).toBe(0);

    server = await restartServer(server);

    const reader = yClient(boardId, undefined, { origin: ws() });
    expect(await until(() => reader.provider.wsconnected, 20_000)).toBe(true);
    expect(await until(() => snapshot(reader.doc).length === 4, 20_000)).toBe(true);
    // The journal on disk is empty, so the snapshot chunks are the only
    // possible source of these four notes.
    const after = await hooks().state(boardId);
    expect(after.log.length).toBe(0);
    expect(after.chunkCount).toBe(before.chunkCount);

    author.destroy();
    reader.destroy();
  }, 90_000);

  it('TC-15 after a restart: a damaged snapshot is refused with 4500, never served as an empty board', async () => {
    const boardId = await createRoom(server.httpOrigin);
    const author = yClient(boardId, undefined, { origin: ws() });
    expect(await until(() => author.provider.wsconnected, 10_000)).toBe(true);
    for (let i = 0; i < 3; i++) createSticky(author.doc, { x: i * 20, y: 0 });
    expect(await until(async () => ((await hooks().logBytes(boardId)) ?? 0) > 0, 10_000)).toBe(true);
    await hooks().compact(boardId);

    // Damage the stored chunk so it no longer decodes: a hibernation reload
    // must refuse the board rather than hand out an empty one (which is how
    // the first draft of this story silently deleted people's work).
    await hooks().corruptSnapshot(boardId);

    server = await restartServer(server);

    const refused = await rawClient(boardId, ws());
    expect(await until(() => refused.ws.readyState === WebSocket.CLOSED, 20_000)).toBe(true);
    expect(await refused.closed).toBe(CLOSE_BOARD_LOAD_FAILED);

    author.destroy();
    refused.close();
  }, 90_000);

});
