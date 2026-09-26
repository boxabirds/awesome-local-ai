import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/app.ts';
import { requestId } from '../../src/middleware/request-id.ts';
import { CONTENT_SECURITY_POLICY, finalizeResponse, securityHeaders } from '../../src/middleware/security-headers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function expectBaseline(res: Response) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
}

describe('finalizeResponse', () => {
  it('TC-P09 sets every baseline header, overrides the handler Referrer-Policy and preserves status and body', async () => {
    const handlerResponse = new Response('{"created":true}', {
      status: 201,
      headers: { 'Referrer-Policy': 'unsafe-url', 'Content-Type': 'application/json', 'X-Custom': 'kept' },
    });
    const res = finalizeResponse(handlerResponse, { requestId: 'req-1', path: '/api/things' });

    expectBaseline(res);
    expect(res.headers.get('X-Request-Id')).toBe('req-1');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Custom')).toBe('kept');
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"created":true}');
  });

  it('finalizes immutable responses such as asset fetches', async () => {
    const immutable = Response.redirect('https://todoodle.test/elsewhere', 302);
    const res = finalizeResponse(immutable, { requestId: 'req-2', path: '/' });
    expectBaseline(res);
    expect(res.status).toBe(302);
  });

  it.each(['/api/things', '/api', '/health', '/test/reset'])('marks %s as no-store', (path) => {
    const res = finalizeResponse(new Response('x'), { requestId: 'r', path });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['/', '/w/abc', '/assets/index-abc123.js', '/apiary', '/healthy'])('leaves caching of %s alone', (path) => {
    const res = finalizeResponse(new Response('x', { headers: { 'Cache-Control': 'public, max-age=31536000' } }), {
      requestId: 'r',
      path,
    });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000');
  });
});

describe('request id', () => {
  it('TC-P10 gives consecutive requests distinct UUIDs', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', securityHeaders);
    app.use('*', requestId);
    app.get('*', (c) => c.text('ok'));

    const first = (await app.request('/api/a')).headers.get('X-Request-Id');
    const second = (await app.request('/api/a')).headers.get('X-Request-Id');
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
  });
});

describe('finalizeResponse: WebSocket upgrades (story 4)', () => {
  it('passes a 101 through untouched, keeping its webSocket', () => {
    const pair = new WebSocketPair();
    const upgrade = new Response(null, { status: 101, webSocket: pair[0] });
    const res = finalizeResponse(upgrade, { requestId: 'r', path: '/api/w/x/live' });
    expect(res).toBe(upgrade);
    expect(res.webSocket).toBe(pair[0]);
  });
});
