/**
 * Integration tests for the assets API (TC-10 to TC-13, TC-15, TC-16).
 *
 * Run inside workerd with real R2 and real BoardRoom RPC via SELF.fetch.
 * Cannot use fs; fixtures are inline byte arrays.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';

// Inline fixtures
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x9D, 0x7D,
  0x18,
  0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
  0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
  0xAE, 0x42, 0x60, 0x82
]);

const JPEG_HEADER = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);

const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A]);

/** Create a board via the API, return its id. */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch('https://vidi6.example/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { id: string };
  return data.id;
}

describe('TC-10: POST real PNG to existing board', () => {
  it('returns 201 with assetKey; R2 object exists with contentType image/png', async () => {
    const boardId = await createBoard();

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES.slice().buffer,
      headers: { 'Content-Type': 'image/png' }
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { assetKey: string; contentType: string };
    expect(data.contentType).toBe('image/png');
    expect(data.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(data.assetKey.startsWith(`${boardId}/`)).toBe(true);

    // Verify the object exists in R2 with correct contentType
    const r2Obj = await env.ASSETS_BUCKET.get(data.assetKey);
    expect(r2Obj).not.toBeNull();
    expect(r2Obj!.httpMetadata?.contentType).toBe('image/png');
  });
});

describe('TC-11: POST to never-created board and malformed id', () => {
  it('returns 404 for never-created board', async () => {
    const fakeBoardId = newBoardId(); // valid format but never created

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${fakeBoardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES.slice().buffer
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for malformed board id', async () => {
    const res = await SELF.fetch(`https://vidi6.example/api/boards/bad-id/assets`, {
      method: 'POST',
      body: PNG_BYTES.slice().buffer
    });
    expect(res.status).toBe(404);
  });
});

describe('TC-12: size limit boundary', () => {
  it('returns 413 for IMAGE_MAX_BYTES + 1 bytes', async () => {
    const boardId = await createBoard();
    const body = new ArrayBuffer(IMAGE_MAX_BYTES + 1);

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body
    });
    expect(res.status).toBe(413);
  });

  it('accepts exactly IMAGE_MAX_BYTES valid JPEG (boundary 201)', async () => {
    const boardId = await createBoard();
    // Build a JPEG header + padding to exactly IMAGE_MAX_BYTES
    const body = new Uint8Array(IMAGE_MAX_BYTES);
    body.set(JPEG_HEADER, 0);

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body
    });
    expect(res.status).toBe(201);
  });
});

describe('TC-13: wrong type by content and SVG', () => {
  it('returns 415 for PDF renamed .png with Content-Type image/png', async () => {
    const boardId = await createBoard();

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PDF_BYTES.slice().buffer,
      headers: { 'Content-Type': 'image/png' }
    });
    expect(res.status).toBe(415);
  });

  it('returns 415 for SVG with script', async () => {
    const boardId = await createBoard();

    const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: SVG_BYTES.slice().buffer,
      headers: { 'Content-Type': 'image/svg+xml' }
    });
    expect(res.status).toBe(415);
  });
});

describe('TC-15: storage failure returns 500', () => {
  it('returns 500 when R2 put throws', async () => {
    const boardId = await createBoard();

    // Wrap the R2 bucket's put method to throw
    const originalPut = env.ASSETS_BUCKET.put.bind(env.ASSETS_BUCKET);
    (env.ASSETS_BUCKET as any).put = async () => {
      throw new Error('simulated R2 failure');
    };

    try {
      const res = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: PNG_BYTES.slice().buffer
      });
      expect(res.status).toBe(500);
    } finally {
      (env.ASSETS_BUCKET as any).put = originalPut;
    }
  });
});

describe('TC-16: GET stored asset headers and missing/malformed keys', () => {
  it('serves stored image with correct headers', async () => {
    const boardId = await createBoard();

    const uploadRes = await SELF.fetch(`https://vidi6.example/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_BYTES.slice().buffer
    });
    expect(uploadRes.status).toBe(201);
    const { assetKey } = (await uploadRes.json()) as { assetKey: string };

    const getRes = await SELF.fetch(`https://vidi6.example/api/assets/${assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    expect(getRes.headers.get('Cache-Control')).toContain('immutable');
    expect(getRes.headers.get('Cache-Control')).toContain('max-age=31536000');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });

  it('returns 404 for missing key', async () => {
    const fakeKey = `${newBoardId()}/${newBoardId()}`;
    const res = await SELF.fetch(`https://vidi6.example/api/assets/${fakeKey}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for path traversal attempt', async () => {
    // The URL normalizer resolves ../, so we pass it as a single encoded segment
    const res = await SELF.fetch('https://vidi6.example/api/assets/..%2Fx');
    expect(res.status).toBe(404);
  });
});
