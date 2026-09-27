import { SELF } from 'cloudflare:test';
import { MAX_BODY_BYTES } from '@todoodle/shared/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_HEADERS, CLIENT_HEADERS, ORIGIN, UUID } from '../helpers';

function expectBaseline(res: Response) {
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    expect(res.headers.get(name), name).toBe(value);
  }
  expect(res.headers.get('x-request-id')).toMatch(UUID);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request pipeline through the Worker', () => {
  it('TC-P11 GET /api/health carries every baseline header and no-store', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`);
    expect(res.status).toBe(200);
    expectBaseline(res);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('TC-P12 unknown API route is a JSON 404 with baseline headers', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
    expectBaseline(res);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('TC-P13 a throwing handler returns 500 internal with no stack and logs no secrets', async () => {
    const captured: unknown[][] = [];
    for (const level of ['error', 'log', 'warn', 'info', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args);
      });
    }
    const res = await SELF.fetch(`${ORIGIN}/test/throw?token=QUERYSECRET#frag`, {
      headers: { Cookie: 'tdl_ws=SECRETVALUE', Authorization: 'Bearer HEADERSECRET' },
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text) as { error: string; message: string };
    expect(body.error).toBe('internal');
    expect(text).not.toMatch(/at\s|\.ts:|Deliberate failure|stack/i);
    expectBaseline(res);

    const logged = JSON.stringify(captured, (_k, v) => (v instanceof Error ? { ...v, stack: v.stack } : v));
    expect(captured.length).toBeGreaterThan(0);
    expect(logged).toContain('Deliberate failure');
    expect(logged).toContain('/test/throw');
    expect(logged).not.toContain('SECRETVALUE');
    expect(logged).not.toContain('HEADERSECRET');
    expect(logged).not.toContain('QUERYSECRET');
  });

  it('TC-P13 a failing mutation never logs its body', async () => {
    const captured: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
    const res = await SELF.fetch(`${ORIGIN}/test/throw`, {
      method: 'POST',
      headers: { ...CLIENT_HEADERS, 'Content-Type': 'application/json', Cookie: 'tdl_ws=SECRETVALUE' },
      body: JSON.stringify({ secret: 'BODYSECRET' }),
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(captured)).not.toContain('BODYSECRET');
  });

  it.each(['/', '/w'])('TC-P14 GET %s serves the SPA index with baseline headers', async (path) => {
    const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<meta name="referrer" content="no-referrer"');
    expectBaseline(res);
    expect(res.headers.get('cache-control') ?? '').not.toContain('no-store');
  });

  it('TC-P15 oversize POST to /api/health is rejected with 413 before routing', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/health`, {
      method: 'POST',
      headers: {
        ...CLIENT_HEADERS,
        'Content-Type': 'application/json',
        'Content-Length': String(MAX_BODY_BYTES + 1),
      },
      body: `"${'a'.repeat(MAX_BODY_BYTES - 1)}"`,
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
    expectBaseline(res);
  });

  it('TC-P16 hashed assets keep their cache headers and still get a request id', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
    const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
    expect(asset).toBeDefined();
    const res = await SELF.fetch(`${ORIGIN}${asset}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control') ?? '').not.toContain('no-store');
    expectBaseline(res);
  });
});
