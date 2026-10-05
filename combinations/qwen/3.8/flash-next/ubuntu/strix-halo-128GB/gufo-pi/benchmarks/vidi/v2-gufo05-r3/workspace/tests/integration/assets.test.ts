/**
 * Integration tests for asset API (TC-10 to TC-13, TC-15, TC-16).
 *
 * Runs inside workerd against the real Worker: SELF.fetch covers the full
 * request handling, including R2 storage and BoardRoom.exists() RPC.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import { ensureBoard } from './ws-client';

const BASE = 'http://whiteboard.local';

/** Minimal valid PNG (1x1 pixel) */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x00,
  0x01, 0x01, 0x00, 0x05, 0x18, 0xd8, 0x4e,       // data
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND
  0xae, 0x42, 0x60, 0x82,
]);

/** Minimal valid JPEG */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

describe('TC-10: upload valid PNG to existing board', () => {
  it('returns 201, stores object with correct contentType, key matches pattern', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { assetKey: string; contentType: string };
    expect(data.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(data.assetKey)).toBe(true);

    // Verify R2 object exists
    const obj = await env.ASSETS_BUCKET.get(data.assetKey);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/png');
  });
});

describe('TC-11: upload to non-existent or malformed board', () => {
  it('POST to never-created board id → 404, nothing stored', async () => {
    const boardId = newBoardId();
    // Do NOT create the board

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(res.status).toBe(404);

    // List to verify nothing was stored under this prefix
    const list = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
    expect(list.objects.length).toBe(0);
  });

  it('POST to malformed board id → 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards/short/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(res.status).toBe(404);
  });
});

describe('TC-12: size limit enforcement', () => {
  it('POST IMAGE_MAX_BYTES + 1 bytes → 413, nothing stored', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    // Create a body that is IMAGE_MAX_BYTES + 1 bytes with valid PNG header
    const body = new Uint8Array(IMAGE_MAX_BYTES + 1);
    body.set(PNG_BYTES);

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body,
    });
    expect(res.status).toBe(413);

    const list = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
    expect(list.objects.length).toBe(0);
  });

  it('POST valid JPEG at exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    // Create a body of exactly IMAGE_MAX_BYTES with valid JPEG header
    const body = new Uint8Array(IMAGE_MAX_BYTES);
    body.set(JPEG_BYTES);

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { contentType: string };
    expect(data.contentType).toBe('image/jpeg');
  });
});

describe('TC-13: wrong type by content → 415', () => {
  it('POST PDF with Content-Type image/png → 415', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake pdf content for testing');
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: pdfBytes,
    });
    expect(res.status).toBe(415);

    const list = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
    expect(list.objects.length).toBe(0);
  });

  it('POST SVG → 415', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: svgBytes,
    });
    expect(res.status).toBe(415);

    const list = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
    expect(list.objects.length).toBe(0);
  });
});

describe('TC-15: R2 storage failure → 500', () => {
  it('returns 500 when R2 put throws', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    // Wrap the bucket to throw on put
    const originalPut = env.ASSETS_BUCKET.put.bind(env.ASSETS_BUCKET);
    env.ASSETS_BUCKET.put = async () => {
      throw new Error('simulated storage failure');
    };

    try {
      const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: PNG_BYTES,
      });
      expect(res.status).toBe(500);
    } finally {
      env.ASSETS_BUCKET.put = originalPut;
    }
  });
});

describe('TC-16: serve stored asset', () => {
  it('GET stored key → 200 with correct headers', async () => {
    const boardId = newBoardId();
    await ensureBoard(boardId);

    // Upload first
    const uploadRes = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES,
    });
    expect(uploadRes.status).toBe(201);
    const { assetKey } = (await uploadRes.json()) as { assetKey: string };

    // Serve
    const res = await SELF.fetch(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    // Verify body matches
    const body = await res.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(PNG_BYTES);
  });

  it('GET missing key → 404', async () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    const res = await SELF.fetch(`${BASE}/api/assets/${key}`);
    expect(res.status).toBe(404);
  });

  it('GET malformed key (too short) → 404', async () => {
    const res = await SELF.fetch(`${BASE}/api/assets/short`);
    expect(res.status).toBe(404);
  });
});
