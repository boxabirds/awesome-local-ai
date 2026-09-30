/// <reference types="@cloudflare/vitest-pool-workers" />
/**
 * The image asset API (assets.api), against the real Worker entry, the real
 * BoardRoom Durable Object and a real (Miniflare) R2 bucket.
 *
 * These are the cases the whole "never store or serve what is not an image"
 * promise rests on, and they run for real because the guarantees are storage
 * facts: a refusal must write *nothing* to the bucket (TC-11, TC-12, TC-13), a
 * `201` must hand back a key whose two halves are both board ids (TC-10), and a
 * well-shaped-but-absent key must be answered without a lookup (TC-16). A mock
 * could not show that a byte was not written, or that `get` was not called.
 *
 * Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Asset upload and
 * serving API" (TC-10 to TC-13, TC-15, TC-16).
 */
import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetUrl } from '../../src/shared/image-format';
import type { Env } from '../../src/worker/index';
import type { BoardRoom } from '../../src/worker/board-room';

/** A created board, so an upload has somewhere to live. Returns its id. */
const newBoard = async (): Promise<string> => {
  const response = await SELF.fetch('https://vidi6.test/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
};

/** Upload `bytes` to `boardId`'s asset endpoint. `type` only sets the request's
 * `Content-Type`, which the server is written to ignore — the name in `filename`
 * is likewise carried to show a lie in either is what these tests are about. */
const upload = (
  boardId: string,
  bytes: BodyInit,
  opts: { type?: string; filename?: string; headers?: Record<string, string> } = {},
): Promise<Response> => {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.type !== undefined) headers['Content-Type'] = opts.type;
  const query = opts.filename === undefined ? '' : `?filename=${encodeURIComponent(opts.filename)}`;
  return SELF.fetch(`https://vidi6.test/api/boards/${boardId}/assets${query}`, {
    method: 'POST',
    headers,
    body: bytes,
  });
};

// A PNG/JPEG/WebP is its leading bytes plus filler; nothing here decodes the body,
// it only sniffs the head and measures the length (design: sniff IMAGE_SNIFF_BYTES).
const pngBytes = (total: number): Uint8Array => {
  const bytes = new Uint8Array(total);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const jpegBytes = (total: number): Uint8Array => {
  const bytes = new Uint8Array(total);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};
const gifBytes = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return bytes;
};
const webpBytes = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  return bytes;
};
const pdfBytes = (): Uint8Array => {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode('%PDF-1.4'));
  return bytes;
};
const svgBytes = (): Uint8Array =>
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>document.body.innerHTML="pwned"</script></svg>',
  );

/** Every key currently in the bucket, read from the bucket itself. */
const listKeys = (): Promise<string[]> =>
  env.ASSETS_BUCKET.list().then((page) => page.objects.map((object) => object.key));

/** Does `key` exist in the bucket? Read straight from the bucket, never the route. */
const stored = async (key: string): Promise<boolean> => (await env.ASSETS_BUCKET.head(key)) !== null;

describe('asset upload (assets.api, TC-10, TC-11, TC-12, TC-13)', () => {
  // TC-10: each accepted type uploads as a 201 carrying a two-board-id key.
  it('stores each accepted type and answers with a key of two board ids', async () => {
    const boardId = await newBoard();
    const cases: Array<[Uint8Array, string]> = [
      [pngBytes(64), 'image/png'],
      [jpegBytes(64), 'image/jpeg'],
      [gifBytes(), 'image/gif'],
      [webpBytes(), 'image/webp'],
    ];
    for (const [bytes, contentType] of cases) {
      const response = await upload(boardId, bytes, { type: contentType });
      expect(response.status).toBe(201);
      const body = (await response.json()) as { assetKey: string; contentType: string };
      expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
      // Both halves are 22-char board ids, and the first is exactly this board's id.
      const [boardPart, assetPart] = body.assetKey.split('/');
      expect(BOARD_ID_PATTERN.test(boardPart!)).toBe(true);
      expect(BOARD_ID_PATTERN.test(assetPart!)).toBe(true);
      expect(boardPart).toBe(boardId);
      expect(body.contentType).toBe(contentType);
      // The bytes really are in the bucket under that key.
      expect(await stored(body.assetKey)).toBe(true);
    }
  });

  // TC-11: an unknown board is a 404 and nothing reaches the bucket.
  it('refuses an upload for a board that does not exist, without storing', async () => {
    const missing = newBoardId();
    const before = await listKeys();
    const response = await upload(missing, pngBytes(64), { type: 'image/png' });
    expect(response.status).toBe(404);
    expect(await listKeys()).toEqual(before);
  });

  // TC-12: exactly IMAGE_MAX_BYTES is stored; IMAGE_MAX_BYTES + 1 is a 413 and
  // nothing is stored, and the over-large body never made it into a key.
  it('stores a file of exactly IMAGE_MAX_BYTES and refuses one byte more', async () => {
    const boardId = await newBoard();
    const before = await listKeys();

    const atLimit = await upload(boardId, pngBytes(IMAGE_MAX_BYTES), { type: 'image/png' });
    expect(atLimit.status).toBe(201);
    const { assetKey } = (await atLimit.json()) as { assetKey: string };
    expect(await stored(assetKey)).toBe(true);

    const over = await upload(boardId, pngBytes(IMAGE_MAX_BYTES + 1), { type: 'image/png' });
    expect(over.status).toBe(413);
    // The over-large body added nothing beyond the accepted file already stored.
    const after = await listKeys();
    expect(after.filter((key) => !before.includes(key))).toEqual([assetKey]);
  });

  // A real over-limit body is refused on its true length. (A lying `Content-Length`
  // cannot be sent through fetch — the runtime sets it from the body — so the
  // declared-length guard is exercised as an early-out in `handleUpload`, and this
  // test proves the real-length guard behind it does the refusing either way.)
  it('refuses an over-limit body on its real length', async () => {
    const boardId = await newBoard();
    const before = await listKeys();
    const real = await upload(boardId, pngBytes(IMAGE_MAX_BYTES + 1));
    expect(real.status).toBe(413);
    expect(await listKeys()).toEqual(before);
  });

  // TC-13: a script-carrying SVG, a PDF renamed `.png` and unrecognised bytes are
  // all a 415, and none of them is stored — whatever their `Content-Type`.
  it('refuses everything that is not an accepted image by its bytes', async () => {
    const boardId = await newBoard();
    const before = await listKeys();

    // The disguise: the header and the name both claim PNG, the bytes are a PDF.
    const renamed = await upload(boardId, pdfBytes(), {
      type: 'image/png',
      filename: 'screenshot.png',
    });
    expect(renamed.status).toBe(415);

    // An SVG that carries a script, honestly named and honestly typed.
    const svg = await upload(boardId, svgBytes(), { type: 'image/svg+xml' });
    expect(svg.status).toBe(415);

    // Neither a type nor a lie: three bytes that are none of the four.
    const junk = await upload(boardId, Uint8Array.from([0x01, 0x23, 0x45]), {
      type: 'image/png',
    });
    expect(junk.status).toBe(415);

    expect(await listKeys()).toEqual(before);
  });

  // A malformed board id in the upload path is a 404 and reaches no bucket.
  it('refuses a malformed board id in the upload path', async () => {
    // A 5-character id is a well-formed path but not a board id, so `handleUpload`
    // turns it away before it ever asks the room namespace or the bucket.
    const response = await upload('short', pngBytes(64), { type: 'image/png' });
    expect(response.status).toBe(404);
  });

  // A non-POST to the upload route is not allowed.
  it('is not an upload on any method but POST', async () => {
    const boardId = await newBoard();
    const response = await SELF.fetch(`https://vidi6.test/api/boards/${boardId}/assets`, {
      method: 'GET',
    });
    expect(response.status).toBe(405);
  });
});

describe('asset serving (assets.api, TC-16)', () => {
  // A stored image is served back with the type it was stored under, the cache
  // promise, and the two headers that keep it from ever being read as anything else.
  it('serves a stored image as an image and nothing else', async () => {
    const boardId = await newBoard();
    const uploadResponse = await upload(boardId, webpBytes(), { type: 'image/webp' });
    const { assetKey } = (await uploadResponse.json()) as { assetKey: string };

    const response = await SELF.fetch(`https://vidi6.test${assetUrl(assetKey)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    // The bytes are the bytes that went in.
    const served = new Uint8Array(await response.arrayBuffer());
    expect(served.subarray(0, 4)).toEqual(webpBytes().subarray(0, 4));
  });

  // TC-16: a traversal key and a wrong-length key are refused with no lookup at
  // all — the `get` counter proves the bucket was never asked.
  it('refuses a traversal key and a wrong-length key without a lookup', async () => {
    let gets = 0;
    const realGet = env.ASSETS_BUCKET.get.bind(env.ASSETS_BUCKET);
    (env.ASSETS_BUCKET as unknown as { get: (...args: unknown[]) => unknown }).get = (
      ...args: unknown[]
    ) => {
      gets += 1;
      return (realGet as (...a: unknown[]) => unknown)(...args);
    };

    try {
      // A key that walks out of the board's prefix, and one whose asset half is the
      // wrong length, are both simply not keys, and are answered before the bucket.
      // The `../` is percent-encoded so the URL keeps it inside one path segment and
      // it actually reaches the handler as a candidate key rather than being
      // collapsed away by URL normalisation on the way in.
      const traversal = await SELF.fetch(
        `https://vidi6.test/api/assets/${newBoardId()}/..%2f..%2fetc%2fpasswd`,
      );
      expect(traversal.status).toBe(404);
      expect(gets).toBe(0);

      const wrongLength = await SELF.fetch(
        `https://vidi6.test/api/assets/${newBoardId()}/${'short'}`,
      );
      expect(wrongLength.status).toBe(404);
      expect(gets).toBe(0);
    } finally {
      (env.ASSETS_BUCKET as unknown as { get: typeof realGet }).get = realGet;
    }
  });

  // A well-shaped key that was never stored is a 404, and it *did* reach the bucket.
  it('answers a well-shaped but absent key with a 404', async () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    let gets = 0;
    const realGet = env.ASSETS_BUCKET.get.bind(env.ASSETS_BUCKET);
    (env.ASSETS_BUCKET as unknown as { get: (...args: unknown[]) => unknown }).get = (
      ...args: unknown[]
    ) => {
      gets += 1;
      return (realGet as (...a: unknown[]) => unknown)(...args);
    };
    try {
      const response = await SELF.fetch(`https://vidi6.test${assetUrl(key)}`);
      expect(response.status).toBe(404);
      expect(gets).toBe(1);
    } finally {
      (env.ASSETS_BUCKET as unknown as { get: typeof realGet }).get = realGet;
    }
  });
});

describe('storage failure (assets.api, TC-15)', () => {
  // The only failure left after a file is accepted is the bucket itself: it answers
  // 500, and nothing was written for the request that failed.
  it('answers 500 when the bucket refuses a valid file, and nothing is stored', async () => {
    const boardId = await newBoard();
    const before = await listKeys();

    const realPut = env.ASSETS_BUCKET.put.bind(env.ASSETS_BUCKET);
    (env.ASSETS_BUCKET as unknown as { put: (...args: unknown[]) => unknown }).put = () => {
      throw new Error('simulated R2 write failure');
    };
    try {
      const response = await upload(boardId, pngBytes(64), { type: 'image/png' });
      expect(response.status).toBe(500);
      expect(await listKeys()).toEqual(before);
    } finally {
      (env.ASSETS_BUCKET as unknown as { put: typeof realPut }).put = realPut;
    }
  });
});

/** The room stub type is referenced so a reader sees the board is real, not mocked. */
export type _Room = DurableObjectStub<BoardRoom>;
export type _Env = Env;
