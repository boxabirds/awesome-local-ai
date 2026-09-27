import { CLIENT_HEADER, CLIENT_HEADER_VALUE, MAX_BODY_BYTES } from '@todoodle/shared/limits';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/app';
import { hasBody, validate, validateRequest } from '../../src/middleware/validate';

const URL_API = 'https://todoodle.test/api/things';
const client = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };
const json = { 'Content-Type': 'application/json' };

/** Mini app: validate middleware in front of a spy route that counts invocations. */
function spyApp() {
  const calls = { count: 0 };
  const app = new Hono<AppEnv>();
  app.use('*', validate);
  app.all('*', (c) => {
    calls.count += 1;
    return c.json({ handled: true });
  });
  return { app, calls };
}

/** A JSON body of exactly `size` bytes. */
function jsonBody(size: number): string {
  const wrapper = '{"x":""}';
  return `{"x":"${'a'.repeat(size - wrapper.length)}"}`;
}

/** A chunked stream with no Content-Length; records how many bytes were pulled from it. */
function countingStream(totalBytes: number, chunkBytes: number) {
  const stats = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stats.pulled >= totalBytes) return controller.close();
      const chunk = new Uint8Array(Math.min(chunkBytes, totalBytes - stats.pulled)).fill(97);
      stats.pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { stream, stats };
}

async function expectRejected(req: Request, status: number, code: string) {
  const { app, calls } = spyApp();
  expect(calls.count).toBe(0);
  const res = await app.fetch(req);
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ error: code });
  expect(calls.count).toBe(0);
}

async function expectAccepted(req: Request) {
  expect(await validateRequest(req.clone())).toEqual({ ok: true });
  const { app, calls } = spyApp();
  const res = await app.fetch(req);
  expect(res.status).toBe(200);
  expect(calls.count).toBe(1);
}

describe('validateRequest', () => {
  it('TC-P01 accepts a GET with no body', async () => {
    await expectAccepted(new Request(URL_API));
  });

  it('TC-P02 accepts a JSON body of exactly MAX_BODY_BYTES', async () => {
    const body = jsonBody(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_BODY_BYTES);
    await expectAccepted(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...client, ...json, 'Content-Length': String(MAX_BODY_BYTES) },
        body,
      }),
    );
  });

  it('TC-P03 rejects Content-Length MAX_BODY_BYTES + 1 with 413', async () => {
    const body = jsonBody(MAX_BODY_BYTES + 1);
    await expectRejected(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...client, ...json, 'Content-Length': String(MAX_BODY_BYTES + 1) },
        body,
      }),
      413,
      'payload_too_large',
    );
  });

  it('TC-P04 rejects an oversize chunked body and stops reading just past the limit', async () => {
    const chunk = 64 * 1024;
    const total = MAX_BODY_BYTES * 4;
    const { stream, stats } = countingStream(total, chunk);
    const req = new Request(URL_API, {
      method: 'POST',
      headers: { ...client, ...json, 'Transfer-Encoding': 'chunked' },
      body: stream,
    });
    expect(req.headers.get('content-length')).toBeNull();
    expect(await validateRequest(req)).toEqual({
      ok: false,
      status: 413,
      code: 'payload_too_large',
    });
    expect(stats.pulled).toBeGreaterThan(MAX_BODY_BYTES);
    expect(stats.pulled).toBeLessThan(total);
    expect(stats.pulled).toBeLessThanOrEqual(MAX_BODY_BYTES + 1 + 2 * chunk);

    const oversize = countingStream(total, chunk);
    await expectRejected(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...client, ...json, 'Transfer-Encoding': 'chunked' },
        body: oversize.stream,
      }),
      413,
      'payload_too_large',
    );
  });

  it('TC-P05 rejects a text/plain body with 415', async () => {
    await expectRejected(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...client, 'Content-Type': 'text/plain' },
        body: 'hello',
      }),
      415,
      'unsupported_media_type',
    );
  });

  it('TC-P06 rejects a JSON POST without X-Todoodle-Client with 403', async () => {
    await expectRejected(
      new Request(URL_API, { method: 'POST', headers: json, body: '{"a":1}' }),
      403,
      'forbidden_client',
    );
  });

  it('TC-P06 rejects a wrong X-Todoodle-Client value with 403', async () => {
    await expectRejected(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...json, [CLIENT_HEADER]: 'curl' },
        body: '{"a":1}',
      }),
      403,
      'forbidden_client',
    );
  });

  it.each(['PUT', 'TRACE', 'OPTIONS'])('TC-P07 rejects %s with 405', async (method) => {
    await expectRejected(new Request(URL_API, { method, headers: client }), 405, 'method_not_allowed');
  });

  it('TC-P08 accepts a bodyless POST with client header and no Content-Type', async () => {
    const req = new Request(URL_API, { method: 'POST', headers: client });
    expect(req.headers.get('content-type')).toBeNull();
    await expectAccepted(req);
  });

  it('TC-P18 accepts a bodyless DELETE with client header and no Content-Type', async () => {
    await expectAccepted(new Request(URL_API, { method: 'DELETE', headers: client }));
  });

  it('TC-P19 rejects a bodyless DELETE without X-Todoodle-Client with 403', async () => {
    await expectRejected(new Request(URL_API, { method: 'DELETE' }), 403, 'forbidden_client');
  });

  it('TC-P20 rejects a PATCH body with no Content-Type with 415', async () => {
    const req = new Request(URL_API, {
      method: 'PATCH',
      headers: { ...client, 'Content-Length': '7' },
      body: new TextEncoder().encode('{"a":1}'),
    });
    req.headers.delete('content-type');
    expect(req.headers.get('content-type')).toBeNull();
    await expectRejected(req, 415, 'unsupported_media_type');
  });

  it('accepts application/json with a charset parameter', async () => {
    await expectAccepted(
      new Request(URL_API, {
        method: 'PATCH',
        headers: { ...client, 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"a":1}',
      }),
    );
  });

  it('checks the client header before size (oversize without header is 403)', async () => {
    await expectRejected(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...json, 'Content-Length': String(MAX_BODY_BYTES + 1) },
        body: jsonBody(MAX_BODY_BYTES + 1),
      }),
      403,
      'forbidden_client',
    );
  });
});

describe('hasBody (TC-P21)', () => {
  it('is false for Content-Length 0', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST', headers: { 'Content-Length': '0' } }))).toBe(false);
  });

  it('is false with no Content-Length and no Transfer-Encoding', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST' }))).toBe(false);
  });

  it('is true with Transfer-Encoding chunked', () => {
    expect(
      hasBody(new Request(URL_API, { method: 'POST', headers: { 'Transfer-Encoding': 'chunked' } })),
    ).toBe(true);
  });

  it('is true with a positive Content-Length', () => {
    expect(
      hasBody(new Request(URL_API, { method: 'POST', headers: { 'Content-Length': '2' }, body: '{}' })),
    ).toBe(true);
  });
});
