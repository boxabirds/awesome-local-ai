/**
 * Integration tests for the asset API (story 12 TC-10 to TC-13, TC-15, TC-16).
 *
 * Runs against the real Worker in workerd with real R2 (Miniflare) and the
 * real story 5 exists() RPC. SELF.fetch hits the actual fetch handler.
 *
 * Fixture bytes are inlined (hex) because the workers pool does not have
 * reliable filesystem access from the test context.
 */

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

// Minimal valid 1x1 PNG (70 bytes)
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63fcffff3f030005fe02fea72d99440000000049454e44ae426082',
    'hex',
  ),
);

// Minimal valid JPEG header (FF D8 FF E0 ...) - just the start, enough for sniffing
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

// SVG content (should be rejected)
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>',
);

// PDF content (should be rejected even with Content-Type: image/png)
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
);

async function createBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe('asset API upload', () => {
  it('TC-10: POST real PNG to existing board → 201, R2 object exists with contentType', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
      headers: { 'content-type': 'image/png' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);

    // Verify R2 object exists with correct contentType
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: POST to never-created board → 404; malformed id → 404; nothing stored', async () => {
    // Never-created board
    const freshId = newBoardId();
    const res1 = await SELF.fetch(`http://localhost/api/boards/${freshId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(res1.status).toBe(404);

    // Malformed id
    const res2 = await SELF.fetch('http://localhost/api/boards/bad_id/assets', {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(res2.status).toBe(404);

    // Nothing stored for the fresh board (check by prefix)
    const objects = await env.ASSETS_BUCKET.list({ prefix: freshId + '/' });
    expect(objects.objects).toHaveLength(0);
  });

  it('TC-12: POST IMAGE_MAX_BYTES+1 → 413; exactly IMAGE_MAX_BYTES JPEG → 201', async () => {
    const boardId = await createBoard();

    // Over limit: build a body with valid JPEG magic bytes but size > limit
    const overLimit = new Uint8Array(IMAGE_MAX_BYTES + 1);
    overLimit[0] = 0xff;
    overLimit[1] = 0xd8;
    overLimit[2] = 0xff;
    const res1 = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: overLimit,
    });
    expect(res1.status).toBe(413);

    // Exactly at limit: valid JPEG magic bytes
    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit[0] = 0xff;
    atLimit[1] = 0xd8;
    atLimit[2] = 0xff;
    const res2 = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: atLimit,
    });
    expect(res2.status).toBe(201);
  });

  it('TC-13: POST renamed PDF with Content-Type image/png → 415; POST SVG → 415', async () => {
    const boardId = await createBoard();

    // PDF with Content-Type: image/png (sniffing catches it)
    const res1 = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PDF_BYTES,
      headers: { 'content-type': 'image/png' },
    });
    expect(res1.status).toBe(415);

    // SVG
    const res2 = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: SVG_BYTES,
      headers: { 'content-type': 'image/svg+xml' },
    });
    expect(res2.status).toBe(415);

    // Nothing stored
    const objects = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    expect(objects.objects).toHaveLength(0);
  });

  it('TC-15: R2 put throws → 500', async () => {
    const boardId = await createBoard();

    // Wrap the R2 put to throw
    vi.spyOn(env.ASSETS_BUCKET, 'put').mockRejectedValue(new Error('storage failure'));

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
      headers: { 'content-type': 'image/png' },
    });
    expect(res.status).toBe(500);

    vi.restoreAllMocks();
  });
});

describe('asset API serve', () => {
  it('TC-16: GET stored → 200 with headers; GET missing → 404; GET malformed → 404', async () => {
    const boardId = await createBoard();

    // Upload first
    const uploadRes = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
      headers: { 'content-type': 'image/png' },
    });
    expect(uploadRes.status).toBe(201);
    const { assetKey } = (await uploadRes.json()) as { assetKey: string };

    // GET the stored asset
    const [bId, aId] = assetKey.split('/');
    const res = await SELF.fetch(`http://localhost/api/assets/${bId}/${aId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const cacheControl = res.headers.get('cache-control') ?? '';
    expect(cacheControl).toContain('immutable');
    expect(cacheControl).toContain('max-age=31536000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");

    // GET missing key (valid pattern but no object)
    const missingRes = await SELF.fetch(
      `http://localhost/api/assets/${boardId}/${newBoardId()}`,
    );
    expect(missingRes.status).toBe(404);

    // GET with a malformed asset id (too short to match the pattern)
    const malformedRes = await SELF.fetch(`http://localhost/api/assets/${boardId}/short`);
    expect(malformedRes.status).toBe(404);
  });
});
