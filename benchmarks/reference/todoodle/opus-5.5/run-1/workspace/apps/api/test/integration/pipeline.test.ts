import { MAX_BODY_BYTES } from '@todoodle/shared/limits';
import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT, expectBaselineHeaders, url } from '../support/http.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request pipeline through the Worker', () => {
  it('TC-P11 GET /api/health carries every baseline header and no-store', async () => {
    const res = await SELF.fetch(url('/api/health'));
    expect(res.status).toBe(200);
    expectBaselineHeaders(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('TC-P12 unknown API path is a JSON 404 with baseline headers', async () => {
    const res = await SELF.fetch(url('/api/nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
    expectBaselineHeaders(res);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('TC-P13 a throwing handler returns 500 internal without stack, and logs no secrets or bodies', async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }

    const res = await SELF.fetch(url('/test/throw?token=SECRETQUERY#frag'), {
      headers: { Cookie: 'tdl_ws=SECRETVALUE', Authorization: 'Bearer SECRETAUTH' },
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal', message: expect.any(String) });
    expect(text).not.toMatch(/at |stack|Deliberate/);
    expectBaselineHeaders(res);

    const output = logged.join('\n');
    expect(output).toContain('Deliberate failure'); // the error itself is logged...
    expect(output).toContain('/test/throw');
    for (const secret of ['SECRETVALUE', 'SECRETQUERY', 'SECRETAUTH', 'tdl_ws', 'frag']) {
      expect(output).not.toContain(secret); // ...but never cookies, headers or URL query/fragment
    }
  });

  it('TC-P14 GET / and GET /w serve the SPA index with baseline headers', async () => {
    for (const path of ['/', '/w']) {
      const res = await SELF.fetch(url(path));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/^text\/html/);
      expect(await res.text()).toContain('<div id="root">');
      expectBaselineHeaders(res);
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    }
  });

  it('TC-P15 an oversize POST to /api/health is rejected with 413 before routing (not 405)', async () => {
    const body = new Uint8Array(MAX_BODY_BYTES + 1).fill(32);
    const res = await SELF.fetch(url('/api/health'), {
      method: 'POST',
      headers: { ...CLIENT, 'Content-Type': 'application/json', 'Content-Length': String(body.byteLength) },
      body,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
    expectBaselineHeaders(res);
  });

  it('TC-P16 hashed assets are not no-store but still carry a request id', async () => {
    const html = await (await SELF.fetch(url('/'))).text();
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();

    const res = await SELF.fetch(url(script!));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/javascript/);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('no-store');
    expectBaselineHeaders(res);
  });

  it('rejects a disallowed method on an SPA path with 405', async () => {
    const res = await SELF.fetch(url('/w'), { method: 'PUT', headers: CLIENT });
    expect(res.status).toBe(405);
    expectBaselineHeaders(res);
  });
});
