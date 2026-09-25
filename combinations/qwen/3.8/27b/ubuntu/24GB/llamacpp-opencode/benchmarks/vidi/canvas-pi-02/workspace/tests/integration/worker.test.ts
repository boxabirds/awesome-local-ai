import { SELF, env, listDurableObjectIds } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { describe, expect, it } from 'vitest';

/**
 * sync.worker_entry — the Worker's routing (task 5: TC-04 to TC-06, plus the
 * SPA-fallback behaviour the client relies on).
 */
describe('sync.worker_entry', () => {
  it('TC-04 invalid board id with Upgrade -> 400, and no object instance is created', async () => {
    // Ids that survive URL normalisation (no real '/' or '..' segments) and
    // therefore reach the room route; the Worker must reject them there.
    // (A literal `../` in the path is normalised away by the URL parser
    // before the Worker sees it, so traversal cannot reach a room id.)
    // "No object instance" is shown by the namespace listing staying put,
    // which implies idFromName/fetch were never called for these ids.
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    for (const bad of ['..%2Fx', '%2e%2e%2f', 'abc', 'aaaaaaaaaaaaaaaaaaaaaa!', 'aaaaaaaaaaaaaaaaaaaaaaa']) {
      const res = await SELF.fetch(`http://localhost/api/rooms/${bad}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      expect(res.status, `id ${bad}`).toBe(400);
    }
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after).toEqual(before);
  });

  it('TC-05 valid id without Upgrade -> 426', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06 GET /b/<valid> -> 200 index.html (SPA fallback)', async () => {
    const res = await SELF.fetch(`http://localhost/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });

  it('additional: GET / -> 200 index.html', async () => {
    const res = await SELF.fetch('http://localhost/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('additional: unknown client routes fall back to index.html (SPA)', async () => {
    const res = await SELF.fetch(`http://localhost/b/${newBoardId()}/whatever`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<div id="root">');
  });
});

describe('persist.test_hooks (production gate)', () => {
  // This pool runs the base wrangler config: TEST_HOOKS is unset, so the
  // /__test routes must NOT exist. They fall through to the SPA assets and
  // must never instantiate a Durable Object (task 9: "production build has
  // no hook routes — a request to them gets the SPA/404"). The enabled path
  // is exercised by the persist e2e (TC-24) against wrangler `--env e2e`.
  // The assets runtime answers a POST to an unknown path with its own
  // 405 (the SPA fallback applies to GET/HEAD only) — either way the
  // response comes from the static layer, never from the hook (204).
  const assertNotAHook = async (res: Response): Promise<void> => {
    expect(res.status, 'must not be the hook\'s 204').not.toBe(204);
    const body = await res.text();
    expect(body).not.toContain('test hook');
  };

  it('POST /__test/boards/:id/corrupt-snapshot without TEST_HOOKS -> static layer, no DO instance', async () => {
    const boardId = newBoardId();
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/corrupt-snapshot`, {
      method: 'POST',
    });
    await assertNotAHook(res);
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after, 'the hook must not create a Durable Object instance').toEqual(before);
  });

  it('POST /__test/boards/:id/repair without TEST_HOOKS -> static layer, no DO instance', async () => {
    const boardId = newBoardId();
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/repair`, {
      method: 'POST',
    });
    await assertNotAHook(res);
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after, 'the hook must not create a Durable Object instance').toEqual(before);
  });

  it('POST /__test/boards/:id/hibernate without TEST_HOOKS -> static layer, no DO instance', async () => {
    const boardId = newBoardId();
    const before = await listDurableObjectIds(env.BOARD_ROOM);
    const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/hibernate`, {
      method: 'POST',
    });
    await assertNotAHook(res);
    const after = await listDurableObjectIds(env.BOARD_ROOM);
    expect(after, 'the hook must not create a Durable Object instance').toEqual(before);
  });
});
