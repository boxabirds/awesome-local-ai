import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { newBoardId } from '../../src/shared/board-id';
import { BASE } from './ws-client';

/**
 * Raw HTTP request via node:http. Unlike undici's fetch(), it allows setting
 * a forbidden `Upgrade` header, which is exactly what TC-04 needs to prove
 * the worker rejects a malformed id *before* it would upgrade a socket.
 */
function rawGet(path: string, extraHeaders: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const { hostname, port } = new URL(BASE);
    const req = http.request(
      {
        host: hostname,
        port,
        path,
        method: 'GET',
        headers: { Host: `${hostname}:${port}`, ...extraHeaders },
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

/**
 * Worker routing tests against the real wrangler dev server: real Worker
 * `fetch` handler, real Durable Object namespace, real assets binding.
 * ("namespace never called" is asserted through the observable outcome:
 * invalid ids never reach the room, so no WebSocket is ever upgraded.)
 */
describe('worker routing (real Worker + real Durable Objects via wrangler dev)', () => {
  it('TC-04: an invalid board id is rejected with 400 and never upgrades a room', async () => {
    const res = await rawGet('/api/rooms/not%20a%20valid%20id', {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('Bad Request');
  });

  it('TC-05: a valid id without the WebSocket upgrade gets 426', async () => {
    const res = await fetch(`${BASE}/api/rooms/${newBoardId()}`);
    expect(res.status).toBe(426);
    const body = await res.text();
    expect(body).toContain('Upgrade Required');
  });

  it('TC-06: non-room paths fall through to the static assets (SPA index)', async () => {
    const res = await fetch(`${BASE}/b/${newBoardId()}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it('TC-06b: deep SPA paths also fall through to the assets', async () => {
    const res = await fetch(`${BASE}/some/deep/route`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });
});
