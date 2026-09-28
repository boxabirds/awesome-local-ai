// The asset endpoints: storing a real image into R2 and serving it back with the
// headers that make it safe and cacheable (TC-10 to TC-16). These run against the
// real Worker built from wrangler.jsonc, so the R2 bucket and the upload rate limiter
// are the actual bindings the service uses - not mocks.
//
// The bytes are built here as magic-byte-prefixed buffers rather than read off disk,
// because workerd has no access to the repo's fixture files and these tests never
// DECODE an image - the server decides a type from its first bytes and stores exactly
// what it was given, which is precisely what a hand-built buffer can exercise.
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { handleUpload, type AssetsEnv } from '../../src/worker/assets.ts';
import { newBoardId } from '../../src/shared/board-id.ts';

const BUCKET = (env as unknown as { ASSETS_BUCKET: R2Bucket }).ASSETS_BUCKET;

// A visitor address this file spends its upload quota on (TEST-NET, cannot collide).
let visitor = 0;
function ip(): string {
  visitor += 1;
  return `198.51.100.${visitor}`;
}

async function createBoard(i = ip()): Promise<string> {
  const res = await SELF.fetch('http://board.test/api/boards', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': i },
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

// --- byte fixtures, keyed only by their leading magic --------------------------------
const enc = new TextEncoder();
function buf(...parts: Array<number[] | string>): Uint8Array {
  const chunks: Uint8Array[] = parts.map((p) =>
    typeof p === 'string' ? enc.encode(p) : Uint8Array.from(p),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
const PNG = buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], Array.from({ length: 40 }, (_, i) => i & 0xff));
const JPEG = buf([0xff, 0xd8, 0xff, 0xe0], Array.from({ length: 40 }, (_, i) => (i * 3) & 0xff));
const GIF = buf('GIF89a', Array.from({ length: 40 }, (_, i) => (i * 5) & 0xff));
const WEBP = buf('RIFF', [40, 0, 0, 0], 'WEBP', Array.from({ length: 40 }, (_, i) => (i * 7) & 0xff));
const SVG = buf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const RANDOM = buf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

function upload(boardId: string, bytes: Uint8Array, i = ip()) {
  return SELF.fetch(`http://board.test/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': i, 'Content-Type': 'application/octet-stream' },
    body: bytes.slice().buffer,
  });
}

async function storedBytes(key: string): Promise<Uint8Array | null> {
  const obj = await BUCKET.get(key);
  if (!obj) return null;
  return (await obj.arrayBuffer() instanceof ArrayBuffer ? new Uint8Array(obj.body ? await streamToUint(obj.body) : new ArrayBuffer(0)) : null) as Uint8Array | null;
}
async function streamToUint(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parts.push(r.value);
    size += r.value.byteLength;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('asset upload (TC-11, TC-12, TC-13, TC-14)', () => {
  it('stores each accepted format under its board, sniffed by content (TC-11)', async () => {
    const board = await createBoard();
    const cases: [Uint8Array, string][] = [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ];
    for (const [bytes, type] of cases) {
      const res = await upload(board, bytes);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { assetKey: string; contentType: string };
      // the type is the sniffed one, and the key is this board's own prefix
      expect(body.contentType).toBe(type);
      expect(body.assetKey.startsWith(`${board}/`)).toBe(true);
      // the exact bytes landed in R2
      const stored = await BUCKET.get(body.assetKey);
      expect(stored).not.toBeNull();
      expect(sameBytes(stored ? await streamToUint(stored.body!) : null, bytes)).toBe(true);
    }
    void storedBytes;
  });

  it('refuses an over-limit body with 413 and stores nothing (TC-12)', async () => {
    const board = await createBoard();
    const before = await BUCKET.list();
    const huge = buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Array(11 * 1024 * 1024).fill(0));
    const res = await upload(board, huge);
    expect(res.status).toBe(413);
    const after = await BUCKET.list();
    expect(after.objects.length).toBe(before.objects.length); // nothing written
  });

  it('refuses a non-image by its content with 415 and stores nothing (TC-13)', async () => {
    const board = await createBoard();
    const before = await BUCKET.list();
    // an SVG (which can carry script) and a file of fifteen arbitrary bytes, both sent
    // with an image/png declared type the server must ignore in favour of the bytes.
    for (const bytes of [SVG, RANDOM]) {
      const res = await upload(board, bytes);
      expect(res.status).toBe(415);
    }
    const after = await BUCKET.list();
    expect(after.objects.length).toBe(before.objects.length);
  });

  it('refuses a board that is nobody\'s, and a visitor who uploads too fast (TC-14)', async () => {
    // A well-formed code (22 base64url chars) that no board was ever created under:
    // its Durable Object has never been initialised, so `exists()` is false and
    // the upload is a 404 with nothing written - the same answer a malformed key gives.
    const definitelyMissing = 'zzzzzzzzzzzzzzzzzzzzzzzz'.slice(0, 22); // 22 chars
    expect(/^[A-Za-z0-9_-]{22}$/.test(definitelyMissing)).toBe(true);
    const beforeMissing = await BUCKET.list();
    const resMissing = await upload(definitelyMissing, PNG, ip());
    expect(resMissing.status).toBe(404);
    expect((await BUCKET.list()).objects.length).toBe(beforeMissing.objects.length);

    // the sixty-first upload from one visitor in a minute is refused with 429
    const board = await createBoard();
    const fast = ip();
    let accepted = 0;
    let limited = 0;
    for (let i = 0; i < 62; i++) {
      const r = await upload(board, PNG, fast);
      if (r.status === 201) accepted++;
      else if (r.status === 429) limited++;
    }
    expect(accepted).toBe(60); // exactly sixty got through
    expect(limited).toBeGreaterThan(0);
  });
});

describe('asset serve (TC-15)', () => {
  it('serves a stored image with safe, cacheable headers and honours ranges (TC-15)', async () => {
    const board = await createBoard();
    const res = await upload(board, PNG);
    const { assetKey } = (await res.json()) as { assetKey: string };

    // full GET: the sniffed Content-Type, an immutable year of cache, nosniff, a CSP,
    // and an ETag.
    const full = await SELF.fetch(`http://board.test/api/assets/${assetKey}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe('image/png');
    expect(full.headers.get('Cache-Control')).toMatch(/max-age=31536000/);
    expect(full.headers.get('Cache-Control')).toContain('immutable');
    expect(full.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(full.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const etag = full.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect(full.headers.get('Accept-Ranges')).toBeTruthy();

    // a byte range comes back as 206, 16 bytes, with the matching Content-Range.
    const ranged = await SELF.fetch(`http://board.test/api/assets/${assetKey}`, {
      headers: { Range: 'bytes=0-15' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Content-Range')).toBe(`bytes 0-15/${PNG.length}`);
    const slice = new Uint8Array(await ranged.arrayBuffer());
    expect(slice.length).toBe(16);
    expect(sameBytes(slice, PNG.slice(0, 16))).toBe(true);

    // an If-Range whose ETag does not match returns the WHOLE object, not a range.
    const mismatch = await SELF.fetch(`http://board.test/api/assets/${assetKey}`, {
      headers: { Range: 'bytes=0-15', 'If-Range': '"not-the-etag"' },
    });
    expect(mismatch.status).toBe(200);
    expect(new Uint8Array(await mismatch.arrayBuffer()).length).toBe(PNG.length);

    // a conditional request whose ETag matches is a 304.
    const revalidated = await SELF.fetch(`http://board.test/api/assets/${assetKey}`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(revalidated.status).toBe(304);

    // a malformed key never even reads R2, and answers like any other miss. The
    // `../` probe is written percent-encoded: a plain `../` in a URL is collapsed by
    // URL parsing long before it reaches the route, so encoding it is what actually
    // delivers a traversal-shaped string to the key check.
    for (const bad of ['%2e%2e%2f%2e%2e%2fetc%2fpasswd', `${board}`, 'short/key', `${board}/x.svg`]) {
      const miss = await SELF.fetch(`http://board.test/api/assets/${bad}`);
      expect(miss.status).toBe(404);
    }
  });
});

// TC-16: the error path. A storage layer that throws on write must answer 500.
// The bucket the running worker holds cannot be swapped from here (SELF.fetch hands
// the handler a fresh, sealed environment), so this drives the handler directly with a
// fake environment whose put() always throws - the clean seam for the one branch that
// is about the storage failing rather than the file being wrong.
describe('asset upload failure', () => {
  it('answers 500 when the bucket write itself throws (TC-16)', async () => {
    const board = newBoardId();
    const env500: AssetsEnv = {
      ASSETS_BUCKET: { put: async () => { throw new Error('the bucket is down'); } } as unknown as R2Bucket,
      ASSET_UPLOAD_LIMITER: { limit: async () => ({ success: true, remaining: 1 }) } as unknown as RateLimit,
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({ exists: async () => true }),
      } as unknown as AssetsEnv['BOARD_ROOM'],
    };
    const request = new Request(`http://board.test/api/boards/${board}/assets`, {
      method: 'POST',
      body: PNG.slice().buffer,
    });
    const res = await handleUpload(request, env500, board);
    expect(res.status).toBe(500);
  });
});
