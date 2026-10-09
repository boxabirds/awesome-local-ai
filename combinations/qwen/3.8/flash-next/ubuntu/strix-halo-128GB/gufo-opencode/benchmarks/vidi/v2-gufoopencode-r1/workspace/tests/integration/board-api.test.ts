import { request as nodeRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { retroBoard } from '../fixtures/boards';
import { TestClient, waitFor } from './ws-client';

// Story 5 share.board_api against the real Worker: POST /api/boards + the
// initialize()/exists() RPC, the 404 rule on the room route, and the
// legacy-board existence rule, all landing in the room's real SQLite.
let base = '';
let port = 0;
let closeHarness: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const harness = createTestHarness({
    workers: [{ configPath: './wrangler.jsonc', vars: { TEST_HOOKS: '1' } }]
  });
  const { url } = await harness.listen();
  base = url.toString().replace(/\/$/, '');
  port = Number(new URL(url).port);
  closeHarness = () => harness.close();
}, 180_000);

afterAll(async () => {
  if (closeHarness !== null) await closeHarness();
});

// The board's own SQLite tables, ignoring runtime-internal ones (Miniflare
// creates __miniflare_do_name the moment an object's storage is touched).
function appTables(tables: string[]): string[] {
  return tables.filter((name) => !name.startsWith('__'));
}

async function hookJson(id: string, action: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/__test/boards/${id}/${action}`, init);
  expect(response.status, action).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe('share.board_api', () => {
  it('TC-05 POST creates a board: 201, code format, GET 200, created_at stored', async () => {
    const created = await fetch(`${base}/api/boards`, { method: 'POST' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(BOARD_ID_PATTERN);

    const checked = await fetch(`${base}/api/boards/${id}`);
    expect(checked.status).toBe(200);
    expect(((await checked.json()) as { id: string }).id).toBe(id);

    const { meta } = (await hookJson(id, 'meta')) as { meta: Record<string, string> | null };
    expect(meta).not.toBeNull();
    expect(Number(meta?.['created_at'])).toBeGreaterThan(0);
  });

  it('TC-06 GET for a never-created id is 404 and writes no storage (negative)', async () => {
    const id = newBoardId();
    const response = await fetch(`${base}/api/boards/${id}`);
    expect(response.status).toBe(404);
    const { tables } = (await hookJson(id, 'tables')) as { tables: string[] };
    expect(appTables(tables)).toEqual([]);
  });

  it('TC-07 malformed codes are 404 without a Durable Object RPC (negative)', async () => {
    for (const bad of ['abc', 'a'.repeat(23), 'bad!id', '']) {
      const response = await fetch(`${base}/api/boards/${bad}`);
      expect(response.status, `code ${bad}`).toBe(404);
    }
    const untouched = newBoardId();
    const idle = await fetch(`${base}/__test/rpc-calls?id=${untouched}`);
    expect(((await idle.json()) as { calls: number }).calls).toBe(0);
    expect((await fetch(`${base}/api/boards/${untouched}`)).status).toBe(404);
    const after = await fetch(`${base}/__test/rpc-calls?id=${untouched}`);
    expect(((await after.json()) as { calls: number }).calls).toBe(1);
  });

  it('TC-08 a legacy board (updates rows, no created_at) exists', async () => {
    const id = newBoardId();
    const board = retroBoard();
    const seeded = await hookJson(id, 'seed-legacy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: board.updates.map((u) => Buffer.from(u).toString('base64')) })
    });
    expect(seeded['ok']).toBe(true);

    const response = await fetch(`${base}/api/boards/${id}`);
    expect(response.status).toBe(200);
    const { meta } = (await hookJson(id, 'meta')) as { meta: Record<string, string> | null };
    expect(meta?.['created_at']).toBeUndefined();
  });

  it('TC-09 a WebSocket upgrade to an unknown id is 404 with no socket and no storage (negative)', async () => {
    const id = newBoardId();
    const status = await new Promise<number>((resolve, reject) => {
      const req = nodeRequest(
        { host: '127.0.0.1', port, path: `/api/rooms/${id}`, headers: { upgrade: 'websocket' } },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? -1);
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
    const { tables } = (await hookJson(id, 'tables')) as { tables: string[] };
    expect(appTables(tables)).toEqual([]);
  });

  it('TC-10 upgrade after POST opens the socket and story 3 sync works', async () => {
    const created = await fetch(`${base}/api/boards`, { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const a = await TestClient.connected(port, id);
    const b = await TestClient.connected(port, id);
    const createdId = createSticky(a.doc, { x: 5, y: 6 });
    expect(typeof createdId).toBe('string');
    if (typeof createdId !== 'string') throw new Error('note not created');
    const noteId = createdId;
    await waitFor(
      () => (b.doc.getMap('objects').get(noteId) as unknown) !== undefined,
      'synced note on second client',
      id
    );
    await a.close();
    await b.close();
  });

  it('TC-12 a failing initialize yields 500 create_failed and no half board', async () => {
    const armed = await fetch(`${base}/__test/fail-initialize`, { method: 'POST' });
    expect(armed.status).toBe(200);
    const failed = await fetch(`${base}/api/boards`, { method: 'POST' });
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: string }).error).toBe('create_failed');
    // The one-shot injection is spent; creation works again.
    const recovered = await fetch(`${base}/api/boards`, { method: 'POST' });
    expect(recovered.status).toBe(201);
  });

  it('TC-14 wrong methods on the board API are 405', async () => {
    expect((await fetch(`${base}/api/boards`, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(`${base}/api/boards`, { method: 'GET' })).status).toBe(405);
    const id = newBoardId();
    expect((await fetch(`${base}/api/boards/${id}`, { method: 'DELETE' })).status).toBe(405);
  });

  it('TC-15 initialize() twice reports created then exists with an unchanged created_at', async () => {
    const id = newBoardId();
    const first = await hookJson(id, 'initialize');
    expect(first['result']).toBe('created');
    const metaFirst = ((await hookJson(id, 'meta')) as { meta: Record<string, string> }).meta['created_at'];
    const second = await hookJson(id, 'initialize');
    expect(second['result']).toBe('exists');
    const metaSecond = ((await hookJson(id, 'meta')) as { meta: Record<string, string> }).meta['created_at'];
    expect(metaSecond).toBe(metaFirst);
  });

  it('TC-32 the served index.html carries the no-referrer policy', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
  });
});
