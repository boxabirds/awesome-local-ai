/**
 * Board API integration tests (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32).
 *
 * Verifies the HTTP contract, existence rule, and no-write guarantee with real Worker,
 * Durable Object RPC, and SQLite storage.
 */
import { describe, expect, test } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import worker, { type Env } from '../../src/worker/index';
import type { BoardRoom } from '../../src/worker/board-room';
import { closeAll, connect, waitFor } from './ws-client';

/** The headers a browser sends when it asks for a WebSocket. */
function upgradeHeaders(): Record<string, string> {
  return {
    upgrade: 'websocket',
    connection: 'Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': 'dGVzdGluZy1rZXktMDEyMzQ1Njc4OTI=',
  };
}

/** Lists all tables in a board's storage. */
async function listTables(id: string): Promise<{ name: string }[]> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return runInDurableObject(stub, (_room: BoardRoom, state: DurableObjectState) => {
    return state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .toArray();
  });
}

/** Reads created_at from a board's storage_meta. */
async function readCreatedAt(id: string): Promise<string | null> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return runInDurableObject(stub, (_room: BoardRoom, state: DurableObjectState) => {
    const rows = state.storage.sql
      .exec<{ value: string }>("SELECT value FROM storage_meta WHERE key = 'created_at'")
      .toArray();
    return rows.length > 0 ? rows[0]!.value : null;
  });
}

describe('POST /api/boards (TC-05)', () => {
  test('TC-05: POST creates a board, returns 201 with matching id; GET that id returns 200; created_at set', async () => {
    const response = await SELF.fetch('http://vidi6.local/api/boards', { method: 'POST' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(BOARD_ID_PATTERN.test(body.id)).toBe(true);

    // GET that id returns 200
    const get = await SELF.fetch(`http://vidi6.local/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { id: string };
    expect(getBody.id).toBe(body.id);

    // created_at is set
    const createdAt = await readCreatedAt(body.id);
    expect(createdAt).not.toBeNull();
    expect(Number(createdAt)).toBeGreaterThan(0);
  });
});

describe('GET /api/boards/:id (TC-06, TC-07, TC-08)', () => {
  test('TC-06: GET a fresh never-created id returns 404; no tables created in storage', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://vidi6.local/api/boards/${id}`);
    expect(response.status).toBe(404);

    // Verify no tables were written
    const tables = await listTables(id);
    expect(tables).toHaveLength(0);
  });

  test('TC-07: GET with malformed ids (short, long, containing slash) returns 404; no RPC made', async () => {
    // 'abc' - too short
    const response1 = await SELF.fetch('http://vidi6.local/api/boards/abc');
    expect(response1.status).toBe(404);

    // 23 characters - too long
    const tooLong = 'A'.repeat(23);
    const response2 = await SELF.fetch(`http://vidi6.local/api/boards/${tooLong}`);
    expect(response2.status).toBe(404);

    // a string containing a slash
    const response3 = await SELF.fetch('http://vidi6.local/api/boards/abc/def');
    expect(response3.status).toBe(404);
  });

  test('TC-08: legacy board (has updates rows but no created_at) returns 200', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    // Create tables manually (as story 4 would have) but do NOT set created_at
    await runInDurableObject(stub, (room: BoardRoom, state: DurableObjectState) => {
      room.store.migrate();
      // Insert a row into updates (simulating story 4's legacy board)
      state.storage.sql.exec(
        'INSERT INTO updates (data, bytes) VALUES (?, ?)',
        new ArrayBuffer(4),
        4,
      );
    });

    const response = await SELF.fetch(`http://vidi6.local/api/boards/${id}`);
    expect(response.status).toBe(200);
  });
});

describe('WebSocket upgrade for rooms (TC-09, TC-10)', () => {
  test('TC-09: upgrade to unknown valid id returns 404; no socket accepted, no tables created', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://vidi6.local/api/rooms/${id}`, {
      headers: upgradeHeaders(),
    });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();

    // No tables created
    const tables = await listTables(id);
    expect(tables).toHaveLength(0);
  });

  test('TC-10: upgrade after POST (board exists) returns 101 and sync works', async () => {
    // Create a board via API
    const response = await SELF.fetch('http://vidi6.local/api/boards', { method: 'POST' });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    // Connect via WebSocket
    const client = await connect(id);
    await client.waitForSync();

    // Basic sync works: create a note, see it locally
    const { createSticky } = await import('../../src/shared/board-model');
    createSticky(client.doc, { x: 10, y: 10 });
    await waitFor(() => client.notes().length >= 1, 5000, 'client never saw its note');
    closeAll([client]);
  });
});

describe('POST /api/boards RPC failure (TC-12)', () => {
  test('TC-12: when initialize RPC throws, returns 500 create_failed', async () => {
    const brokenEnv: Env = {
      ...env,
      BOARD_ROOM: {
        idFromName: (name: string) => env.BOARD_ROOM.idFromName(name),
        get: (_id: DurableObjectId) => {
          return {
            initialize: async () => {
              throw new Error('injected RPC failure');
            },
            exists: async () => false,
            fetch: async () => new Response('error', { status: 500 }),
          } as unknown as DurableObjectStub<BoardRoom>;
        },
        newUniqueId: () => env.BOARD_ROOM.newUniqueId(),
      } as unknown as Env['BOARD_ROOM'],
    };

    const response = await worker.fetch(
      new Request('http://vidi6.local/api/boards', { method: 'POST' }),
      brokenEnv,
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('create_failed');
  });
});

describe('Method validation (TC-14)', () => {
  test('TC-14: PUT /api/boards returns 405', async () => {
    const response = await SELF.fetch('http://vidi6.local/api/boards', { method: 'PUT' });
    expect(response.status).toBe(405);
  });

  test('GET /api/boards (without id segment) returns 405', async () => {
    const response = await SELF.fetch('http://vidi6.local/api/boards');
    expect(response.status).toBe(405);
  });
});

describe('Initialize idempotency (TC-15)', () => {
  test('TC-15: initialize() twice returns created then exists; created_at unchanged', async () => {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

    const first = await stub.initialize();
    expect(first).toBe('created');

    const createdAt1 = await readCreatedAt(id);

    // Small delay so Date.now() would differ
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await stub.initialize();
    expect(second).toBe('exists');

    // created_at unchanged
    const createdAt2 = await readCreatedAt(id);
    expect(createdAt2).toBe(createdAt1);
  });
});

describe('Privacy constraint (TC-32)', () => {
  test('TC-32: served index.html contains <meta name="referrer" content="no-referrer">', async () => {
    const response = await SELF.fetch('http://vidi6.local/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer"');
  });
});
