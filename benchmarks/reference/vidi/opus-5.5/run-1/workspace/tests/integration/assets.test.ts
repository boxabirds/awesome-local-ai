/**
 * assets.api (story 12) against the real Worker, real R2 (Miniflare) and the real BoardRoom
 * `exists()` RPC: TC-10 to TC-16.
 *
 * Rate limiter: the local runtime implements the `ratelimits` binding from wrangler.jsonc, so
 * TC-14 uses the REAL ASSET_UPLOAD_LIMITER binding (as story 5's TC-13 does). Every other test
 * uses its own random CF-Connecting-IP so tests never share a budget.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_UPLOAD_LIMIT } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { handleServe, handleUpload, type AssetBucket } from '../../src/worker/assets';
import { PNG_400x300, RENAMED_PDF, SCRIPT_SVG } from '../fixtures/image-bytes';
import { roomStub } from './storage';
import { ORIGIN } from './ws-client';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
const IP_OCTET = 256;
const JPEG_START = [0xff, 0xd8, 0xff, 0xe0];

function visitorIp(): string {
  const octet = () => Math.floor(Math.random() * IP_OCTET);
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function newBoard(): Promise<string> {
  const id = newBoardId();
  expect(await roomStub(id).initialize()).toBe('created');
  return id;
}

function upload(
  boardId: string,
  body: Uint8Array,
  opts: { ip?: string; contentType?: string } = {},
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': opts.ip ?? visitorIp(), 'Content-Type': opts.contentType ?? 'application/octet-stream' },
    body,
  });
}

async function storedKeys(boardId: string): Promise<string[]> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return listed.objects.map((o) => o.key);
}

function jpegOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_START);
  return bytes;
}

describe('assets.api upload', () => {
  it('TC-10 a real PNG to an existing board → 201; stored in R2 as image/png under a valid key', async () => {
    const boardId = await newBoard();
    const res = await upload(boardId, PNG_400x300, { contentType: 'image/png' });
    expect(res.status).toBe(HTTP_CREATED);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const stored = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(PNG_400x300);
  });

  it('TC-11 a never-created board and a malformed id → 404; nothing stored', async () => {
    const unknown = newBoardId();
    const res = await upload(unknown, PNG_400x300);
    expect(res.status).toBe(HTTP_NOT_FOUND);
    expect(await storedKeys(unknown)).toEqual([]);
    expect((await upload('not-a-board', PNG_400x300)).status).toBe(HTTP_NOT_FOUND);
    expect((await upload('..%2F..%2Fx', PNG_400x300)).status).toBe(HTTP_NOT_FOUND);
    // The board check must not have created the board.
    expect(await roomStub(unknown).exists()).toBe(false);
  });

  it('TC-12 IMAGE_MAX_BYTES + 1 → 413 nothing stored; a JPEG of exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = await newBoard();
    const over = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(await storedKeys(boardId)).toEqual([]);
    const atLimit = await upload(boardId, jpegOfSize(IMAGE_MAX_BYTES));
    expect(atLimit.status).toBe(HTTP_CREATED);
    const { assetKey } = (await atLimit.json()) as { assetKey: string };
    expect((await env.ASSETS_BUCKET.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-12 a body larger than its Content-Length claims is still measured', async () => {
    const boardId = await newBoard();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(jpegOfSize(IMAGE_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const res = await SELF.fetch(`${ORIGIN}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': visitorIp() },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-13 a PDF sent as image/png and an SVG with a script → 415 both; nothing stored', async () => {
    const boardId = await newBoard();
    expect((await upload(boardId, RENAMED_PDF, { contentType: 'image/png' })).status).toBe(HTTP_UNSUPPORTED_MEDIA_TYPE);
    expect((await upload(boardId, SCRIPT_SVG, { contentType: 'image/svg+xml' })).status).toBe(
      HTTP_UNSUPPORTED_MEDIA_TYPE,
    );
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-14 IMAGE_UPLOAD_LIMIT + 1 uploads from one visitor → the last is 429; another visitor → 201', async () => {
    const boardId = await newBoard();
    const ip = visitorIp();
    for (let i = 0; i < IMAGE_UPLOAD_LIMIT; i += 1) {
      expect((await upload(boardId, PNG_400x300, { ip })).status).toBe(HTTP_CREATED);
    }
    const limited = await upload(boardId, PNG_400x300, { ip });
    expect(limited.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(await storedKeys(boardId)).toHaveLength(IMAGE_UPLOAD_LIMIT);
    expect((await upload(boardId, PNG_400x300)).status).toBe(HTTP_CREATED);
  });

  it('TC-15 R2 put throws → 500', async () => {
    const boardId = await newBoard();
    const failing: AssetBucket = {
      put: () => Promise.reject(new Error('R2 unavailable')),
      get: (key) => env.ASSETS_BUCKET.get(key),
    };
    const req = new Request(`${ORIGIN}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': visitorIp() },
      body: PNG_400x300,
    });
    const res = await handleUpload(req, { ...env, ASSETS_BUCKET: failing }, boardId);
    expect(res.status).toBe(HTTP_INTERNAL_ERROR);
    expect(await storedKeys(boardId)).toEqual([]);
  });
});

describe('assets.api serve', () => {
  it('TC-16 stored key → 200 with type, immutable caching, nosniff and CSP; missing and ../ → 404', async () => {
    const boardId = await newBoard();
    const { assetKey } = (await (await upload(boardId, PNG_400x300)).json()) as { assetKey: string };
    const res = await SELF.fetch(`${ORIGIN}/api/assets/${assetKey}`);
    expect(res.status).toBe(HTTP_OK);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_400x300);

    const missing = await SELF.fetch(`${ORIGIN}/api/assets/${assetKeyFor(boardId, newBoardId())}`);
    expect(missing.status).toBe(HTTP_NOT_FOUND);
    await missing.arrayBuffer();
    // The URL parser resolves a literal /api/assets/../x before the Worker sees it, so the key
    // '../x' is checked at the handler; the encoded form reaches the route as-is.
    expect((await handleServe(env, '../x')).status).toBe(HTTP_NOT_FOUND);
    const encoded = await SELF.fetch(`${ORIGIN}/api/assets/${boardId}/..%2Fx`);
    expect(encoded.status).toBe(HTTP_NOT_FOUND);
    await encoded.arrayBuffer();
  });

  it('TC-16 a file stored with another type (not by this API) is never served', async () => {
    const boardId = await newBoard();
    const key = assetKeyFor(boardId, newBoardId());
    await env.ASSETS_BUCKET.put(key, SCRIPT_SVG, { httpMetadata: { contentType: 'image/svg+xml' } });
    const res = await SELF.fetch(`${ORIGIN}/api/assets/${key}`);
    expect(res.status).toBe(HTTP_NOT_FOUND);
    await res.arrayBuffer();
  });
});
