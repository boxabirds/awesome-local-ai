// TC-10 to TC-13, TC-15, TC-16 (story 12, assets.api): the asset upload and
// serve routes on the real Worker with the real Miniflare R2 binding and the
// real BoardRoom exists() RPC.

import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import {
  exactLimitJpegBytes,
  jpegBytes,
  overLimitJpegBytes,
  pdfBytes,
  pngBytes,
  svgBytes,
} from '../fixtures/images';

const BASE = 'http://127.0.0.1';

async function createBoard(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** The keys stored under one board (to prove nothing was written). */
async function storedKeys(boardId: string): Promise<string[]> {
  const result = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  return result.objects.map((o) => o.key);
}

describe('assets.api: POST /api/boards/:id/assets', () => {
  it('TC-10: a real PNG for an existing board → 201; stored with contentType and a valid key', async () => {
    const boardId = await createBoard();
    const png = pngBytes(64, 48);
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: png,
      headers: { 'Content-Type': 'application/octet-stream' }, // ignored for decisions
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(bytes.length).toBe(png.length);
    expect(bytes.slice(0, 4)).toEqual(png.slice(0, 4)); // PNG magic intact
  });

  it('TC-11: a never-created board id → 404, nothing stored; malformed id → 404', async () => {
    const unknown = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${unknown}/assets`, {
      method: 'POST',
      body: pngBytes(8, 8),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'not_found' });
    expect(await storedKeys(unknown)).toEqual([]);

    const res2 = await SELF.fetch(`${BASE}/api/boards/${'a'.repeat(23)}/assets`, {
      method: 'POST',
      body: pngBytes(8, 8),
    });
    expect(res2.status).toBe(404);
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 → 413 nothing stored; exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = await createBoard();

    const over = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: overLimitJpegBytes(),
    });
    expect(over.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);

    const atLimit = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: exactLimitJpegBytes(),
    });
    expect(atLimit.status).toBe(201);
    const body = (await atLimit.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    expect(await storedKeys(boardId)).toEqual([body.assetKey]);
  });

  it('TC-13: a PDF sent with Content-Type image/png → 415; an SVG → 415; nothing stored', async () => {
    const boardId = await createBoard();

    const pdf = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: pdfBytes(),
      headers: { 'Content-Type': 'image/png' }, // a lying header is ignored
    });
    expect(pdf.status).toBe(415);

    const svg = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: svgBytes(),
    });
    expect(svg.status).toBe(415);

    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-15: an R2 put that throws → 500 storage', async () => {
    const boardId = await createBoard();
    // Only .put is exercised by handleUpload; everything else is the real
    // binding (no spreading of class instances, which would drop methods).
    const broken: Env = {
      BOARD_ROOM: env.BOARD_ROOM,
      ASSETS: env.ASSETS,
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('injected storage failure');
        },
      } as unknown as R2Bucket,
    };
    const res = await handleUpload(
      new Request(`${BASE}/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: pngBytes(8, 8),
      }),
      broken,
      boardId,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'storage' });
    expect(await storedKeys(boardId)).toEqual([]);
  });
});

describe('assets.api: GET /api/assets/:boardId/:assetId', () => {
  it('TC-16: a stored key → 200 with immutable caching, nosniff and CSP; bytes intact', async () => {
    const boardId = await createBoard();
    const png = pngBytes(32, 24);
    const up = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: png,
    });
    expect(up.status).toBe(201);
    const { assetKey } = (await up.json()) as { assetKey: string };

    const res = await SELF.fetch(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(png.length);
    expect(bytes.slice(0, 4)).toEqual(png.slice(0, 4)); // PNG magic intact
  });

  it('TC-16: a missing key → 404; a malformed key (../x) → 404', async () => {
    const boardId = await createBoard();
    const missingKey = assetKeyFor(boardId, newBoardId());
    const missing = await SELF.fetch(`${BASE}/api/assets/${missingKey}`);
    expect(missing.status).toBe(404);

    // Traversal: the key must fail the pattern. Both the URL-normalised form
    // and the percent-encoded form must 404 (never touch the bucket).
    const traversal1 = await SELF.fetch(`${BASE}/api/assets/..%2Fx`);
    expect(traversal1.status).toBe(404);
    const traversal2 = await SELF.fetch(`${BASE}/api/assets/${'a'.repeat(22)}/../${'b'.repeat(22)}`);
    // The URL normalises the inner ../ away → a 21-char remainder → 404.
    expect(traversal2.status).toBe(404);
  });

  it('a stored JPEG round-trips its sniffed content type', async () => {
    const boardId = await createBoard();
    const jpeg = jpegBytes(64 * 1024);
    const up = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: jpeg,
    });
    expect(up.status).toBe(201);
    const { assetKey, contentType } = (await up.json()) as {
      assetKey: string;
      contentType: string;
    };
    expect(contentType).toBe('image/jpeg');

    const res = await SELF.fetch(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(jpeg.length);
  });
});
