// Story 5 task 3: board creation and existence over the real HTTP surface
// in workerd (share.board_api). TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.

import { describe, expect, it, vi } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BoardStore } from '../../src/worker/board-store';
import { TestClient, createNote, snapshotString } from './helpers/ws-client';

const stubFor = (boardId: string): DurableObjectStub =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

async function postBoards(): Promise<Response> {
  return SELF.fetch('http://mocked-worker/api/boards', { method: 'POST' });
}

/** Raw storage facts from inside the object, without touching BoardRoom. */
async function rawStorage(boardId: string): Promise<{
  tables: string[];
  createdAt: string | null;
  updateRows: number;
}> {
  return runInDurableObject(stubFor(boardId), (_obj, state) => {
    const tables = state.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => String(row.name));
    if (tables.length === 0) return { tables, createdAt: null, updateRows: 0 };
    const meta = state.storage.sql
      .exec("SELECT value FROM storage_meta WHERE key = 'created_at'")
      .toArray();
    const rows = state.storage.sql
      .exec('SELECT COUNT(*) AS c FROM updates')
      .toArray()[0].c as number;
    return { tables, createdAt: meta.length > 0 ? String(meta[0].value) : null, updateRows: rows };
  });
}

describe('POST /api/boards (share.board_api)', () => {
  it('TC-05: returns 201 with a pattern-valid id; GET sees it; created_at is set', async () => {
    const response = await postBoards();
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const check = await SELF.fetch(`http://mocked-worker/api/boards/${id}`);
    expect(check.status).toBe(200);
    expect(((await check.json()) as { id: string }).id).toBe(id);

    const storage = await rawStorage(id);
    expect(storage.tables.length).toBeGreaterThan(0);
    expect(storage.createdAt).not.toBeNull();
  });

  it('TC-12: an initialize RPC that throws returns 500 create_failed', async () => {
    const spy = vi
      .spyOn(env.BOARD_ROOM, 'get')
      .mockReturnValue({
        initialize: async () => {
          throw new Error('injected RPC failure');
        },
      } as unknown as ReturnType<typeof env.BOARD_ROOM.get>);
    try {
      const response = await postBoards();
      expect(response.status).toBe(500);
      expect(((await response.json()) as { error: string }).error).toBe('create_failed');
    } finally {
      spy.mockRestore();
    }
  });

  it('TC-14: PUT /api/boards and PUT /api/boards/:id return 405', async () => {
    const collection = await SELF.fetch('http://mocked-worker/api/boards', { method: 'PUT' });
    expect(collection.status).toBe(405);
    const item = await SELF.fetch(`http://mocked-worker/api/boards/${newBoardId()}`, {
      method: 'PUT',
    });
    expect(item.status).toBe(405);
  });

  it('TC-15: initialize() twice answers created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const stub = stubFor(id) as unknown as { initialize(): Promise<'created' | 'exists'> };
    expect(await stub.initialize()).toBe('created');
    const first = await rawStorage(id);
    expect(await stub.initialize()).toBe('exists');
    const second = await rawStorage(id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.createdAt).not.toBeNull();
  });
});

describe('GET /api/boards/:id (share.board_api)', () => {
  it('TC-06: an unknown valid id is 404 and leaves no tables behind', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://mocked-worker/api/boards/${id}`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('not_found');
    const storage = await rawStorage(id);
    expect(storage.tables).toEqual([]);
  });

  it('TC-07: malformed ids are 404 and never reach the Durable Object', async () => {
    const spy = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    const tooShort = await SELF.fetch('http://mocked-worker/api/boards/abc');
    expect(tooShort.status).toBe(404);
    const tooLong = await SELF.fetch(`http://mocked-worker/api/boards/${'A'.repeat(23)}`);
    expect(tooLong.status).toBe(404);
    const badChar = await SELF.fetch('http://mocked-worker/api/boards/bad!id');
    expect(badChar.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-08: a legacy board (update rows, no created_at) is found', async () => {
    const id = newBoardId();
    await runInDurableObject(stubFor(id), (_obj, state) => {
      // The storage shape a story 4 board left behind: tables and rows,
      // written before created_at existed.
      const store = new BoardStore(state.storage);
      store.migrate();
      store.append(new Uint8Array([0, 1, 2, 3]));
    });
    const response = await SELF.fetch(`http://mocked-worker/api/boards/${id}`);
    expect(response.status).toBe(200);
    const storage = await rawStorage(id);
    expect(storage.createdAt).toBeNull();
    expect(storage.updateRows).toBeGreaterThan(0);
  });
});

describe('WebSocket connect requires an existing board (share.board_api)', () => {
  it('TC-09: upgrade to an unknown id is 404; no socket, no tables', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://mocked-worker/api/rooms/${id}`, {
      headers: { upgrade: 'websocket', connection: 'Upgrade' },
    });
    expect(response.status).toBe(404);
    expect((response as unknown as { webSocket?: WebSocket | null }).webSocket).toBeFalsy();
    const storage = await rawStorage(id);
    expect(storage.tables).toEqual([]);
  });

  it('TC-10: after POST, the upgrade succeeds and live sync works', async () => {
    const response = await postBoards();
    const { id } = (await response.json()) as { id: string };
    const a = await TestClient.connect(id);
    const b = await TestClient.connect(id);
    const noteId = createNote(a, 25, 75);
    await b.waitFor(() => b.snapshot().some((note) => note.id === noteId), 10_000, 'note on B');
    expect(snapshotString(a)).toContain(noteId);
    a.destroy();
    b.destroy();
  });
});

describe('share.not_found hardening', () => {
  it('TC-32: served index.html carries the no-referrer meta tag', async () => {
    const response = await SELF.fetch('http://mocked-worker/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
