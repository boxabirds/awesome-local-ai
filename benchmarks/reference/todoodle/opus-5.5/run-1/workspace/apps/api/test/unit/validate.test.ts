import { MAX_BODY_BYTES } from '@todoodle/shared/limits';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/app.ts';
import { hasBody, validate, validateRequest } from '../../src/middleware/validate.ts';

const URL_API = 'https://todoodle.test/api/things';
const CLIENT = { 'X-Todoodle-Client': 'web' };
const JSON_CT = { 'Content-Type': 'application/json' };

/** A JSON body of exactly `size` bytes. */
function jsonBody(size: number): Uint8Array {
  const text = `"${'a'.repeat(size - 2)}"`;
  return new TextEncoder().encode(text);
}

/** A never-ending chunked body that records how many bytes the consumer pulled. */
function endlessStream(chunkSize: number) {
  const stats = { pulled: 0 };
  const chunk = new Uint8Array(chunkSize).fill(97);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulled += chunk.byteLength;
      controller.enqueue(chunk.slice());
    },
  });
  return { stream, stats };
}

/** Validation middleware in front of a handler that counts its invocations. */
function spiedApp() {
  const counter = { calls: 0 };
  const app = new Hono<AppEnv>();
  app.use('*', validate);
  app.all('*', (c) => {
    counter.calls++;
    return c.json({ handled: true });
  });
  return { app, counter };
}

async function expectRejectedBeforeHandler(req: Request, status: number, code: string) {
  const { app, counter } = spiedApp();
  expect(counter.calls).toBe(0);
  const res = await app.fetch(req);
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ error: code });
  expect(counter.calls).toBe(0);
}

describe('validateRequest', () => {
  it('TC-P01 accepts a GET without a body (class a)', async () => {
    expect(await validateRequest(new Request(URL_API))).toEqual({ ok: true });
  });

  it('TC-P02 accepts a JSON body of exactly MAX_BODY_BYTES (class c boundary)', async () => {
    const body = jsonBody(MAX_BODY_BYTES);
    expect(body.byteLength).toBe(1_048_576);
    const req = new Request(URL_API, {
      method: 'POST',
      headers: { ...CLIENT, ...JSON_CT, 'Content-Length': String(body.byteLength) },
      body,
    });
    expect(await validateRequest(req)).toEqual({ ok: true });
  });

  it('TC-P02 accepts a chunked JSON body of exactly MAX_BODY_BYTES', async () => {
    const body = jsonBody(MAX_BODY_BYTES);
    const req = new Request(URL_API, {
      method: 'POST',
      headers: { ...CLIENT, ...JSON_CT, 'Transfer-Encoding': 'chunked' },
      body: new Blob([body]).stream(),
    });
    expect(await validateRequest(req)).toEqual({ ok: true });
    // The body is still readable by the handler after validation.
    expect((await req.arrayBuffer()).byteLength).toBe(MAX_BODY_BYTES);
  });

  it('TC-P03 rejects Content-Length MAX_BODY_BYTES + 1 with 413 (class d)', async () => {
    const body = jsonBody(MAX_BODY_BYTES + 1);
    const req = () =>
      new Request(URL_API, {
        method: 'POST',
        headers: { ...CLIENT, ...JSON_CT, 'Content-Length': String(1_048_577) },
        body,
      });
    expect(await validateRequest(req())).toEqual({ ok: false, status: 413, code: 'payload_too_large' });
    await expectRejectedBeforeHandler(req(), 413, 'payload_too_large');
  });

  it('TC-P04 rejects an oversize chunked body without Content-Length and stops reading at the limit', async () => {
    const chunkSize = 64 * 1024;
    const { stream, stats } = endlessStream(chunkSize);
    const req = new Request(URL_API, {
      method: 'POST',
      headers: { ...CLIENT, ...JSON_CT, 'Transfer-Encoding': 'chunked' },
      body: stream,
    });
    expect(await validateRequest(req)).toEqual({ ok: false, status: 413, code: 'payload_too_large' });
    // Read stopped just past the limit (allowing one chunk of read-ahead), not at the end of an endless stream.
    expect(stats.pulled).toBeGreaterThan(MAX_BODY_BYTES);
    expect(stats.pulled).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * chunkSize);

    const second = endlessStream(chunkSize);
    await expectRejectedBeforeHandler(
      new Request(URL_API, {
        method: 'POST',
        headers: { ...CLIENT, ...JSON_CT, 'Transfer-Encoding': 'chunked' },
        body: second.stream,
      }),
      413,
      'payload_too_large',
    );
  });

  it('TC-P05 rejects a text/plain body with 415 (class e)', async () => {
    const req = () =>
      new Request(URL_API, {
        method: 'POST',
        headers: { ...CLIENT, 'Content-Type': 'text/plain', 'Content-Length': '5' },
        body: 'hello',
      });
    expect(await validateRequest(req())).toEqual({ ok: false, status: 415, code: 'unsupported_media_type' });
    await expectRejectedBeforeHandler(req(), 415, 'unsupported_media_type');
  });

  it('TC-P06 rejects a JSON body without X-Todoodle-Client with 403 (class f)', async () => {
    const req = () =>
      new Request(URL_API, {
        method: 'POST',
        headers: { ...JSON_CT, 'Content-Length': '2' },
        body: '{}',
      });
    expect(await validateRequest(req())).toEqual({ ok: false, status: 403, code: 'forbidden_client' });
    await expectRejectedBeforeHandler(req(), 403, 'forbidden_client');
  });

  it('TC-P06 rejects a wrong X-Todoodle-Client value with 403', async () => {
    const req = new Request(URL_API, {
      method: 'POST',
      headers: { 'X-Todoodle-Client': 'curl', ...JSON_CT, 'Content-Length': '2' },
      body: '{}',
    });
    expect(await validateRequest(req)).toEqual({ ok: false, status: 403, code: 'forbidden_client' });
  });

  it.each(['PUT', 'TRACE'])('TC-P07 rejects %s with 405 (class g)', async (method) => {
    const req = () => new Request(URL_API, { method, headers: CLIENT });
    expect(await validateRequest(req())).toEqual({ ok: false, status: 405, code: 'method_not_allowed' });
    await expectRejectedBeforeHandler(req(), 405, 'method_not_allowed');
  });

  it('TC-P08 accepts a bodyless POST with the client header and no Content-Type (class b)', async () => {
    const req = () => new Request(URL_API, { method: 'POST', headers: CLIENT });
    expect(req().headers.has('content-type')).toBe(false);
    expect(await validateRequest(req())).toEqual({ ok: true });

    const { app, counter } = spiedApp();
    const res = await app.fetch(req());
    expect(res.status).toBe(200);
    expect(counter.calls).toBe(1);
  });

  it('TC-P08 accepts a bodyless POST with Content-Length 0 and no Content-Type', async () => {
    const req = new Request(URL_API, { method: 'POST', headers: { ...CLIENT, 'Content-Length': '0' } });
    expect(await validateRequest(req)).toEqual({ ok: true });
  });

  it('TC-P18 accepts a bodyless DELETE with the client header and no Content-Type (class b)', async () => {
    const req = new Request(URL_API, { method: 'DELETE', headers: CLIENT });
    expect(await validateRequest(req)).toEqual({ ok: true });
  });

  it('TC-P19 rejects a bodyless DELETE without X-Todoodle-Client with 403 (class f)', async () => {
    const req = () => new Request(URL_API, { method: 'DELETE' });
    expect(await validateRequest(req())).toEqual({ ok: false, status: 403, code: 'forbidden_client' });
    await expectRejectedBeforeHandler(req(), 403, 'forbidden_client');
  });

  it('TC-P20 rejects a PATCH body without a Content-Type header with 415 (class e)', async () => {
    const body = new TextEncoder().encode('{"a":1}');
    const req = () =>
      new Request(URL_API, {
        method: 'PATCH',
        headers: { ...CLIENT, 'Content-Length': String(body.byteLength) },
        body,
      });
    expect(req().headers.has('content-type')).toBe(false);
    expect(await validateRequest(req())).toEqual({ ok: false, status: 415, code: 'unsupported_media_type' });
    await expectRejectedBeforeHandler(req(), 415, 'unsupported_media_type');
  });

  it('accepts application/json with a charset parameter', async () => {
    const req = new Request(URL_API, {
      method: 'PATCH',
      headers: { ...CLIENT, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': '2' },
      body: '{}',
    });
    expect(await validateRequest(req)).toEqual({ ok: true });
  });
});

describe('hasBody (TC-P21)', () => {
  it('is false for Content-Length 0', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST', headers: { 'Content-Length': '0' } }))).toBe(false);
  });

  it('is false when Content-Length is absent and there is no Transfer-Encoding', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST' }))).toBe(false);
  });

  it('is true for Transfer-Encoding chunked', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST', headers: { 'Transfer-Encoding': 'chunked' } }))).toBe(true);
  });

  it('is true for a positive Content-Length', () => {
    expect(hasBody(new Request(URL_API, { method: 'POST', headers: { 'Content-Length': '2' }, body: '{}' }))).toBe(true);
  });
});
