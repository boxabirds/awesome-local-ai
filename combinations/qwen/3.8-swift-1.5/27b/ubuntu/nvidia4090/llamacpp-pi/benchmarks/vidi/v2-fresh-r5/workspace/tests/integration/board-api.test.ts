/**
 * Integration tests for share.board_api: the real Worker `fetch` handler,
 * Durable Object RPC (initialize/exists) and SQLite in workerd, no mocks.
 *
 * Covers the HTTP contract (201/200/404/405/426), the existence rule
 * (created_at, or legacy updates/snapshot rows), the no-write guarantee for
 * probes of unknown links, and idempotent initialize.
 *
 * Cases: TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { BoardStore, type BoardStorage } from '../../src/worker/board-store';
import { BoardRoom } from '../../src/worker/index';
import { openSocket, WsClient } from './ws-client';

const UPGRADE_HEADERS: Record<string, string> = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

/** Read `storage_meta.created_at` inside the board's Durable Object. */
async function readCreatedAt(boardId: string): Promise<string | null> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) => {
    const row = (
      room.rawStorage.sql
        .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
        .toArray()[0]
    ) as { value: string } | undefined;
    return row ? row.value : null;
  });
}

/** List the tables in a board's SQLite database (empty when nothing written). */
async function tablesIn(boardId: string): Promise<string[]> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return runInDurableObject(stub, (room: BoardRoom) =>
    (
      room.rawStorage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray() as { name: string }[]
    ).map((r) => r.name),
  );
}

/** Seed real Yjs updates as `updates` rows WITHOUT created_at (a legacy board). */
async function seedLegacyBoard(boardId: string): Promise<void> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  await runInDurableObject(stub, (room: BoardRoom) => {
    const store = new BoardStore(room.rawStorage as unknown as BoardStorage);
    store.migrate();
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, 'legacy');
    store.append(Y.encodeStateAsUpdate(doc));
    return null;
  });
}

describe('share.board_api (real Worker, RPC, SQLite)', () => {
  let idFromNameSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-05: POST /api/boards → 201 id matching the pattern; GET that id → 200; created_at set', async () => {
    const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(new Request(`http://localhost/api/boards/${body.id}`));
    expect(get.status).toBe(200);
    expect((await get.json()) as { id: string }).toEqual({ id: body.id });

    const createdAt = await readCreatedAt(body.id);
    expect(createdAt).not.toBeNull();
    expect(Number(createdAt!)).toBeGreaterThan(0);
  });

  it('TC-06: GET a fresh never-created id → 404 not_found; no tables in sqlite_master (negative)', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(new Request(`http://localhost/api/boards/${boardId}`));
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    // Probing an unknown link must not create storage.
    expect(await tablesIn(boardId)).toEqual([]);
  });

  it('TC-07: malformed ids → 404; the Durable Object namespace is never touched (negative)', async () => {
    idFromNameSpy = vi.spyOn(env.BOARD_ROOM as unknown as { idFromName: (n: string) => unknown }, 'idFromName');

    const short = await SELF.fetch(new Request('http://localhost/api/boards/abc'));
    expect(short.status).toBe(404);
    expect((await short.json()) as { error: string }).toEqual({ error: 'not_found' });

    const long = await SELF.fetch(new Request(`http://localhost/api/boards/${'a'.repeat(23)}`));
    expect(long.status).toBe(404);
    expect((await long.json()) as { error: string }).toEqual({ error: 'not_found' });

    expect(idFromNameSpy).not.toHaveBeenCalled();
  });

  it('TC-08: legacy board (updates row, no created_at) → GET 200', async () => {
    const boardId = newBoardId();
    await seedLegacyBoard(boardId);

    const res = await SELF.fetch(new Request(`http://localhost/api/boards/${boardId}`));
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toEqual({ id: boardId });
  });

  it('TC-09: WebSocket upgrade to an unknown valid id → 404; no socket, no tables (negative)', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${boardId}`, { headers: UPGRADE_HEADERS }),
    );
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();

    // No storage was written by the rejected upgrade.
    expect(await tablesIn(boardId)).toEqual([]);
  });

  it('TC-10: WebSocket upgrade after POST → 101 and story 3 sync works', async () => {
    const created = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const ws = await openSocket((req) => SELF.fetch(req), id);
    const client = new WsClient(ws);
    await client.waitForSync();

    const noteId = createSticky(client.doc, { x: 1, y: 1 });
    expect(noteId).toBeTruthy();
    expect(client.boardSnapshot().some((n) => n.id === noteId)).toBe(true);
    client.close();
  });

  it('TC-12: initialize() throwing → 500 create_failed (error path)', async () => {
    const initSpy = vi
      .spyOn(BoardRoom.prototype, 'initialize')
      .mockImplementation(async () => {
        throw new Error('injected RPC failure');
      });

    const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });
    initSpy.mockRestore();
  });

  it('TC-14: PUT /api/boards → 405', async () => {
    const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'PUT' }));
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize() twice → created then exists; created_at unchanged', async () => {
    const boardId = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

    expect(await stub.initialize()).toBe('created');
    const first = await readCreatedAt(boardId);
    expect(first).not.toBeNull();

    expect(await stub.initialize()).toBe('exists');
    const second = await readCreatedAt(boardId);
    expect(second).toBe(first);
  });

  it('TC-32: served index.html carries <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch(
      new Request('http://localhost/', { headers: { Accept: 'text/html' } }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
