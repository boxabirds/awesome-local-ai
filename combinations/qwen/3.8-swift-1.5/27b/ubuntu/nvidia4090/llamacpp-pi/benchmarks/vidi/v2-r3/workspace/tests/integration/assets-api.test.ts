import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

/** Create a board via the public API (returns 201 on success). */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

// TC-10: upload happy path
describe('TC-10: upload happy path', () => {
  it('stores an 800x600 PNG → 201, assetKey matches <22>/<22>, contentType from magic bytes, round-trips byte-identical', async () => {
    const boardId = await createBoard();

    // Create a minimal valid PNG (800x600)
    // We'll use a small valid PNG header + some pixel data
    const pngBytes = makeTestPng(800, 600);
    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: pngBytes as unknown as BodyInit,
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    // Key should match <22>/<22>
    const [bId, aId] = body.assetKey.split('/');
    expect(bId).toHaveLength(22);
    expect(aId).toHaveLength(22);
    expect(bId).toBe(boardId);

    // Round-trip: GET the asset and verify bytes are identical
    const getRes = await SELF.fetch(`http://localhost/api/assets/${body.assetKey}`);
    expect(getRes.status).toBe(200);
    const roundTrip = new Uint8Array(await getRes.arrayBuffer());
    expect(roundTrip).toEqual(pngBytes);
  });
});

// TC-11: board id pattern
describe('TC-11: board id pattern', () => {
  it('POST /api/boards/<10 chars>/assets → 404', async () => {
    const res = await SELF.fetch('http://localhost/api/boards/shortid/assets', {
      method: 'POST',
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) as unknown as BodyInit,
    });
    expect(res.status).toBe(404);
  });
});

// TC-12: unknown board
describe('TC-12: unknown board', () => {
  it('POST /api/boards/<valid 22>/assets where board does not exist → 404', async () => {
    // A valid 22-char board id that was never created
    const nonExistent = 'a'.repeat(22);
    const pngBytes = makeTestPng(100, 100);
    const res = await SELF.fetch(`http://localhost/api/boards/${nonExistent}/assets`, {
      method: 'POST',
      body: pngBytes as unknown as BodyInit,
    });
    expect(res.status).toBe(404);
  });
});

// TC-13: size limit
describe('TC-13: size limit', () => {
  it('10 MB + 1 PNG → 413 (Content-Length check before body read)', async () => {
    const boardId = await createBoard();
    // Create a buffer of 10MB + 1 with PNG header
    const size = 10 * 1024 * 1024 + 1;
    const buf = new Uint8Array(size);
    // PNG magic bytes
    buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
    buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: buf as unknown as BodyInit,
    });
    expect(res.status).toBe(413);
  });
});

// TC-15: unsupported type
describe('TC-15: unsupported type', () => {
  it('valid PNG header replaced by SVG text → 415', async () => {
    const boardId = await createBoard();
    // SVG content
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: svg as unknown as BodyInit,
    });
    expect(res.status).toBe(415);
  });
});

// TC-16: serve caching
describe('TC-16: serve caching', () => {
  it('GET stored PNG → 200, Content-Type: image/png, Cache-Control with max-age=31536000 and immutable, X-Content-Type-Options: nosniff', async () => {
    const boardId = await createBoard();
    const pngBytes = makeTestPng(100, 100);

    const uploadRes = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: pngBytes as unknown as BodyInit,
    });
    const { assetKey } = await uploadRes.json() as { assetKey: string };

    const getRes = await SELF.fetch(`http://localhost/api/assets/${assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    const cacheControl = getRes.headers.get('Cache-Control');
    expect(cacheControl).toContain('max-age=31536000');
    expect(cacheControl).toContain('immutable');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('GET unknown asset → 404', async () => {
    const res = await SELF.fetch(`http://localhost/api/assets/${'a'.repeat(22)}/${'b'.repeat(22)}`);
    expect(res.status).toBe(404);
  });

  it('GET with invalid key pattern → 404', async () => {
    // Use a key that won't be normalized by the URL parser
    const res = await SELF.fetch(`http://localhost/api/assets/invalid_key_no_slash`);
    expect(res.status).toBe(404);
  });
});

/**
 * Create a minimal valid PNG buffer with the given dimensions.
 * This is a simplified PNG with proper header and IHDR chunk.
 */
function makeTestPng(width: number, height: number): Uint8Array {
  // PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // IHDR chunk
  const ihdrData = new Uint8Array(13);
  const view = new DataView(ihdrData.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  view.setUint8(8, 8);  // bit depth
  view.setUint8(9, 2);  // color type: RGB
  view.setUint8(10, 0); // compression
  view.setUint8(11, 0); // filter
  view.setUint8(12, 0); // interlace

  const ihdrLength = new Uint8Array(4);
  new DataView(ihdrLength.buffer).setUint32(0, 13);
  const ihdrType = new Uint8Array([0x49, 0x48, 0x44, 0x52]); // "IHDR"

  // CRC placeholder (we don't need valid CRC for the test)
  const crc = new Uint8Array([0, 0, 0, 0]);

  // IDAT chunk (minimal - just a marker)
  const idatData = new Uint8Array([0x00]);
  const idatLength = new Uint8Array(4);
  const idatType = new Uint8Array([0x49, 0x44, 0x41, 0x54]); // "IDAT"

  // IEND chunk
  const iendLength = new Uint8Array(4);
  const iendTime = new Uint8Array([0x49, 0x45, 0x4e, 0x44]); // "IEND"

  const parts = [
    new Uint8Array(sig),
    ihdrLength, ihdrType, ihdrData, crc,
    idatLength, idatType, idatData, crc,
    iendLength, iendTime, crc,
  ];

  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
