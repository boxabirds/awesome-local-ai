/// <reference types="@cloudflare/vitest-pool-workers" />
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';

// Story 12 asset API (assets.api) against real Miniflare R2 and real
// BoardRoom.exists(). Nothing is ever stored on an error path; every such
// case re-checks the bucket.
const testEnv = env as unknown as Env;
const fetcher = SELF.fetch.bind(SELF);

function url(path: string): string {
  return `https://example.com${path}`;
}

function bytesOf(latin1: string): Uint8Array {
  return Uint8Array.from(latin1, (c) => c.charCodeAt(0));
}

// A real 1x1 PNG (decodable), stored as latin-1 base64 decoded bytes.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function tinyPng(): Uint8Array {
  return Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0));
}

// Valid-looking headers with filler; the server never decodes, it sniffs.
function jpegBytes(size: number): Uint8Array {
  const body = new Uint8Array(size);
  body.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return body;
}

async function createBoardId(): Promise<string> {
  const response = await fetcher(url('/api/boards'), { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function storedKeys(prefix: string): Promise<string[]> {
  const listed = await testEnv.ASSETS_BUCKET.list({ prefix });
  return listed.objects.map((o) => o.key);
}

async function post(boardId: string, body: BodyInit, headers?: HeadersInit): Promise<Response> {
  return fetcher(url(`/api/boards/${boardId}/assets`), { method: 'POST', body, headers });
}

describe('assets.api upload (TC-10..TC-13, TC-15)', () => {
  it('TC-10 POST a real PNG to an existing board stores it and returns the key', async () => {
    const boardId = await createBoardId();
    const response = await post(boardId, tinyPng());
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const stored = await testEnv.ASSETS_BUCKET.get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(tinyPng());
  });

  it('TC-11 never-created board and malformed ids are 404 with nothing stored', async () => {
    const ghost = newBoardId();
    const response = await post(ghost, tinyPng());
    expect(response.status).toBe(404);
    expect(await storedKeys(`${ghost}/`)).toEqual([]);

    for (const malformed of ['short', 'has space', 'x'.repeat(23)]) {
      const res = await fetcher(url(`/api/boards/${encodeURIComponent(malformed)}/assets`), {
        method: 'POST',
        body: tinyPng()
      });
      expect(res.status).toBe(404);
    }
  });

  it('TC-12 over-limit is 413 with nothing stored; exactly at limit is 201', async () => {
    const boardId = await createBoardId();
    const over = await post(boardId, jpegBytes(IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await storedKeys(`${boardId}/`)).toEqual([]);

    const at = await post(boardId, jpegBytes(IMAGE_MAX_BYTES));
    expect(at.status).toBe(201);
    const body = (await at.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    expect(await storedKeys(`${boardId}/`)).toHaveLength(1);
  });

  it('TC-13 a renamed PDF and an SVG are 415 whatever Content-Type claims', async () => {
    const boardId = await createBoardId();
    const pdf = await post(boardId, bytesOf('%PDF-1.4\n%\xe2\xe3\xcf\xd3\nstream-data'), {
      'content-type': 'image/png'
    });
    expect(pdf.status).toBe(415);

    const svg = await post(
      boardId,
      bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      { 'content-type': 'image/png' }
    );
    expect(svg.status).toBe(415);
    expect(await storedKeys(`${boardId}/`)).toEqual([]);
  });

  it('TC-15 an R2 put failure answers 500', async () => {
    const boardId = await createBoardId();
    const brokenEnv = {
      BOARD_ROOM: testEnv.BOARD_ROOM,
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('r2 unavailable');
        }
      }
    } as unknown as Env;
    const request = new Request(url(`/api/boards/${boardId}/assets`), {
      method: 'POST',
      body: tinyPng()
    });
    const response = await handleUpload(request, brokenEnv, boardId);
    expect(response.status).toBe(500);
  });
});

describe('assets.api serve (TC-16)', () => {
  it('serves stored bytes with immutable caching, nosniff and CSP; 404 otherwise', async () => {
    const boardId = await createBoardId();
    const upload = await post(boardId, tinyPng());
    const { assetKey } = (await upload.json()) as { assetKey: string };

    const response = await fetcher(url(`/api/assets/${assetKey}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(tinyPng());

    const missing = await fetcher(url(`/api/assets/${boardId}/${newBoardId()}`));
    expect(missing.status).toBe(404);

    // '..' can never reach the bucket: the raw path segment fails the key
    // pattern (a literal '../x' URL is normalised before routing, so the
    // traversal shape is tested as the encoded segment the router passes on).
    const traversal = await fetcher(url(`/api/assets/${boardId}/..%2Fx`));
    expect(traversal.status).toBe(404);
  });
});
