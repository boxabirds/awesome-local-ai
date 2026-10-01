import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/index';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { PDF_BYTES, SVG_BYTES, jpegAtLimit, jpegOverLimit, tinyPng } from '../fixtures/images';

const post = (boardId: string, body: BodyInit, headers: Record<string, string> = {}) =>
  SELF.fetch(`https://example.com/api/boards/${boardId}/assets`, { method: 'POST', body, headers });
const stored = async () => (await env.ASSETS_BUCKET.list()).objects.length;

async function newBoard(): Promise<string> {
  const res = await SELF.fetch('https://example.com/api/boards', { method: 'POST' });
  return ((await res.json()) as { id: string }).id;
}

describe('asset API', () => {
  it('TC-10: stores a PNG and returns an unguessable key', async () => {
    const id = await newBoard();
    const res = await post(id, tinyPng(), { 'content-type': 'application/octet-stream' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${id}/`)).toBe(true);
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object?.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: unknown or malformed boards get 404 and nothing is stored', async () => {
    const before = await stored();
    expect((await post(newBoardId(), tinyPng())).status).toBe(404);
    expect((await post('nope', tinyPng())).status).toBe(404);
    expect(await stored()).toBe(before);
  });

  it('TC-12: over the limit is 413, exactly the limit is accepted', async () => {
    const id = await newBoard();
    const before = await stored();
    expect((await post(id, jpegOverLimit())).status).toBe(413);
    expect(await stored()).toBe(before);
    expect((await post(id, jpegAtLimit())).status).toBe(201);
    expect(await stored()).toBe(before + 1);
  });

  it('TC-13: disguised and SVG files are 415 and not stored', async () => {
    const id = await newBoard();
    const before = await stored();
    expect((await post(id, PDF_BYTES, { 'content-type': 'image/png' })).status).toBe(415);
    expect((await post(id, SVG_BYTES, { 'content-type': 'image/svg+xml' })).status).toBe(415);
    expect(await stored()).toBe(before);
  });

  it('TC-15: a storage failure is 500', async () => {
    const id = await newBoard();
    const failing = {
      ...env,
      ASSETS_BUCKET: {
        put: () => Promise.reject(new Error('boom')),
        get: () => Promise.resolve(null),
      },
    } as unknown as Env;
    const res = await worker.fetch(
      new Request(`https://example.com/api/boards/${id}/assets`, { method: 'POST', body: tinyPng() }),
      failing,
    );
    expect(res.status).toBe(500);
  });

  it('TC-16: serves with immutable caching and anti-sniffing headers; missing and malformed keys are 404', async () => {
    const id = await newBoard();
    const { assetKey } = (await (await post(id, tinyPng())).json()) as { assetKey: string };
    const res = await SELF.fetch(`https://example.com/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tinyPng());
    expect((await SELF.fetch(`https://example.com/api/assets/${id}/${newBoardId()}`)).status).toBe(404);
    expect((await SELF.fetch('https://example.com/api/assets/..%2Fx/y')).status).toBe(404);
  });
});
