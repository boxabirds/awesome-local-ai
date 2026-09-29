// Story 12, assets.api integration tests: TC-10 to TC-16. The real Worker
// fetch handler and Durable Object namespace in workerd, hit via
// SELF.fetch, with REAL Miniflare R2 (ASSETS_BUCKET) and the REAL story 5
// exists() RPC. No mocks except where documented.
//
// Rate limiter (TC-14): the integration pool runs wrangler.local.jsonc,
// which has NO ratelimits binding (this workerd build does not implement
// it — see that file's header). The worker therefore falls back to its
// in-memory stand-in (createLocalLimiter with IMAGE_UPLOAD_LIMIT /
// IMAGE_UPLOAD_PERIOD_SECONDS, the same `limit({ key })` interface as the
// platform binding), which is what these tests exercise.

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';

// 1x1 white PNG (valid magic bytes + body).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QAAd2KE6QAAAAHdElNRQfqCRwMAQKS27EbAAAACklEQVQI12NoAAAAggCB3UNq9AAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0yOFQxMjowMTowMiswMDowMIIPgA0AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMjhUMTI6MDE6MDIrMDA6MDDzUjixAAAAAElFTkSuQmCC';

const TINY_PNG = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));

function postAsset(boardId: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(new Request(`http://localhost/api/boards/${boardId}/assets`, {
    method: 'POST',
    body: body,
    headers,
  }));
}

/** Creates a real board (POST /api/boards) and returns its id. */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** A byte slice of a valid JPEG: real baseline header, padded body. */
function jpegBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  // SOI + JFIF header (valid magic bytes for sniffing).
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  return bytes;
}

/** The R2 keys currently stored. */
async function r2Keys(): Promise<string[]> {
  const list = await env.ASSETS_BUCKET!.list({});
  return list.objects.map((o) => o.key);
}

describe('assets.api: upload', () => {
  it('TC-10: POST a real PNG to an existing board → 201, stored with image/png', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, TINY_PNG, { 'CF-Connecting-IP': '10.0.0.1' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const object = await env.ASSETS_BUCKET!.head(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: POST to an uncreated board and a malformed id → 404, nothing stored (negative)', async () => {
    const before = await r2Keys();

    const unknown = await postAsset(newBoardId(), TINY_PNG, { 'CF-Connecting-IP': '10.0.0.2' });
    expect(unknown.status).toBe(404);
    const malformed = await postAsset('not-a-valid-id!', TINY_PNG, { 'CF-Connecting-IP': '10.0.0.2' });
    expect(malformed.status).toBe(404);

    const after = await r2Keys();
    expect(after).toEqual(before);
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 → 413 nothing stored; exactly IMAGE_MAX_BYTES JPEG → 201 (boundary)', async () => {
    const boardId = await createBoard();
    const before = (await r2Keys()).length;

    const tooLarge = await postAsset(
      boardId,
      jpegBytes(IMAGE_MAX_BYTES + 1),
      { 'CF-Connecting-IP': '10.0.0.3' },
    );
    expect(tooLarge.status).toBe(413);

    const atLimit = await postAsset(
      boardId,
      jpegBytes(IMAGE_MAX_BYTES),
      { 'CF-Connecting-IP': '10.0.0.3' },
    );
    expect(atLimit.status).toBe(201);
    const body = (await atLimit.json()) as { contentType: string };
    expect(body.contentType).toBe('image/jpeg');

    const after = await r2Keys();
    expect(after.length).toBe(before + 1);
  });

  it('TC-13: a PDF disguised as image/png and an SVG are both 415, nothing stored (negative)', async () => {
    const boardId = await createBoard();
    const before = (await r2Keys()).length;

    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
    const disguised = await postAsset(boardId, pdf, {
      'Content-Type': 'image/png', // the header must be ignored
      'CF-Connecting-IP': '10.0.0.4',
    });
    expect(disguised.status).toBe(415);

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svgRes = await postAsset(boardId, svg, {
      'Content-Type': 'image/svg+xml',
      'CF-Connecting-IP': '10.0.0.4',
    });
    expect(svgRes.status).toBe(415);

    const after = await r2Keys();
    expect(after).toHaveLength(before);
  });

  it(`TC-14: IMAGE_UPLOAD_LIMIT + 1 uploads from one IP → last 429; a different IP → 201`, async () => {
    const boardId = await createBoard();
    const ipA = '10.0.1.10';
    const ipB = '10.0.1.11';

    let last = 0;
    for (let i = 0; i <= IMAGE_UPLOAD_LIMIT; i++) {
      const res = await postAsset(boardId, TINY_PNG, { 'CF-Connecting-IP': ipA });
      last = res.status;
      if (i < IMAGE_UPLOAD_LIMIT) expect(res.status).toBe(201);
    }
    expect(last).toBe(429);

    const other = await postAsset(boardId, TINY_PNG, { 'CF-Connecting-IP': ipB });
    expect(other.status).toBe(201);
  });

  it('TC-15: an R2 storage failure is a 500 (error path)', async () => {
    const boardId = await createBoard();
    const spy = vi.spyOn(env.ASSETS_BUCKET!, 'put').mockRejectedValueOnce(new Error('boom'));
    const res = await postAsset(boardId, TINY_PNG, { 'CF-Connecting-IP': '10.0.0.6' });
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

describe('assets.api: serving', () => {
  it('TC-16: stored key → 200 with immutable Cache-Control, nosniff and null CSP; missing and ../ keys → 404', async () => {
    const boardId = await createBoard();
    const up = await postAsset(boardId, TINY_PNG, { 'CF-Connecting-IP': '10.0.0.7' });
    const { assetKey } = (await up.json()) as { assetKey: string };

    const ok = await SELF.fetch(new Request(`http://localhost/api/assets/${assetKey}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('image/png');
    expect(ok.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(ok.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    const bytes = new Uint8Array(await ok.arrayBuffer());
    expect(bytes.length).toBe(TINY_PNG.length);

    const missingId = newBoardId();
    const missing = await SELF.fetch(
      new Request(`http://localhost/api/assets/${boardId}/${missingId}`),
    );
    expect(missing.status).toBe(404);

    const traversal = await SELF.fetch(
      new Request(`http://localhost/api/assets/${encodeURIComponent('../x')}`),
    );
    expect(traversal.status).toBe(404);
  });
});

// The named settings must stay in sync with wrangler.jsonc (same pattern as
// story 5 TC-03): the limiter values mirror IMAGE_UPLOAD_LIMIT /
// IMAGE_UPLOAD_PERIOD_SECONDS.
describe('assets.api: settings drift guard', () => {
  it('IMAGE_UPLOAD_LIMIT is 60 per 60-second period', () => {
    expect(IMAGE_UPLOAD_LIMIT).toBe(60);
    expect(IMAGE_UPLOAD_PERIOD_SECONDS).toBe(60);
  });
});
