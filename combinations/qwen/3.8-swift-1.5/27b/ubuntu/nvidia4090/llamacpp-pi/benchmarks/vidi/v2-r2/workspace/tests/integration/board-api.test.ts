import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as Y from 'yjs';
import { startServer, stopServer, URL, createBoard } from './server';
import { createTestClient, waitForCondition } from './ws-client';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id';
import { initDoc, createSticky, snapshot } from '../../src/shared/board-model';
import { toB64 } from '../fixtures/boards';

async function sqlHook(boardId: string, query: string, params: (string | number)[] = []): Promise<unknown[][]> {
  const res = await fetch(`${URL}/__test/boards/${boardId}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  const body = await res.json() as { ok: boolean; rows?: unknown[][] };
  if (!body.ok) throw new Error(`sql hook failed: ${JSON.stringify(body)}`);
  return body.rows ?? [];
}

/**
 * Story 5: the board creation and existence API.
 *
 * Boots one `wrangler dev` (TEST_HOOKS=1) for the whole file, like the
 * other integration suites.
 */
describe('Board creation and existence API (story 5)', () => {
  beforeAll(async () => {
    // TC-32 asserts on the served index.html: build the client first.
    execSync('npm run build', { stdio: 'inherit' });
    await startServer();
  }, 180000);

  afterAll(async () => {
    await stopServer();
  });

  it('TC-05: POST /api/boards → 201 with a valid id; GET → 200; created_at set', async () => {
    const res = await fetch(`${URL}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(isValidBoardId(body.id)).toBe(true);

    const get = await fetch(`${URL}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect((await get.json() as { id: string }).id).toBe(body.id);

    const rows = await sqlHook(
      body.id,
      "SELECT value FROM storage_meta WHERE key = 'created_at'"
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0][0])).toBeGreaterThan(0);
  });

  it('TC-06: GET for a fresh id that was never created → 404, and no storage written', async () => {
    const unknown = newBoardId();
    const get = await fetch(`${URL}/api/boards/${unknown}`);
    expect(get.status).toBe(404);
    expect((await get.json() as { error: string }).error).toBe('not_found');

    // Probing must not have written anything: the board's storage has no
    // tables at all (the sql hook instantiates the DO, which must not
    // migrate).
    const rows = await sqlHook(unknown, "SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(rows).toHaveLength(0);
  });

  it('TC-07: malformed ids → 404 without touching the Durable Object namespace', async () => {
    // 23 chars: valid-looking length, invalid length.
    const tooLong = 'a'.repeat(23);
    const tooShort = 'a'.repeat(21);
    const badChars = 'abc!';
    for (const bad of [tooLong, tooShort, badChars]) {
      const get = await fetch(`${URL}/api/boards/${encodeURIComponent(bad)}`);
      expect(get.status).toBe(404);
      expect((await get.json() as { error: string }).error).toBe('not_found');
    }
    // Note: "no RPC was made" is guaranteed by the worker rejecting ids that
    // fail isValidBoardId before idFromName() is called; it is not directly
    // observable in dev (the constructor writes no storage).
  });

  it('TC-08: legacy board (updates rows, no created_at) → GET 200', async () => {
    const legacy = newBoardId();
    // Seed one real Yjs update as an `updates` row without created_at —
    // exactly the storage shape story 4 left behind.
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const update = Y.encodeStateAsUpdate(doc);

    const seed = await fetch(`${URL}/__test/boards/${legacy}/legacy-seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatesB64: [toB64(update)] }),
    });
    expect((await seed.json() as { ok: boolean }).ok).toBe(true);

    const get = await fetch(`${URL}/api/boards/${legacy}`);
    expect(get.status).toBe(200);
    expect((await get.json() as { id: string }).id).toBe(legacy);
  });

  it('TC-09: WebSocket upgrade for an unknown id → 404, no socket, no storage', async () => {
    const unknown = newBoardId();
    const wsUrl = URL.replace('http', 'ws') + `/api/rooms/${unknown}`;
    const ws = new WebSocket(wsUrl);
    const opened = new Promise<boolean>((resolve) => {
      ws.addEventListener('open', () => resolve(true));
      ws.addEventListener('error', () => resolve(false));
    });
    expect(await opened).toBe(false);
    ws.close();

    const rows = await sqlHook(unknown, "SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(rows).toHaveLength(0);
  });

  it('TC-10: upgrade right after POST → 101 and story 3 sync works', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    initDoc(a.doc);
    createSticky(a.doc, { x: 100, y: 100 });

    // A second client joins and sees the note (story 3 sync is intact).
    const b = await createTestClient(URL, boardId);
    await waitForCondition(() => snapshot(b.doc).length === 1, 10000, 'B to see the note');
    expect(snapshot(b.doc)).toHaveLength(1);

    a.destroy();
    b.destroy();
  });

  it('TC-12: initialize() throwing → 500 create_failed', async () => {
    // Arm one-shot initialize failures (global: createBoard generates its
    // own random id, so a per-board fault cannot target it).
    const arm = await fetch(`${URL}/__test/initialize-failures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    });
    expect((await arm.json() as { ok: boolean }).ok).toBe(true);

    const res = await fetch(`${URL}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('create_failed');

    // The fault is one-shot: the next creation succeeds.
    const res2 = await fetch(`${URL}/api/boards`, { method: 'POST' });
    expect(res2.status).toBe(201);
  });

  it('TC-14: PUT /api/boards → 405', async () => {
    const res = await fetch(`${URL}/api/boards`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('TC-15: initialize() twice → "created" then "exists"; created_at unchanged', async () => {
    const boardId = newBoardId();
    const first = await fetch(`${URL}/__test/boards/${boardId}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect((await first.json() as { ok: boolean; result: string }).result).toBe('created');

    const rowsBefore = await sqlHook(
      boardId,
      "SELECT value FROM storage_meta WHERE key = 'created_at'"
    );
    expect(rowsBefore).toHaveLength(1);

    const second = await fetch(`${URL}/__test/boards/${boardId}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect((await second.json() as { ok: boolean; result: string }).result).toBe('exists');

    const rowsAfter = await sqlHook(
      boardId,
      "SELECT value FROM storage_meta WHERE key = 'created_at'"
    );
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0][0]).toBe(rowsBefore[0][0]);
  });

  it('TC-32: served index.html contains the no-referrer meta tag', async () => {
    const res = await fetch(`${URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Vite minifies the HTML (self-closing tag spacing may vary).
    expect(html).toMatch(/name="referrer"\s+content="no-referrer"/);
  });
});
