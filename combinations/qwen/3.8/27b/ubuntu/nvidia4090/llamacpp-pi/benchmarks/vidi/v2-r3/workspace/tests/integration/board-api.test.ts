/**
 * Story 5 (share.board_api): the board API against the real Worker, real
 * Durable Objects and real SQLite (via wrangler dev).
 *
 * Covers TC-05..TC-10, TC-12, TC-14, TC-15 and TC-32: creation, the
 * existence check, no materialization for unknown/malformed ids, legacy
 * boards, rooms refusing unknown boards, story 3 sync on a created board,
 * injected creation failures, method handling, initialize idempotence and
 * the no-referrer meta in the served index.html.
 */
import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { buildRetroBoard } from '../fixtures/boards';
import { BASE, RoomClient, boardUrl } from './ws-client';
import { b64, createBoard, hooks, setCreateBoardFault } from './hooks';

/**
 * Raw HTTP GET via node:http, like worker.test.ts: undici's fetch() forbids
 * setting the `Upgrade` header, and TC-09 must prove an *upgrade* request to
 * an unknown board is refused with 404 (no socket accepted).
 */
function rawUpgradeGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const { hostname, port } = new URL(BASE);
    const req = http.request(
      {
        host: hostname,
        port,
        path,
        method: 'GET',
        headers: {
          Host: `${hostname}:${port}`,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', rejectPromise);
    req.end();
  });
}

describe('board API (story 5, share.board_api)', () => {
  it('TC-05: POST /api/boards creates a board; GET exists; created_at is set', async () => {
    const res = await fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(isValidBoardId(body.id)).toBe(true);

    const get = await fetch(`${BASE}/api/boards/${body.id}`);
    expect(get.status).toBe(200);
    expect((await get.json()) as { id: string }).toEqual({ id: body.id });

    const status = await hooks.status(body.id);
    expect(status.createdAt).not.toBeNull();
  });

  it('TC-06: GET for an unknown board is 404 and materializes no storage', async () => {
    const id = newBoardId();
    const res = await fetch(`${BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });

    // No table of the board's storage may exist (the probe is read-only).
    const status = await hooks.status(id);
    expect(status.tables).toEqual([]);
    expect(status.createdAt).toBeNull();
  });

  it('TC-07: malformed ids are 404 and never reach a Durable Object', async () => {
    for (const bad of ['abc', 'a'.repeat(23), 'a b']) {
      const res = await fetch(`${BASE}/api/boards/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(404);
    }
    // A malformed id never names a board, so no storage exists under it.
    const status = await hooks.status('a'.repeat(23));
    expect(status.tables).toEqual([]);
  });

  it('TC-08: a legacy board (data present, no created_at) exists', async () => {
    // (a) A story-4-era board: schema + update rows, but no created_at.
    const idA = newBoardId();
    const { perNoteUpdates } = buildRetroBoard();
    await hooks.append(idA, perNoteUpdates[0]);
    const resA = await fetch(`${BASE}/api/boards/${idA}`);
    expect(resA.status).toBe(200);
    expect((await resA.json()) as { id: string }).toEqual({ id: idA });
    const statusA = await hooks.status(idA);
    expect(statusA.createdAt).toBeNull();
    expect(statusA.updates.count).toBe(1);

    // (b) A raw legacy state: an update row but not even a schema-version
    // row — the existence fallback must still say "exists".
    const idB = newBoardId();
    const hex = Array.from(perNoteUpdates[0])
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await fetch(`${BASE}/__test/boards/${idB}/raw-sql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sql: `CREATE TABLE updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, bytes INTEGER NOT NULL);
              INSERT INTO updates (data, bytes) VALUES (X'${hex}', ${perNoteUpdates[0].length});`,
        params: [],
      }),
    }).then(async (r) => {
      expect(r.status).toBe(200);
    });
    const resB = await fetch(`${BASE}/api/boards/${idB}`);
    expect(resB.status).toBe(200);
    const statusB = await hooks.status(idB);
    expect(statusB.createdAt).toBeNull();
  });

  it('TC-09: an upgrade request to an unknown board is 404 with no socket and no tables', async () => {
    const id = newBoardId();
    const raw = await rawUpgradeGet(`/api/rooms/${id}`);
    expect(raw.status).toBe(404);
    expect(raw.body).toContain('Not Found');

    const status = await hooks.status(id);
    expect(status.tables).toEqual([]);
  });

  it('TC-10: an upgrade right after POST succeeds (101) and story 3 sync works', async () => {
    const id = await createBoard();
    const a = await RoomClient.connect(boardUrl(id));
    await a.waitForSync();
    const b = await RoomClient.connect(boardUrl(id));
    await b.waitForSync();

    // Live sync still works on a created board: a note from A reaches B.
    const { createSticky } = await import('../../src/shared/board-model');
    createSticky(a.doc, { x: 0, y: 0 }, 'yellow');
    await b.waitForUpdates(1);
    expect(b.notes()).toHaveLength(1);
    a.close();
    b.close();
  });

  it('TC-12: an initialize that throws or reports exists fails creation with 500', async () => {
    // Clear any fault left by an earlier run.
    await setCreateBoardFault('clear');

    await setCreateBoardFault('throw');
    let res = await fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });

    await setCreateBoardFault('exists');
    res = await fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'create_failed' });

    // Healthy again after clearing the fault.
    await setCreateBoardFault('clear');
    res = await fetch(`${BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('TC-14: wrong methods on the board API are 405', async () => {
    expect((await fetch(`${BASE}/api/boards`, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(`${BASE}/api/boards`, { method: 'GET' })).status).toBe(405);
    const id = newBoardId();
    expect((await fetch(`${BASE}/api/boards/${id}`, { method: 'POST' })).status).toBe(405);
  });

  it('TC-15: initialize() twice on the same object — created, then exists; created_at unchanged', async () => {
    const id = newBoardId();
    expect((await hooks.boardInitialize(id)) as { result: string }).toEqual({ result: 'created' });
    const first = (await hooks.status(id)).createdAt;
    expect(first).not.toBeNull();
    expect((await hooks.boardInitialize(id)) as { result: string }).toEqual({ result: 'exists' });
    const second = (await hooks.status(id)).createdAt;
    expect(second).toBe(first);
  });

  it('TC-32: the served index.html carries meta referrer no-referrer', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toMatch(/<meta[^>]*name=["']referrer["'][^>]*content=["']no-referrer["'][^>]*>/i);
  });
});
