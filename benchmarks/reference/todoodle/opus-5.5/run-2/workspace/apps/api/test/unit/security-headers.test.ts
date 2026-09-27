import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/app';
import { requestId } from '../../src/middleware/request-id';
import { finalizeResponse } from '../../src/middleware/security-headers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function expectBaseline(res: Response) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  expect(res.headers.get('Content-Security-Policy')).toBe(
    "default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'",
  );
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
}

describe('finalizeResponse', () => {
  it('TC-P09 sets every baseline header, overrides the handler value, keeps status and body', async () => {
    const handler = new Response('{"made":"by handler"}', {
      status: 201,
      headers: { 'Referrer-Policy': 'unsafe-url', 'Content-Type': 'application/json', 'X-Custom': 'kept' },
    });
    const res = finalizeResponse(handler, { requestId: 'req-1', path: '/api/things' });
    expectBaseline(res);
    expect(res.headers.get('X-Request-Id')).toBe('req-1');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Custom')).toBe('kept');
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"made":"by handler"}');
  });

  it.each(['/api', '/api/x', '/health', '/test/reset'])('marks %s no-store', (path) => {
    const res = finalizeResponse(new Response('x'), { requestId: 'r', path });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['/', '/w', '/assets/index-abc.js', '/apiary', '/healthy'])(
    'leaves caching of %s to the asset layer',
    (path) => {
      const res = finalizeResponse(
        new Response('x', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
        { requestId: 'r', path },
      );
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expectBaseline(res);
    },
  );

  it('works on responses with immutable headers', async () => {
    const immutable = await fetch('data:text/plain,hi').catch(() => Response.redirect('https://a.test/'));
    const res = finalizeResponse(immutable, { requestId: 'r', path: '/' });
    expectBaseline(res);
  });
});

describe('request-id middleware', () => {
  it('TC-P10 gives consecutive requests distinct UUIDs and overrides handler headers', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId);
    app.get('*', (c) => {
      c.header('Referrer-Policy', 'origin');
      return c.text('ok');
    });
    const first = await app.request('/x');
    const second = await app.request('/x');
    const a = first.headers.get('X-Request-Id');
    const b = second.headers.get('X-Request-Id');
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
    expectBaseline(first);
  });
});
