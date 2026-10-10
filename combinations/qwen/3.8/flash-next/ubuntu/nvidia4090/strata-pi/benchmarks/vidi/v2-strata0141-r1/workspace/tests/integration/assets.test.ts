import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  ASSET_API_PREFIX,
  ASSET_UPLOAD_SUFFIX,
  BOARD_API_PREFIX,
  IMAGE_MAX_BYTES,
} from '../../src/shared/config';
import { ASSET_ID_PATTERN, isAssetKey } from '../../src/shared/image-format';
import { handleUpload, putAsset } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import { embeddedImage } from '../fixtures/embeddedImages';
import { newUnusedBoardId } from './helpers/room';

/**
 * Story 12 integration tests: `src/worker/assets.ts` inside the real Worker,
 * against the real R2 bucket declared in `wrangler.jsonc` (anchor `assets.api`).
 *
 * Every test addresses the API the client does - `POST /api/boards/:id/assets`,
 * `GET /api/assets/:boardId/:assetId` - through `SELF.fetch`, so the routes in
 * the Worker entry are part of what is tested, not just the handlers.
 */

const bindings = (): Env => env as unknown as Env;
// workerd has no access to the repository, so the fixture bytes come from the
// module `scripts/embed-image-fixtures.mjs` generated from `tests/fixtures/images/`.
const fixture = (name: string): Uint8Array => embeddedImage(name);

const SELF_ORIGIN = 'https://board.test';
/** `POST /api/boards/:boardId/assets`, built from the named route settings. */
const uploadUrl = (boardId: string): string =>
  `${SELF_ORIGIN}${BOARD_API_PREFIX}/${encodeURIComponent(boardId)}${ASSET_UPLOAD_SUFFIX}`;
/** `GET /api/assets/<key>`, the key split into its two segments. */
const assetUrl = (key: string): string =>
  `${SELF_ORIGIN}${ASSET_API_PREFIX}/${key.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;

const board = async (label: string): Promise<string> => {
  const response = await SELF.fetch(`${SELF_ORIGIN}${BOARD_API_PREFIX}`, { method: 'POST' });
  const body = (await response.json()) as { id?: string };
  if (typeof body.id !== 'string') {
    throw new Error(`${label}: POST /api/boards returned no id`);
  }
  return body.id;
};

const upload = async (
  boardId: string,
  bytes: Uint8Array,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await SELF.fetch(uploadUrl(boardId), {
    method: 'POST',
    body: new Uint8Array(bytes),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const keysUnder = async (prefix: string): Promise<string[]> => {
  const listed = await bindings().ASSETS_BUCKET.list({ prefix });
  return listed.objects.map((object) => object.key).sort();
};

/** A board id that is not a real board id, in the shapes an attack takes. */
const malformedIds = ['../etc', 'a'.repeat(23), 'bad id', '', 'brd1AAAAAAAAAAAAAAAAA%20'];

/* -------------------------------------------------------------------------- */

describe('assets.upload - the response the client needs (TC-10)', () => {
  // TC-10
  it('TC-10 an accepted upload returns an assetKey of this board and a content type', async () => {
    const boardId = await board('TC-10');
    const png = fixture('photo.png');

    const result = await upload(boardId, png);
    expect(result.status).toBe(201);
    expect(result.body.ok).toBe(true);
    expect(result.body.contentType).toBe('image/png');
    expect(result.body.bytes).toBe(png.byteLength);

    const assetKey = result.body.assetKey as string;
    expect(isAssetKey(assetKey)).toBe(true);
    // The key is board-prefixed, so only this board's routes can read it back.
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);
    const assetId = assetKey.slice(boardId.length + 1);
    expect(ASSET_ID_PATTERN.test(assetId)).toBe(true);
  });

  // TC-10
  it('TC-10 GET serves the same bytes with a cacheable content type', async () => {
    const boardId = await board('TC-10-serve');
    for (const [name, type] of [
      ['photo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.webp', 'image/webp'],
      ['animated.gif', 'image/gif'],
    ] as const) {
      const bytes = fixture(name);
      const result = await upload(boardId, bytes);
      expect(result.status).toBe(201);
      const assetKey = result.body.assetKey as string;
      expect(result.body.contentType).toBe(type);

      const response = await SELF.fetch(assetUrl(assetKey));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(type);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      // `image.immutable`: a key is written once, so this response never changes.
      expect(response.headers.get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      // Served inline, so the response itself forbids the bytes from doing anything.
      expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
      // No `Content-Disposition` anywhere: the browser renders it inline.
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(response.headers.get('etag')).not.toBeNull();
    }
  });

  it('every accepted format is stored under the content type the sniff answered with', async () => {
    const boardId = await board('formats');
    const webp = fixture('photo.webp');
    // The client's claim is irrelevant: the name says PNG, the bytes say WebP.
    const result = await upload(boardId, webp);
    expect(result.body.contentType).toBe('image/webp');
    const assetKey = result.body.assetKey as string;
    const response = await SELF.fetch(assetUrl(assetKey));
    expect(response.headers.get('content-type')).toBe('image/webp');
  });
});

describe('assets.upload - the board decides (TC-11)', () => {
  // TC-11
  it('TC-11 an upload for a board that was never created is refused and stores nothing', async () => {
    const boardId = newUnusedBoardId();
    const result = await upload(boardId, fixture('photo.png'));
    expect(result.status).toBe(404);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toBe('not_found');
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });

  // TC-11
  it('TC-11 a malformed board id is refused the same way, with nothing stored', async () => {
    for (const boardId of malformedIds) {
      const response = await SELF.fetch(uploadUrl(boardId), {
        method: 'POST',
        body: new Uint8Array(fixture('photo.png')),
      });
      expect(response.status).toBe(404);
      expect(await keysUnder(`${boardId}/`)).toEqual([]);
    }
  });

  it('an asset GET for a board that does not exist is a 404 and asks the bucket nothing', async () => {
    const boardId = newUnusedBoardId();
    const assetId = newBoardId();
    const response = await SELF.fetch(assetUrl(`${boardId}/${assetId}`));
    expect(response.status).toBe(404);
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });

  it('a key that is not a key is answered 404 before the bucket is consulted', async () => {
    for (const key of [
      'not-a-key',
      'brd1AAAAAAAAAAAAAAAAAA',
      'brd1AAAAAAAAAAAAAAAAAA/secret!',
      `brd1AAAAAAAAAAAAAAAAAA/${'x'.repeat(70)}`,
      `${'a'.repeat(23)}/${newBoardId()}`,
    ]) {
      const response = await SELF.fetch(assetUrl(key));
      expect(response.status).toBe(404);
    }
  });
});

describe('assets.upload - byte limit and sniffed type (TC-12)', () => {
  /**
   * A JPEG-shaped body of exactly `length` bytes: `FF D8 FF` (what the sniff
   * looks for) then padding. The byte limit is a limit on the **size** of what
   * was uploaded, so the test needs a body of an exact size; the real-file
   * versions of the same check - built by padding a real JPEG with comment
   * segments - are in the unit suite, which can read files.
   */
  const jpegOfByteLength = (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    bytes[3] = 0xe0;
    bytes[length - 2] = 0xff;
    bytes[length - 1] = 0xd9;
    return bytes;
  };

  // TC-12
  it('TC-12 exactly the limit is accepted, one byte more is not', async () => {
    const boardId = await board('TC-12');

    const accepted = await upload(boardId, jpegOfByteLength(IMAGE_MAX_BYTES));
    expect(accepted.status).toBe(201);
    expect(accepted.body.ok).toBe(true);

    const refused = await upload(boardId, jpegOfByteLength(IMAGE_MAX_BYTES + 1));
    expect(refused.status).toBe(413);
    expect(refused.body.ok).toBe(false);
    expect(refused.body.error).toBe('image_too_large');

    // The refused upload left nothing behind: exactly the accepted one is stored.
    expect(await keysUnder(`${boardId}/`)).toHaveLength(1);
  });

  // TC-12
  it('TC-12 a PDF named .png is refused by the sniff, not by its name', async () => {
    const boardId = await board('TC-12-pdf');
    const result = await upload(boardId, fixture('not-an-image.png'));
    expect(result.status).toBe(415);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toBe('unsupported_image_type');
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });

  it('a head too short to be a header is refused rather than guessed at', async () => {
    const boardId = await board('short');
    const result = await upload(boardId, fixture('truncated.png').subarray(0, 5));
    expect(result.status).toBe(415);
    expect(result.body.error).toBe('unsupported_image_type');
  });

  /**
   * The Worker sniffs; it does not decode. A file whose bytes *start* like a PNG
   * is stored, and the client is what refuses it - `createImageBitmap` fails on
   * it long before an upload (`validateFiles`, TC-03). What the Worker refuses is
   * bytes no accepted format could have begun with.
   */
  it('bytes that begin with a real magic number are stored even if they are cut short', async () => {
    const boardId = await board('truncated');
    const result = await upload(boardId, fixture('truncated.png'));
    expect(result.status).toBe(201);
    expect(result.body.contentType).toBe('image/png');
  });

  it('an empty body is refused rather than stored as a zero-byte asset', async () => {
    const boardId = await board('empty');
    const result = await upload(boardId, new Uint8Array(0));
    expect(result.status).toBe(415);
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });
});

describe('assets.bucket - one prefix per board (TC-13)', () => {
  // TC-13
  // TC-13: an SVG is refused like a disguised PDF - a vector file is a document.
  it('TC-13 an SVG with a script tag is refused 415 and nothing is stored', async () => {
    const boardId = await board('TC-13-svg');
    const result = await upload(boardId, fixture('drawing.svg'));
    expect(result.status).toBe(415);
    expect(result.body.error).toBe('unsupported_image_type');
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });

  /**
   * `fetch` will not let a caller lie about `Content-Length` (it is a forbidden
   * header name), so the claim is made on a `Request` the Worker is handed
   * directly - which is the shape the check exists for: a request that announces
   * more than the limit is answered without reading its body.
   */
  it('a request that announces a huge Content-Length is refused before its body is read', async () => {
    const boardId = await board('content-length');
    const request = new Request(uploadUrl(boardId), {
      method: 'POST',
      body: new Uint8Array(fixture('photo.png')),
    });
    request.headers.set('content-length', String(IMAGE_MAX_BYTES + 1_000_000));
    const response = await handleUpload(request, bindings(), boardId);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: 'image_too_large' });
    expect(await keysUnder(`${boardId}/`)).toEqual([]);
  });

  it('TC-13 two uploads to the same board get different keys under that board', async () => {
    const boardId = await board('TC-13');
    const first = await upload(boardId, fixture('photo.png'));
    const second = await upload(boardId, fixture('photo.png'));
    const keyA = first.body.assetKey as string;
    const keyB = second.body.assetKey as string;
    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith(`${boardId}/`)).toBe(true);
    expect(keyB.startsWith(`${boardId}/`)).toBe(true);
    expect(await keysUnder(`${boardId}/`)).toEqual([keyA, keyB].sort());
  });

  // TC-13
  it('TC-13 no request for another board can read a board-prefixed key', async () => {
    const boardA = await board('assetsA');
    const boardB = await board('assetsB');
    const uploaded = await upload(boardA, fixture('photo.png'));
    const keyOfA = uploaded.body.assetKey as string;

    // Same asset id, another board: the bucket holds it under `boardA/`, so this
    // is a different key that does not exist.
    const assetId = keyOfA.slice(boardA.length + 1);
    const crossBoard = await SELF.fetch(assetUrl(`${boardB}/${assetId}`));
    expect(crossBoard.status).toBe(404);

    // ... and reading board A's own key works.
    const own = await SELF.fetch(assetUrl(keyOfA));
    expect(own.status).toBe(200);

    // Each board's prefix holds exactly its own assets.
    expect(await keysUnder(`${boardA}/`)).toEqual([keyOfA]);
    expect(await keysUnder(`${boardB}/`)).toEqual([]);
  });
});

describe('assets.upload - a failed write (TC-15)', () => {
  /** The bindings, with a bucket whose writes fail for `boardId` alone. */
  const bucketThatFailsFor = (envValue: Env, failingBoardId: string): Env => {
    const bucket = envValue.ASSETS_BUCKET;
    const refuses = (key: string): void => {
      if (key.startsWith(`${failingBoardId}/`)) {
        throw new Error('the bucket refused the write');
      }
    };
    return {
      ...envValue,
      ASSETS_BUCKET: {
        ...bucket,
        put: async (key: string, value: unknown, options?: unknown): Promise<R2Object | null> => {
          refuses(key);
          return (
            bucket.put as (
              k: string,
              v: unknown,
              o: unknown,
            ) => Promise<R2Object | null>
          )(key, value, options);
        },
        head: async (key: string): Promise<R2Object | null> => {
          refuses(key);
          return bucket.head(key);
        },
        get: async (key: string): Promise<R2Object | R2ObjectBody | null> => {
          refuses(key);
          return bucket.get(key);
        },
        list: (options?: unknown) => bucket.list(options as never),
        delete: async (key: string): Promise<void> => {
          refuses(key);
          await bucket.delete(key);
        },
      } as unknown as R2Bucket,
    };
  };

  // TC-15
  it('TC-15 a storage failure is an error status with nothing stored', async () => {
    const failing = newUnusedBoardId();
    const envValue = bucketThatFailsFor(bindings(), failing);
    const result = await putAsset(envValue, failing, fixture('photo.png'));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(500);
      expect(result.error).toBe('asset_store_failed');
    }
    expect(await keysUnder(`${failing}/`)).toEqual([]);
  });

  // TC-15: one board's failure is that board's alone.
  it('TC-15 one board refused by storage does not stop another board uploading', async () => {
    const failing = await board('failing');
    const healthy = await board('healthy');
    const envValue = bucketThatFailsFor(bindings(), failing);

    const broken = await putAsset(envValue, failing, fixture('photo.png'));
    expect(broken.ok).toBe(false);

    const fine = await putAsset(envValue, healthy, fixture('photo.png'));
    expect(fine.ok).toBe(true);
    if (fine.ok) {
      expect(fine.assetKey.startsWith(`${healthy}/`)).toBe(true);
    }
    expect(await keysUnder(`${failing}/`)).toEqual([]);
    expect(await keysUnder(`${healthy}/`)).toHaveLength(1);
  });
});

describe('assets.upload - method and route shape', () => {
  it('a GET on the upload route is refused, and never read as an asset request', async () => {
    const boardId = await board('methods');
    const response = await SELF.fetch(uploadUrl(boardId));
    expect(response.status).toBe(405);
  });

  it('an asset read answers HEAD with the same headers and no body', async () => {
    const boardId = await board('head');
    const uploaded = await handleUploadOf(boardId, fixture('photo.webp'));
    const response = await SELF.fetch(assetUrl(uploaded), {
      method: 'HEAD',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  it('the worker handler itself is reachable through the same routes as SELF', async () => {
    const boardId = await board('direct-handler');
    const request = new Request(uploadUrl(boardId), {
      method: 'POST',
      body: new Uint8Array(fixture('photo.png')),
    });
    const response = await handleUpload(request, bindings(), boardId);
    expect(response.status).toBe(201);
  });
});

async function handleUploadOf(boardId: string, bytes: Uint8Array): Promise<string> {
  const result = await upload(boardId, bytes);
  if (result.status !== 201) {
    throw new Error(`upload failed with ${result.status}`);
  }
  return result.body.assetKey as string;
}
