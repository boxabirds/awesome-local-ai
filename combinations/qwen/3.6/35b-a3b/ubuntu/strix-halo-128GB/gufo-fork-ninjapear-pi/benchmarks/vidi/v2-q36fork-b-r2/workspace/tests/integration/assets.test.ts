import { describe, it, expect } from 'vitest';
import { handleUpload, handleServe } from '../../src/worker/assets';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';

// Minimal PNG bytes (valid PNG)
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x18,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// Minimal JPEG bytes (valid JPEG)
const MINIMAL_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c,
  0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
  0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34,
  0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
  0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00,
  0xb5, 0x10, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
  0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x11, 0x00,
  0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05,
  0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0xff,
  0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11,
  0x03, 0x11, 0x00, 0x3f, 0x00, 0xa5, 0xe0, 0x41,
  0x3a, 0x80, 0x42, 0x19, 0xd9, 0xf4, 0x7f, 0xff,
  0xd9,
]);

// PDF content disguised as image
const DISGUISED_PDF = new TextEncoder().encode(
  '%PDF-1.4 fake document with script content',
);

// SVG text
const SVG_TEXT = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
);

/** Valid 22-char base64url ID */
const BOARD_ID = 'abcdefghijABCDEFGHIJKL';
// 22-char asset key for serve tests
const ASSET_KEY = 'assetKeyHere12ABCD5678';

/** Create an isolated mock R2 bucket for a single test */
function makeMockBucket(): R2Bucket {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  return {
    async put(key: string, value: BodyInit | null, opts?: R2PutOptions & { httpMetadata?: { contentType?: string } }): Promise<R2ObjectHandle> {
      if (!value) throw new Error('no body');
      const body = await new Response(value).arrayBuffer();
      store.set(key, {
        body,
        contentType: opts?.httpMetadata?.contentType ?? 'application/octet-stream',
      });
      return {} as R2ObjectHandle;
    },
    async get(key: string): Promise<R2Object | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: new Blob([entry.body]).stream(),
        bodyUsed: false,
        httpMetadata: { contentType: entry.contentType },
        size: entry.body.byteLength,
        key,
        lastModified: Date.now(),
        etag: '',
        cksum: undefined,
        customMetadata: undefined,
        write() { return {} as any; },
      } as any;
    },
    async delete(key: string): Promise<void> { store.delete(key); },
    async list(opts?: R2ListOptions): Promise<R2List> {
      const keys = opts?.prefix ? Array.from(store.keys()).filter(k => k.startsWith(opts.prefix)) : Array.from(store.keys());
      return {
        keys: keys.map(k => ({ key: k, size: 0, etag: '', lastModified: Date.now(), httpMetadata: undefined, customMetadata: undefined }) as R2ObjectInfo),
        truncated: false,
        count: keys.length,
        prefix: '',
        delimiter: '',
        pagesize: 0,
        cursor: '',
      };
    },
  } as R2Bucket;
}

describe('asset API handler (TC-10 to TC-13, TC-15, TC-16)', () => {

  // ===== TC-10 =====
  describe('TC-10: POST real PNG fixture to an existing board', () => {
    it('returns 201 with assetKey and contentType', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/testboard1234567890123/assets', {
          method: 'POST',
          body: MINIMAL_PNG,
        }),
        env,
        'testboard1234567890123',
      );
      expect(resp.status).toBe(201);
      const json = JSON.parse(await resp.text()) as { assetKey: string; contentType: string };
      expect(json.assetKey).toMatch(/^testboard1234567890123\/[A-Za-z0-9_-]{22}$/);
      expect(json.contentType).toBe('image/png');
    });

    it('stores object in R2 with correct content type', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const uploadResp = await handleUpload(
        new Request('http://example.com/api/boards/testboard1234567890123/assets', {
          method: 'POST',
          body: MINIMAL_PNG,
        }),
        env,
        'testboard1234567890123',
      );
      const json = JSON.parse(await uploadResp.text()) as { assetKey: string };

      // Serve it back
      const serveResp = await handleServe(new Request('http://example.com'), env, json.assetKey);
      expect(serveResp.status).toBe(200);
      expect(serveResp.headers.get('Content-Type')).toBe('image/png');
    });
  });

  // ===== TC-11 =====
  describe('TC-11: POST to never-created / malformed board id → 404', () => {
    it('returns 404 for malformed board id format', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/not-valid-id/assets', {
          method: 'POST',
          body: MINIMAL_PNG,
        }),
        env,
        'not-valid-id',
      );
      expect(resp.status).toBe(404);
    });
  });

  // ===== TC-12 =====
  describe('TC-12: size limit boundary', () => {
    it('returns 413 for IMAGE_MAX_BYTES + 1 via Content-Length', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const oversized = new ArrayBuffer(IMAGE_MAX_BYTES + 1);
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: oversized,
          headers: { 'Content-Length': String(IMAGE_MAX_BYTES + 1) },
        }),
        env,
        BOARD_ID,
      );
      expect(resp.status).toBe(413);
    });

    it('returns 201 for exactly IMAGE_MAX_BYTES valid JPEG', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const exactlyMax = new Uint8Array(IMAGE_MAX_BYTES);
      exactlyMax.set(MINIMAL_JPEG, 0);
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: exactlyMax,
        }),
        env,
        BOARD_ID,
      );
      expect(resp.status).toBe(201);
      const json = JSON.parse(await resp.text()) as { assetKey: string };
      expect(json.assetKey).toBeDefined();
    });
  });

  // ===== TC-13 =====
  describe('TC-13: wrong type by content', () => {
    it('rejects PDF disguised as image (sniffed as null)', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: DISGUISED_PDF,
          headers: { 'Content-Type': 'image/png' },
        }),
        env,
        BOARD_ID,
      );
      expect(resp.status).toBe(415);
    });

    it('rejects SVG text even with image Content-Type', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: SVG_TEXT,
          headers: { 'Content-Type': 'image/png' },
        }),
        env,
        BOARD_ID,
      );
      expect(resp.status).toBe(415);
    });

    it('nothing stored on rejection', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: DISGUISED_PDF,
          headers: { 'Content-Type': 'image/png' },
        }),
        env,
        BOARD_ID,
      );
      const list = await mockBucket.list();
      expect(list.keys.length).toBe(0);
    });
  });

  // ===== TC-15 =====
  describe('TC-15: R2 put failure → 500', () => {
    it('returns 500 when storage fails', async () => {
      const mockBucket = makeMockBucket();
      const origPut = mockBucket.put.bind(mockBucket);
      mockBucket.put = async () => { throw new Error('storage error'); };
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleUpload(
        new Request('http://example.com/api/boards/' + BOARD_ID + '/assets', {
          method: 'POST',
          body: MINIMAL_PNG,
        }),
        env,
        BOARD_ID,
      );
      expect(resp.status).toBe(500);
    });
  });

  // ===== TC-16 =====
  describe('TC-16: serve image with immutable caching and security headers', () => {
    it('GET stored key returns 200 with proper headers', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      // Upload first
      await mockBucket.put(`${BOARD_ID}/${ASSET_KEY}`, MINIMAL_PNG, {
        httpMetadata: { contentType: 'image/png' },
      });

      const resp = await handleServe(new Request('http://example.com'), env, `${BOARD_ID}/${ASSET_KEY}`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('Content-Type')).toBe('image/png');
      expect(resp.headers.get('Cache-Control')).toContain('immutable');
      expect(resp.headers.get('Cache-Control')).toContain('max-age=');
      expect(resp.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(resp.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    });

    it('GET missing key → 404', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleServe(new Request('http://example.com'), env, 'invalid/invalid');
      expect(resp.status).toBe(404);
    });

    it('GET path traversal → 404', async () => {
      const mockBucket = makeMockBucket();
      const env = { ASSETS_BUCKET: mockBucket };
      const resp = await handleServe(new Request('http://example.com'), env, '../x');
      expect(resp.status).toBe(404);
    });
  });
});
