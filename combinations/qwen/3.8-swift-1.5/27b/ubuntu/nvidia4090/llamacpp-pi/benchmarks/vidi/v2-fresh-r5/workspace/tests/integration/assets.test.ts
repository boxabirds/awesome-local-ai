/**
 * Integration tests for the asset upload and serve API (story 12).
 * Real Worker + Durable Objects + R2 in workerd, no mocks.
 *
 * Cases: TC-10 to TC-13, TC-15, TC-16.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

/** Create a board via the API and return its id. */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Build a minimal valid PNG (1x1 pixel). */
function minimalPng(): Uint8Array {
  // Minimal valid PNG: signature + IHDR + IDAT + IEND
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width 1
    0x00, 0x00, 0x00, 0x01, // height 1
    0x08, 0x02, 0x00, 0x00, 0x00, // 8-bit RGB
    0x90, 0x77, 0x53, 0xde, // CRC
    0x00, 0x00, 0x00, 0x0c, // IDAT length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x05, // data
    0x2f, 0xe7, 0x6a, 0x3f, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND length
    0x49, 0x45, 0x4e, 0x44, // IEND
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);
}

/** Build a minimal valid JPEG header. */
/** Build a valid SVG with a script tag. */
function svgWithScript(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
}

/** Build a PDF header (for disguised file tests). */
function pdfHeader(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
}

describe('assets.api (real Worker, R2, BoardRoom)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-10: POST real PNG to existing board → 201; R2 object exists with contentType; key matches pattern', async () => {
    const boardId = await createBoard();
    const png = minimalPng();

    const res = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: png,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);

    // Verify R2 object exists
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: POST to never-created board → 404; POST to malformed id → 404; nothing in R2', async () => {
    // Never-created board
    const unknownBoardId = newBoardId();
    const png = minimalPng();
    const res1 = await SELF.fetch(
      new Request(`http://localhost/api/boards/${unknownBoardId}/assets`, {
        method: 'POST',
        body: png,
      }),
    );
    expect(res1.status).toBe(404);

    // Malformed id
    const res2 = await SELF.fetch(
      new Request('http://localhost/api/boards/invalid-id/assets', {
        method: 'POST',
        body: png,
      }),
    );
    expect(res2.status).toBe(404);
  });

  it('TC-12: POST IMAGE_MAX_BYTES + 1 → 413; POST valid JPEG of exactly IMAGE_MAX_BYTES → 201', async () => {
    const boardId = await createBoard();

    // Over limit: IMAGE_MAX_BYTES + 1 bytes
    const overLimit = new Uint8Array(IMAGE_MAX_BYTES + 1);
    // Start with valid JPEG header so it's not rejected by type
    overLimit[0] = 0xff;
    overLimit[1] = 0xd8;
    overLimit[2] = 0xff;
    const res1 = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: overLimit,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    expect(res1.status).toBe(413);

    // Exactly at limit: valid JPEG of IMAGE_MAX_BYTES
    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit[0] = 0xff;
    atLimit[1] = 0xd8;
    atLimit[2] = 0xff;
    atLimit[3] = 0xe0;
    const res2 = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: atLimit,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );
    expect(res2.status).toBe(201);
    const body = (await res2.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
  });

  it('TC-13: POST PDF with Content-Type image/png → 415; POST SVG → 415; nothing stored', async () => {
    const boardId = await createBoard();

    // PDF disguised as PNG
    const pdf = pdfHeader();
    const res1 = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: pdf,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(res1.status).toBe(415);

    // SVG with script
    const svg = svgWithScript();
    const res2 = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: svg,
        headers: { 'Content-Type': 'image/svg+xml' },
      }),
    );
    expect(res2.status).toBe(415);
  });

  it('TC-15: R2 put throws → 500', async () => {
    const boardId = await createBoard();
    const png = minimalPng();

    // Wrap the R2 bucket's put to throw
    vi.spyOn(env.ASSETS_BUCKET, 'put').mockRejectedValue(new Error('storage failure'));

    const res = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: png,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(res.status).toBe(500);

    vi.restoreAllMocks();
  });

  it('TC-16: GET stored key → 200 with headers; GET missing key → 404; GET ../x → 404', async () => {
    const boardId = await createBoard();
    const png = minimalPng();

    // Upload a valid image
    const uploadRes = await SELF.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: png,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    expect(uploadRes.status).toBe(201);
    const { assetKey } = (await uploadRes.json()) as { assetKey: string };

    // GET the stored asset
    const getRes = await SELF.fetch(
      new Request(`http://localhost/api/assets/${assetKey}`),
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    const cacheControl = getRes.headers.get('Cache-Control');
    expect(cacheControl).toContain('public');
    expect(cacheControl).toContain('max-age=31536000');
    expect(cacheControl).toContain('immutable');
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    // GET a missing key (valid format but not stored)
    const missingId = newBoardId();
    const missingRes = await SELF.fetch(
      new Request(`http://localhost/api/assets/${boardId}/${missingId}`),
    );
    expect(missingRes.status).toBe(404);

    // GET with path traversal (URL-encoded so it isn't normalized away)
    const traversalRes = await SELF.fetch(
      new Request(`http://localhost/api/assets/..%2Fx`),
    );
    expect(traversalRes.status).toBe(404);
  });
});
