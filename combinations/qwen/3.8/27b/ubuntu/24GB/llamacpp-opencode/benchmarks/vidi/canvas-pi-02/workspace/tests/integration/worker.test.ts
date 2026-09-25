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
