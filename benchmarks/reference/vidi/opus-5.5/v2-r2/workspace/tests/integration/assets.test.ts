// Story 12 — assets.api against the real Worker, real (Miniflare) R2 and the real
// story 5 exists() RPC: TC-10 to TC-13, TC-15, TC-16.
import { SELF, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { handleServe, handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import { JPEG_8x6, PDF_BYTES, PNG_300x200, SVG_WITH_SCRIPT, jpegOfSize, overLimitBytes } from '../fixtures/images/bytes';
import { ORIGIN, createBoardId } from './ws-client';

afterEach(() => vi.restoreAllMocks());

async function storedKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ASSETS_BUCKET.list({ cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys.sort();
}

function upload(boardId: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`, { method: 'POST', body, headers });
}

describe('POST /api/boards/:id/assets', () => {
  it('TC-10: a real PNG on an existing board → 201; stored in R2 as image/png under an unguessable key', async () => {
    const boardId = await createBoardId();
    const response = await upload(boardId, PNG_300x200, { 'Content-Type': 'application/octet-stream' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const stored = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(PNG_300x200);
    // A second upload of the same file gets its own key.
    const again = (await (await upload(boardId, PNG_300x200)).json()) as { assetKey: string };
    expect(again.assetKey).not.toBe(body.assetKey);
  });

  it('TC-11: a never-created board or a malformed id → 404; nothing stored', async () => {
    const before = await storedKeys();
    expect((await upload(newBoardId(), PNG_300x200)).status).toBe(404);
    expect((await upload('not-a-board', PNG_300x200)).status).toBe(404);
    expect((await upload('bad%2F..', PNG_300x200)).status).toBe(404);
    expect(await storedKeys()).toEqual(before);
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 → 413 and nothing stored; a valid JPEG of exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = await createBoardId();
    const before = await storedKeys();
    expect((await upload(boardId, overLimitBytes())).status).toBe(413);
    expect(await storedKeys()).toEqual(before);
    const response = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES));
    expect(response.status).toBe(201);
    const { assetKey, contentType } = (await response.json()) as { assetKey: string; contentType: string };
    expect(contentType).toBe('image/jpeg');
    expect((await env.ASSETS_BUCKET.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-12: the actual length is checked even when Content-Length understates it', async () => {
    const boardId = await createBoardId();
    const before = await storedKeys();
    const request = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, { method: 'POST', body: overLimitBytes() });
    const lying = new Request(request, { headers: { 'Content-Length': '10' } });
    const response = await handleUpload(lying, env as unknown as Env, boardId);
    expect(response.status).toBe(413);
    expect(await storedKeys()).toEqual(before);
  });

  it('TC-13: a PDF sent as image/png and an SVG with a script → 415; nothing stored', async () => {
    const boardId = await createBoardId();
    const before = await storedKeys();
    expect((await upload(boardId, PDF_BYTES, { 'Content-Type': 'image/png' })).status).toBe(415);
    expect((await upload(boardId, SVG_WITH_SCRIPT, { 'Content-Type': 'image/svg+xml' })).status).toBe(415);
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);
    expect(await storedKeys()).toEqual(before);
  });

  it('TC-15: an R2 put that throws → 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boardId = await createBoardId();
    const bucket = env.ASSETS_BUCKET;
    const failing = {
      ...env,
      ASSETS_BUCKET: {
        get: bucket.get.bind(bucket),
        head: bucket.head.bind(bucket),
        list: bucket.list.bind(bucket),
        put: () => Promise.reject(new Error('injected R2 failure')),
      },
    } as unknown as Env;
    const request = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, { method: 'POST', body: PNG_300x200 });
    const response = await handleUpload(request, failing, boardId);
    expect(response.status).toBe(500);
  });

  it('other methods → 405', async () => {
    const boardId = await createBoardId();
    const response = await SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});

describe('GET /api/assets/:boardId/:assetId (TC-16)', () => {
  it('serves a stored image with its type, immutable caching, nosniff and a locked-down CSP', async () => {
    const boardId = await createBoardId();
    const { assetKey } = (await (await upload(boardId, JPEG_8x6)).json()) as { assetKey: string };
    const response = await SELF.fetch(`${ORIGIN}/api/assets/${assetKey}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG_8x6);
  });

  it('a missing key → 404', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/assets/${newBoardId()}/${newBoardId()}`);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });

  it("'../x' and other malformed keys → 404", async () => {
    for (const path of ['..%2Fx', `${newBoardId()}/..%2F..%2Fx`, `${newBoardId()}`, `${newBoardId()}/${newBoardId()}/x`]) {
      const response = await SELF.fetch(`${ORIGIN}/api/assets/${path}`);
      expect(response.status, path).toBe(404);
      await response.body?.cancel();
    }
    expect((await handleServe(env as unknown as Env, '../x')).status).toBe(404);
  });
});
