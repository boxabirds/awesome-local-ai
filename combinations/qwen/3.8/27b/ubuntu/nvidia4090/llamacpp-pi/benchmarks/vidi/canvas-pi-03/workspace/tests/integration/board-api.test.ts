/**
 * Story 5 — share.board_api integration tests (TC-05..TC-15) plus the
 * referrer meta (TC-32). Runs against the real integration `wrangler dev`
 * server (production workerd, real Durable Objects).
 *
 * Rate limiting (TC-13): the pinned local runtime (wrangler 3.x dev) does
 * not expose the platform `ratelimits` binding, so the worker runs its
 * in-memory fixed-window Limiter of the same interface — 10 per 60 s per
 * visitor key, exactly what the wrangler.jsonc binding declares for
 * production.
 */
import { describe, it, expect } from 'vitest';
import { BASE_URL, INTEGRATION_PORT } from './server';
import { RoomClient, settle } from './ws-client';
import { hook, storageInfo, initialize, simulateReconstruct } from './hooks';
import { newBoardId, BOARD_ID_PATTERN } from '@/shared/board-id';
import { createSticky } from '@/shared/board-model';
import { BOARD_CREATE_LIMIT } from '@/shared/config';
import { buildBoardUpdates, retroBoardSpecs } from '../fixtures/boards';

async function createBoard(visitor?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (visitor) headers['x-test-visitor'] = visitor;
  const res = await fetch(`${BASE_URL}/api/boards`, { method: 'POST', headers });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

describe('share.board_api (integration)', () => {
  it('TC-05: POST /api/boards -> 201 {id}; the board exists and has created_at', async () => {
    const { status, body } = await createBoard();
    expect(status).toBe(201);
    const id = body.id as string;
    expect(id).toMatch(BOARD_ID_PATTERN);

    const res = await fetch(`${BASE_URL}/api/boards/${id}`);
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ id });

    const info = await storageInfo(id);
    expect(info.createdAt).toBeTruthy();
    expect(Number(info.createdAt)).not.toBeNaN();
  });

  it('TC-06: GET /api/boards/<never created> -> 404 {error:"not_found"} and no storage', async () => {
    const id = newBoardId();
    const res = await fetch(`${BASE_URL}/api/boards/${id}`);
    expect(res.status).toBe(404);
    expect((await res.json())).toEqual({ error: 'not_found' });

    // Probing must leave no storage behind: no tables at all.
    const info = await storageInfo(id);
    expect(info.tables).toEqual([]);
    expect(info.createdAt).toBeNull();
  });

  it('TC-07: malformed ids -> 404 without instantiating a DO', async () => {
    for (const bad of ['abc', 'A'.repeat(23), 'not-a-board!!']) {
      const res = await fetch(`${BASE_URL}/api/boards/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(404);
      expect((await res.json())).toEqual({ error: 'not_found' });
    }
    // The worker entry validates ids BEFORE touching the Durable Object
    // namespace, so no DO is instantiated and no storage can be created
    // (share.invalid_links).
  });

  it('TC-08: a legacy board (no created_at, update rows only) exists and loads', async () => {
    const id = newBoardId();
    const { updates } = buildBoardUpdates(retroBoardSpecs());
    const seeded = await hook<{ seeded: number; storage: { createdAt: string | null } }>(
      id,
      'seed-legacy',
      { updates },
    );
    expect(seeded.status).toBe(200);
    expect(seeded.json.seeded).toBe(updates.length);
    expect(seeded.json.storage.createdAt).toBeNull();

    // The seed constructed the room on empty storage: force a reload so its
    // doc reflects the seeded rows (same pattern as the story-4 helpers).
    await simulateReconstruct(id);

    // It exists...
    const res = await fetch(`${BASE_URL}/api/boards/${id}`);
    expect(res.status).toBe(200);
    // ...and a client can connect and see the seeded notes.
    const client = new RoomClient(id);
    await client.connect();
    await client.waitSync();
    expect(client.notes()).toHaveLength(25);
    client.close();
  }, 30_000);

  it('TC-09: WebSocket upgrade to an unknown board -> 404, no socket, no storage', async () => {
    const id = newBoardId();
    const ws = new WebSocket(`ws://127.0.0.1:${INTEGRATION_PORT}/api/rooms/${id}`);
    const outcome = await new Promise<'open' | 'error'>((resolve) => {
      ws.onopen = () => resolve('open');
      ws.onerror = () => resolve('error');
    });
    expect(outcome).toBe('error'); // 404: the upgrade is refused
    ws.close();

    const info = await storageInfo(id);
    expect(info.tables).toEqual([]);
  }, 30_000);

  it('TC-10: a board created via POST can be joined over WebSocket', async () => {
    const { status, body } = await createBoard();
    expect(status).toBe(201);
    const id = body.id as string;

    const client = new RoomClient(id);
    await client.connect();
    await client.waitSync();
    const noteId = createSticky(client.doc, { x: 1, y: 2 }, 'yellow');
    expect(noteId).toBeTruthy();
    await settle(500);
    expect(client.notes().some((n) => n.id === noteId)).toBe(true);
    client.close();
  }, 30_000);

  it('TC-11: a generated id collision retries with a fresh id (existing board untouched)', async () => {
    // A real, already-created board.
    const first = await createBoard();
    expect(first.status).toBe(201);
    const existingId = first.body.id as string;
    const createdAtBefore = (await storageInfo(existingId)).createdAt;

    // Inject the generator: first draw = the existing board (collision),
    // second draw = a fresh id.
    const freshId = newBoardId();
    const res = await fetch(`${BASE_URL}/api/boards`, {
      method: 'POST',
      headers: { 'x-test-create-ids': `${existingId},${freshId}` },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(freshId);
    expect(body.id).not.toBe(existingId);

    // The existing board's created_at is untouched (initialize is idempotent).
    const info = await storageInfo(existingId);
    expect(info.createdAt).toBe(createdAtBefore);
  });

  it('TC-12: initialize failure -> 500 {error:"create_failed"}', async () => {
    const res = await fetch(`${BASE_URL}/api/boards`, {
      method: 'POST',
      headers: { 'x-test-fail-initialize': '1' },
    });
    expect(res.status).toBe(500);
    expect((await res.json())).toEqual({ error: 'create_failed' });
  });

  it(`TC-13: ${BOARD_CREATE_LIMIT} boards per visitor per window, then 429; other visitors unaffected`, async () => {
    const visitor = `ip-${crypto.randomUUID()}`;
    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const r = await createBoard(visitor);
      expect(r.status, `creation ${i + 1} should be allowed`).toBe(201);
    }
    const blocked = await createBoard(visitor);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited' });

    const other = await createBoard(`other-${crypto.randomUUID()}`);
    expect(other.status).toBe(201);
  }, 60_000);

  it('TC-14: PUT/DELETE on the boards endpoints -> 405', async () => {
    const put = await fetch(`${BASE_URL}/api/boards`, { method: 'PUT' });
    expect(put.status).toBe(405);
    const del = await fetch(`${BASE_URL}/api/boards`, { method: 'DELETE' });
    expect(del.status).toBe(405);
    const id = newBoardId();
    const putOne = await fetch(`${BASE_URL}/api/boards/${id}`, { method: 'PUT' });
    expect(putOne.status).toBe(405);
  });

  it('TC-15: initialize is idempotent — created exactly once, created_at unchanged', async () => {
    const id = newBoardId();
    const r1 = await initialize(id);
    expect(r1.result).toBe('created');
    const t1 = (await storageInfo(id)).createdAt;
    expect(t1).toBeTruthy();

    const r2 = await initialize(id);
    expect(r2.result).toBe('exists');
    const t2 = (await storageInfo(id)).createdAt;
    expect(t2).toBe(t1);
  });

  it('TC-32: served index.html carries <meta name="referrer" content="no-referrer" />', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
