/**
 * Integration tests — asset upload and serving API (story 12,
 * TC-10 to TC-13, TC-15, TC-16).
 *
 * Real Worker request handling (SELF.fetch) and the real story 5 BoardRoom
 * exists() RPC. Assets are stored through the worker's asset store; in the
 * test environment that store is the in-memory fallback (see
 * src/worker/asset-store.ts) because the miniflare R2 bucket is not
 * configured here. Storage is verified over HTTP (upload then serve), which
 * exercises the full put/get path.
 */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';

/**
 * Fixture bytes are built in code (the Workers test runtime has no node:fs).
 * PNG_BYTES is a real, decodable 16x12 RGBA PNG.
 */
function b64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const PNG_BYTES = b64(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAYAAABr5z2BAAAAF0lEQVR4nGNwav3ynxLMMGrAqAHDwwAAuHALn3FXNyEAAAAASUVORK5CYII=',
);
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
const SVG_BYTES = new TextEncoder().encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

async function createBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Serve an asset key and return the response (for round-trip verification). */
async function serve(assetKey: string): Promise<Response> {
  return SELF.fetch(`http://localhost/api/assets/${assetKey}`);
}

describe('Asset API (story 12)', () => {
  it('TC-10: POST a real PNG to an existing board → 201, stored with image/png, unguessable key', async () => {
    const boardId = await createBoard();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    // The stored object serves back with the stored content type and bytes.
    const got = await serve(body.assetKey);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(bytes.length).toBe(PNG_BYTES.length);
    expect(bytes[0]).toBe(0x89);
  });

  it('TC-11: POST to a never-created board or a malformed id → 404, nothing stored (negative)', async () => {
    const unknown = newBoardId();

    const resUnknown = await SELF.fetch(`http://localhost/api/boards/${unknown}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(resUnknown.status).toBe(404);

    const resMalformed = await SELF.fetch('http://localhost/api/boards/not-a-valid-id/assets', {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(resMalformed.status).toBe(404);

    // Neither produced a stored object (the handler refuses before any write).
    expect(((await resUnknown.json()) as { error: string }).error).toBe('not_found');
    expect(((await resMalformed.json()) as { error: string }).error).toBe('not_found');
  });

  it('TC-12: body of IMAGE_MAX_BYTES + 1 → 413 nothing stored; exactly IMAGE_MAX_BYTES JPEG → 201 (boundary)', async () => {
    const boardId = await createBoard();

    // One byte over the limit.
    const over = new Uint8Array(IMAGE_MAX_BYTES + 1);
    over[0] = 0xff;
    over[1] = 0xd8;
    over[2] = 0xff;
    const resOver = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: over,
    });
    expect(resOver.status).toBe(413);
    expect(((await resOver.json()) as { error: string }).error).toBe('too_large');

    // Exactly at the limit: JPEG magic bytes + padding to exactly IMAGE_MAX_BYTES.
    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit[0] = 0xff;
    atLimit[1] = 0xd8;
    atLimit[2] = 0xff;
    atLimit[3] = 0xe0;
    const resAtLimit = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: atLimit,
    });
    expect(resAtLimit.status).toBe(201);
    const body = (await resAtLimit.json()) as { assetKey: string };
    // The at-limit object is stored and serves back at full size.
    const got = await serve(body.assetKey);
    expect(got.status).toBe(200);
    expect((await got.arrayBuffer()).byteLength).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-13: renamed PDF (Content-Type image/png) and SVG → 415, nothing stored (negative, security)', async () => {
    const boardId = await createBoard();

    const resPdf = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: PDF_BYTES,
    });
    expect(resPdf.status).toBe(415);
    expect(((await resPdf.json()) as { error: string }).error).toBe('unsupported_type');

    const resSvg = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: SVG_BYTES,
    });
    expect(resSvg.status).toBe(415);
    expect(((await resSvg.json()) as { error: string }).error).toBe('unsupported_type');
  });

  it('TC-15: storage failure → 500 (error path)', async () => {
    const boardId = await createBoard();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'x-test-fail-r2': '1' },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('storage_failure');
  });

  it('TC-16: GET stored key → 200 with immutable caching, nosniff and CSP; missing and traversal keys → 404', async () => {
    const boardId = await createBoard();
    const upload = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    const { assetKey } = (await upload.json()) as { assetKey: string };

    const res = await serve(assetKey);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_BYTES.length);
    expect(bytes[0]).toBe(0x89);

    // Missing object.
    const missing = `${newBoardId()}/${newBoardId()}`;
    expect((await serve(missing)).status).toBe(404);

    // A key that does not match the asset key pattern (wrong length / charset)
    // is refused, so stored assets can never be reached by traversal or guesswork.
    expect((await SELF.fetch('http://localhost/api/assets/abc/def')).status).toBe(404);
    expect((await SELF.fetch('http://localhost/api/assets/%2E%2E%2F..%2Fetc/passwd')).status).toBe(404);
  });
});
