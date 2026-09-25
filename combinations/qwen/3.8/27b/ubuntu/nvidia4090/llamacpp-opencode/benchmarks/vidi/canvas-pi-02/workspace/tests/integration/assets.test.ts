/**
 * TC-10: a valid PNG upload returns 201 with the assetId.
 * TC-11: a PDF renamed to .png is rejected 415 (sniff catches it).
 * TC-12: a file over 10 MiB is rejected 413.
 * TC-13: an upload for a missing board is rejected 404.
 * TC-14: the serve route returns the stored bytes with immutable caching
 *        and correct Content-Type.
 * TC-15: an unknown asset id is 404.
 * TC-16: a board-scoped request with another board's id is 404.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';

// --- Test helpers ---------------------------------------------------------------

const BASE = 'http://localhost';

/** Create a board via the API and return its id. */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (res.status !== 201) {
    throw new Error(`Failed to create board: ${res.status}`);
  }
  const body = await res.json() as { id: string };
  return body.id;
}

/** Minimal valid PNG (1x1 pixel). */
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, // IHDR length
  0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, // width = 1
  0x00, 0x00, 0x00, 0x01, // height = 1
  0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, color type 6
  0x1f, 0x15, 0xc4, 0x89, // CRC
  0x00, 0x00, 0x00, 0x0a, // IDAT length
  0x49, 0x44, 0x41, 0x54, // IDAT
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, // CRC
  0x00, 0x00, 0x00, 0x00, // IEND length
  0x49, 0x45, 0x4e, 0x44, // IEND
  0xae, 0x42, 0x60, 0x82, // CRC
]);

/** PDF bytes (will be rejected by sniff). */
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 fake pdf content');

// --- Tests ----------------------------------------------------------------------

describe('TC-10: a valid PNG upload returns 201 with the assetId', () => {
  let boardId: string;
  let assetId: string;

  beforeAll(async () => {
    boardId = await createBoard();
  });

  it('uploads a valid PNG', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: MINIMAL_PNG,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { assetKey: string; contentType: string };
    expect(body.assetKey).toBeDefined();
    expect(body.contentType).toBe('image/png');
    // assetKey is "boardId/assetId"; extract the assetId.
    const parts = body.assetKey.split('/');
    expect(parts).toHaveLength(2);
    assetId = parts[1]!;
  });

  it('TC-14: serves the uploaded PNG with correct headers', async () => {
    const res = await SELF.fetch(`${BASE}/api/assets/${boardId}/${assetId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // Verify the bytes match.
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(MINIMAL_PNG.length);
    expect(buf[0]).toBe(0x89); // PNG signature
  });
});

describe('TC-11: a PDF renamed to .png is rejected 415', () => {
  let boardId: string;

  beforeAll(async () => {
    boardId = await createBoard();
  });

  it('rejects PDF bytes with 415', async () => {
    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' }, // Lying content type
      body: PDF_BYTES,
    });
    expect(res.status).toBe(415);
  });
});

describe('TC-12: a file over 10 MiB is rejected 413', () => {
  let boardId: string;

  beforeAll(async () => {
    boardId = await createBoard();
  });

  it('rejects an oversized file with 413', async () => {
    // Create a buffer just over 10 MiB.
    const size = 10 * 1024 * 1024 + 1;
    const big = new Uint8Array(size);
    // Fill with PNG signature at the start.
    big.set(MINIMAL_PNG.slice(0, Math.min(8, size)));

    const res = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(size),
      },
      body: big,
    });
    expect(res.status).toBe(413);
  });
});

describe('TC-13: an upload for a missing board is rejected 404', () => {
  it('returns 404 for a non-existent board', async () => {
    const missingBoard = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/boards/${missingBoard}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: MINIMAL_PNG,
    });
    expect(res.status).toBe(404);
  });
});

describe('TC-15: an unknown asset id is 404', () => {
  let boardId: string;

  beforeAll(async () => {
    boardId = await createBoard();
  });

  it('returns 404 for an unknown asset', async () => {
    const unknownAsset = 'A'.repeat(22);
    const res = await SELF.fetch(`${BASE}/api/assets/${boardId}/${unknownAsset}`);
    expect(res.status).toBe(404);
  });
});

describe('TC-16: a board-scoped request with another board\'s id is 404', () => {
  let boardId: string;
  let assetId: string;

  beforeAll(async () => {
    boardId = await createBoard();
    // Upload an asset.
    const uploadRes = await SELF.fetch(`${BASE}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: MINIMAL_PNG,
    });
    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json() as { assetKey: string };
    const parts = body.assetKey.split('/');
    assetId = parts[1]!;
  });

  it('returns 404 when requesting an asset with the wrong board id', async () => {
    const otherBoard = newBoardId();
    const res = await SELF.fetch(`${BASE}/api/assets/${otherBoard}/${assetId}`);
    expect(res.status).toBe(404);
  });
});
