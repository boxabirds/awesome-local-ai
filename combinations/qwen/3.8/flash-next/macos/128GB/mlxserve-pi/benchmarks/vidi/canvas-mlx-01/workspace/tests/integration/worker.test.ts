/**
 * Worker routing (`sync.worker_entry`). Drives the real entry Worker through `SELF`
 * against built client assets.
 */
import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id.js';

const upgrade = (url: string): Promise<Response> =>
  SELF.fetch(new Request(url, { headers: { Upgrade: 'websocket' } }));

describe('entry Worker routing (sync.worker_entry)', () => {
  it('TC-04 upgrades /api/rooms/:boardId with a valid id', async () => {
    const res = await upgrade(`http://self/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(101);
    expect(res.webSocket).not.toBeNull();
  });

  it('TC-05 answers a non-upgrade request with 426', async () => {
    const res = await SELF.fetch(`http://self/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
  });

  it('TC-06 serves the SPA for client routes and never 404s them', async () => {
    for (const path of ['/', '/b', '/b/1', '/some/deep/client/route']) {
      const res = await SELF.fetch(`http://self${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
  });

  it('rejects a traversal board id with 400 and never reaches a Durable Object', async () => {
    const res = await upgrade('http://self/api/rooms/..%2f..%2fsecret');
    expect(res.status).toBe(400);
    expect(res.webSocket).toBeNull();
  });

  it('rejects a too-long board id with 400', async () => {
    const res = await upgrade(`http://self/api/rooms/${'a'.repeat(23)}`);
    expect(res.status).toBe(400);
  });
});
