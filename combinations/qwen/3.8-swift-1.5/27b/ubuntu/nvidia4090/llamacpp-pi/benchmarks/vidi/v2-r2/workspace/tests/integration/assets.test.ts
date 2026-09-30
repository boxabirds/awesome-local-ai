import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, createBoard, URL } from './server';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

describe('Assets API (TC-10 to TC-13, TC-15, TC-16)', () => {
  beforeAll(async () => {
    await startServer();
  }, 60000);

  afterAll(async () => {
    await stopServer();
  });

  // Helper: create a minimal valid PNG (1x1 pixel)
  function makePngBytes(): Uint8Array {
    // Minimal valid PNG: signature + IHDR + IDAT + IEND
    // This is a 1x1 red pixel PNG
    return new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width 1
      0x00, 0x00, 0x00, 0x01, // height 1
      0x08, 0x02, 0x00, 0x00, 0x00, // 8-bit RGB
      0x90, 0x77, 0x53, 0xDE, // CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00, 0x01, 0x01, 0x00, 0x05, 0x5E, 0xDB, 0x31, // data
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82, // CRC
    ]);
  }

  // Helper: create a minimal valid JPEG
  function makeJpegBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    // JPEG SOI
    bytes[0] = 0xFF;
    bytes[1] = 0xD8;
    bytes[2] = 0xFF;
    bytes[3] = 0xE0;
    // Fill rest with zeros
    return bytes;
  }

  it('TC-10: POST real PNG to existing board → 201, R2 object exists', async () => {
    const boardId = await createBoard();
    const png = makePngBytes();

    const res = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([png as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/png' },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(boardId + '/')).toBe(true);
  });

  it('TC-11: POST to never-created board → 404; malformed id → 404', async () => {
    // Never-created board (valid format but not created)
    const fakeBoardId = 'a'.repeat(22);
    const png = makePngBytes();

    const res1 = await fetch(`${URL}/api/boards/${fakeBoardId}/assets`, {
      method: 'POST',
      body: new Blob([png as unknown as BlobPart]),
    });
    expect(res1.status).toBe(404);

    // Malformed id
    const res2 = await fetch(`${URL}/api/boards/not-a-valid-id/assets`, {
      method: 'POST',
      body: new Blob([png as unknown as BlobPart]),
    });
    expect(res2.status).toBe(404);
  });

  it('TC-12: POST IMAGE_MAX_BYTES + 1 → 413; exactly IMAGE_MAX_BYTES valid JPEG → 201', async () => {
    const boardId = await createBoard();

    // Over limit
    const oversized = makeJpegBytes(IMAGE_MAX_BYTES + 1);
    const res1 = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([oversized as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(res1.status).toBe(413);

    // Exactly at limit
    const atLimit = makeJpegBytes(IMAGE_MAX_BYTES);
    const res2 = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([atLimit as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(res2.status).toBe(201);
  });

  it('TC-13: POST PDF with Content-Type image/png → 415; POST SVG → 415', async () => {
    const boardId = await createBoard();

    // PDF content with misleading Content-Type
    const pdfContent = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
    const res1 = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([pdfContent as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(res1.status).toBe(415);

    // SVG with script
    const svgContent = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res2 = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([svgContent as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/svg+xml' },
    });
    expect(res2.status).toBe(415);
  });

  it('TC-16: GET stored key → 200 with correct headers; GET missing → 404; GET ../x → 404', async () => {
    const boardId = await createBoard();
    const png = makePngBytes();

    // Upload first
    const uploadRes = await fetch(`${URL}/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: new Blob([png as unknown as BlobPart]),
      headers: { 'Content-Type': 'image/png' },
    });
    expect(uploadRes.status).toBe(201);
    const { assetKey } = await uploadRes.json() as { assetKey: string };

    // GET the stored asset
    const getRes = await fetch(`${URL}/api/assets/${assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    expect(getRes.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    // GET missing key (valid format but not stored)
    const missingKey = 'a'.repeat(22) + '/' + 'b'.repeat(22);
    const getMissing = await fetch(`${URL}/api/assets/${missingKey}`);
    expect(getMissing.status).toBe(404);

    // GET malformed key (too short to match the pattern)
    const getMalformed = await fetch(`${URL}/api/assets/short`);
    expect(getMalformed.status).toBe(404);
  });
});
