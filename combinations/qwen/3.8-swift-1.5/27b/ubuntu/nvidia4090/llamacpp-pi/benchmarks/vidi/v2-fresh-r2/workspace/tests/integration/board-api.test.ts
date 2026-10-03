/**
 * Story 5, share.board_api: board creation and existence API against the
 * real Worker, real Durable Object RPC and real SQLite (workerd, no mocks).
 *
 * TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.
 */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { RoomClient } from './helpers/ws-client';
import { createSticky, snapshot } from '../../src/shared/board-model';

const BASE = 'http://localhost';
const UPGRADE_HEADERS = { Upgrade: 'websocket', Connection: 'Upgrade' };

/** Table names in the board's SQLite storage (test hook; read-only). */
async function tables(boardId: string): Promise<string[]> {
  const res = await SELF.fetch(`${BASE}/__test/boards/${boardId}/tables`);
  expect(res.status).toBe(200);
  return (await res.json()) as string[];
}

/** Run a read-only SQL query inside the board's Durable Object (test hook). */
async function sql(boardId: string, query: string): Promise<unknown[]> {
  const res = await SELF.fetch(`${BASE}/__test/boards/${boardId}/sql`, {
    method: 'POST',
    body: query,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as unknown[];
}

/** Created_at value (epoch ms string) or null. */
async function createdAt(boardId: string): Promise<string | null> {
  const rows = (await sql(
    boardId,
    "SELECT value FROM storage_meta WHERE key = 'created_at'",
  )) as Array<{ value: string }>;
  return rows.length > 0 ? rows[0].value : null;
}

describe('board creation and existence API (integration)', () => {
  it('TC-05: POST /api/boards → 201 with a valid id; GET that id → 200; created_at set', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    const get = await SELF.fetch(`${BASE}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect((await get.json()) as { id: string }).toEqual({ id: body.id });

    expect(await createdAt(body.id)).not.toBeNull();
  }, 20000);

  it('TC-06: GET /api/boards/<fresh id> → 404 and no storage is written', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    // Probing must not create tables (negative).
    expect(await tables(boardId)).toEqual([]);
  }, 20000);

  it('TC-07: malformed ids → 404 without touching the namespace', async () => {
    const short = 'abc';
    const tooLong = 'a'.repeat(23);
    for (const bad of [short, tooLong]) {
      const res = await SELF.fetch(`${BASE}/api/boards/${bad}`);
      expect(res.status).toBe(404);
      expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });
    }
    // Neither id may have produced storage (negative). The test-hook lookup
    // instantiates the objects read-only; the worker's 404 path never did.
    expect(await tables(short)).toEqual([]);
    expect(await tables(tooLong)).toEqual([]);
  }, 20000);

  it('TC-08: legacy board (updates row, no created_at) → GET 200', async () => {
    const boardId = newBoardId();
    const seed = await SELF.fetch(`${BASE}/__test/boards/${boardId}/seed-legacy`, {
      method: 'POST',
    });
    expect(seed.status).toBe(200);

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}`);
    expect(res.status).toBe(200);

    // Still legacy: data present, created_at absent.
    expect(await createdAt(boardId)).toBeNull();
    const rows = (await sql(boardId, 'SELECT COUNT(*) AS c FROM updates')) as Array<{ c: number }>;
    expect(rows[0].c).toBeGreaterThan(0);
  }, 20000);

  it('TC-09: WebSocket upgrade to an unknown id → 404, no socket, no tables', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/rooms/${boardId}`, {
      headers: UPGRADE_HEADERS,
    });
    expect(res.status).toBe(404);
    expect(res.webSocket ?? null).toBeNull();

    // No storage written by the rejected upgrade (negative).
    expect(await tables(boardId)).toEqual([]);
  }, 20000);

  it('TC-10: upgrade after POST → 101 and story 3 sync works', async () => {
    const created = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const client = new RoomClient(id);
    await client.connect();
    await client.waitForSync();

    const noteId = createSticky(client.doc, { x: 10, y: 10 });
    expect(snapshot(client.doc).some((n) => n.id === noteId)).toBe(true);
    client.close();
  }, 30000);

  it('TC-12: initialize() throwing → 500 create_failed', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards`, {
      method: 'POST',
      headers: { 'x-vidi6-test-fail-initialize': '1' },
    });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });
  }, 20000);

  it('TC-14: PUT /api/boards → 405', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'PUT' });
    expect(res.status).toBe(405);
  }, 15000);

  it("TC-15: initialize() twice → 'created' then 'exists'; created_at unchanged", async () => {
    const boardId = newBoardId();
    const first = await SELF.fetch(`${BASE}/__test/boards/${boardId}/init`, {
      method: 'POST',
    });
    expect(first.status).toBe(200);
    expect((await first.json()) as { result: string }).toEqual({ result: 'created' });
    const firstCreatedAt = await createdAt(boardId);
    expect(firstCreatedAt).not.toBeNull();

    // Give the timestamp a chance to tick so 'unchanged' is meaningful.
    await new Promise((r) => setTimeout(r, 5));
    const second = await SELF.fetch(`${BASE}/__test/boards/${boardId}/init`, {
      method: 'POST',
    });
    expect(second.status).toBe(200);
    expect((await second.json()) as { result: string }).toEqual({ result: 'exists' });
    expect(await createdAt(boardId)).toBe(firstCreatedAt);
  }, 20000);

  it('TC-32: served index.html carries <meta name="referrer" content="no-referrer">', async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  }, 15000);
});
