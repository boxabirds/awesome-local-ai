// Story 12 task 4 — the asset endpoints, against real R2 and a real BoardRoom.
//
// Everything here is the platform's own machinery: Miniflare's R2, the Durable Object that
// answers whether a board exists, and the Rate Limiting binding whose numbers come from
// wrangler.jsonc. That matters most for the two things this suite exists to pin down. The first
// is that a file is decided by its bytes: a PDF with a `.png` name and a `Content-Type` of
// `image/png` is refused, and the only way to show that is to send those bytes through a request
// pipeline that never looks at the name. The second is that nothing is ever half-written — every
// error path here asserts the bucket is unchanged, because a board's picture that failed to
// arrive should not exist at all.
import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format.ts';
import {
  ASSET_CACHE_MAX_AGE_S,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
} from '../../src/shared/config.ts';
import { handleUpload, type AssetUploadEnv } from '../../src/worker/assets.ts';
import type { Env } from '../../src/worker/index.ts';
import { imageBytes, jpegOfExactSize } from '../fixtures/images/files.ts';

const realEnv = env as unknown as Env;
const bucket = () => (env as unknown as { ASSETS_BUCKET: R2Bucket }).ASSETS_BUCKET;

/** A unique simulated visitor: no two tests share an upload allowance. */
let visitorCounter = 0;
function visitor(): Record<string, string> {
  visitorCounter++;
  return { 'CF-Connecting-IP': `198.51.100.${visitorCounter}-${Date.now() % 100000}` };
}

async function makeBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST', headers: visitor() });
  expect(res.status).toBe(201);
  return String((await res.json() as { id: string }).id);
}

function upload(boardId: string, body: BodyInit, headers: Record<string, string> = {}) {
  return SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
    method: 'POST',
    body,
    headers: { ...visitor(), ...headers },
  });
}

function serve(boardId: string, assetId: string, headers: Record<string, string> = {}) {
  return SELF.fetch(`http://localhost/api/assets/${boardId}/${assetId}`, { headers });
}

/** Every key stored under a board, which is what "nothing was written" is measured by. */
async function storedKeys(boardId: string): Promise<string[]> {
  const listed = await bucket().list({ prefix: `${boardId}/` });
  return listed.objects.map((o) => o.key);
}

describe('POST /api/boards/:boardId/assets (image.uploading, image.types)', () => {
  it('TC-10 stores a real PNG and answers with the address of it', async () => {
    const boardId = await makeBoard();
    const res = await upload(boardId, imageBytes('png-24'), {
      'Content-Type': 'image/png',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    // The key is the board's own prefix plus an id minted here, so a board's pictures are one
    // group and no client ever names a path it wants written to.
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const stored = await bucket().get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(imageBytes('png-24'));
  });

  it('names a picture by its bytes, whatever the request claimed about it', async () => {
    const boardId = await makeBoard();
    // A JPEG uploaded as `image/png`, with no extension and a lying Content-Type: stored as
    // what it is, and served as that. The client's claim is never a fact the board keeps.
    const res = await upload(boardId, imageBytes('jpeg-24'), {
      'Content-Type': 'image/png',
      'X-File-Name': 'holiday.bogus',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    expect((await bucket().get(body.assetKey))?.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('TC-11 refuses a board that is not there, and writes nothing for it', async () => {
    const neverCreated = newBoardId();
    const res = await upload(neverCreated, imageBytes('png-24'));
    expect(res.status).toBe(404);
    expect(await storedKeys(neverCreated)).toEqual([]);

    // A malformed id is not a board either, and the namespace is never touched for it.
    for (const bogus of ['nope', '', '..', `${newBoardId()}/../../elsewhere`]) {
      const bad = await SELF.fetch(`http://localhost/api/boards/${bogus}/assets`, {
        method: 'POST',
        body: imageBytes('png-24'),
        headers: visitor(),
      });
      expect(bad.status).toBe(404);
    }
  });

  it('TC-12 refuses one byte over the limit and takes a file exactly at it', async () => {
    const boardId = await makeBoard();

    const over = await upload(boardId, jpegOfExactSize(IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);
    expect(await storedKeys(boardId)).toEqual([]);

    // The boundary, with a file that is a real JPEG and exactly 10 MB: a limit tested only from
    // above is a limit that may have been set too low.
    const at = await upload(boardId, jpegOfExactSize(IMAGE_MAX_BYTES));
    expect(at.status).toBe(201);
    const keys = await storedKeys(boardId);
    expect(keys).toHaveLength(1);
  });

  it('TC-13 refuses a disguised file and an SVG, and stores neither', async () => {
    const boardId = await makeBoard();

    // A PDF with a picture's name and a picture's Content-Type. The name is what a person sees
    // and the Content-Type is what a browser was told; neither is what the file is.
    const pdf = await upload(boardId, imageBytes('pdf'), {
      'Content-Type': 'image/png',
      'X-File-Name': 'photo.png',
    });
    expect(pdf.status).toBe(415);

    // SVG is a document that can carry script. It is not an accepted type for that reason, and
    // serving it back with any content type at all would be one board link away from running.
    const svg = await upload(boardId, imageBytes('svg'), { 'Content-Type': 'image/svg+xml' });
    expect(svg.status).toBe(415);

    // A file with no signature to read, and no file at all.
    expect((await upload(boardId, 'not an image, not any kind')).status).toBe(415);
    expect((await upload(boardId, new Uint8Array(0))).status).toBe(415);

    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('TC-14 stops a visitor at the allowance, and stops nobody else', async () => {
    const boardId = await makeBoard();
    const headers = visitor();
    let lastStatus = 0;

    // IMAGE_UPLOAD_LIMIT + 1 uploads from one visitor: the last is refused, and the message that
    // comes back is the one the user is shown.
    for (let i = 0; i <= IMAGE_UPLOAD_LIMIT; i++) {
      const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: imageBytes('gif-animated'),
        headers,
      });
      lastStatus = res.status;
      if (i < IMAGE_UPLOAD_LIMIT) expect(res.status).toBe(201);
    }
    expect(lastStatus).toBe(429);

    const limited = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: imageBytes('gif-animated'),
      headers,
    });
    // Only the status is a server concern; the sentence a user reads about it
    // (`IMAGE_UPLOAD_LIMIT_MESSAGE`) is the board's own wording and is asserted where the
    // toast renders, because a screen shows the same message for an upload it never sent.
    expect(limited.status).toBe(429);
    expect((await limited.json() as { error: string }).error).toBe('rate_limited');

    // The allowance is per visitor, not per board: the next person to arrive is not held up by
    // the one who was dropping sixty pictures.
    const someoneElse = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: imageBytes('gif-animated'),
      headers: visitor(),
    });
    expect(someoneElse.status).toBe(201);
  });

  it('TC-15 answers 500 when the bucket fails, and the board keeps no ghost of it', async () => {
    const boardId = await makeBoard();
    // A real failure of the storage call cannot be arranged on Miniflare's bucket, so the bucket
    // is wrapped — the same injection style the storage tests use for SQLite.
    const failing = {
      put: async () => {
        throw new Error('injected R2 write failure');
      },
      get: async () => null,
    } as unknown as R2Bucket;
    const envLike = {
      BOARD_ROOM: realEnv.BOARD_ROOM as unknown as AssetUploadEnv['BOARD_ROOM'],
      ASSETS_BUCKET: failing,
      ASSET_UPLOAD_LIMITER: realEnv.ASSET_UPLOAD_LIMITER,
    } satisfies AssetUploadEnv;

    const request = new Request(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: imageBytes('png-24'),
      headers: visitor(),
    });
    const res = await handleUpload(request, envLike, boardId);
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('storage_unavailable');
    expect(await storedKeys(boardId)).toEqual([]);
  });

  it('answers a method that is not an upload rather than ignoring it', async () => {
    const boardId = await makeBoard();
    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'GET',
      headers: visitor(),
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /api/assets/:boardId/:assetId (image.shared, image.unavailable)', () => {
  it('TC-16 serves a stored picture with the headers that make it safe to keep', async () => {
    const boardId = await makeBoard();
    const uploaded = (await (await upload(boardId, imageBytes('png-24'))).json()) as {
      assetKey: string;
    };
    const assetId = uploaded.assetKey.split('/')[1]!;

    const res = await serve(boardId, assetId);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_S}, immutable`,
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // Nothing this file could say has anywhere to go: no script, no form, no frame, no image
    // loaded from somewhere else.
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(imageBytes('png-24'));

    // A missing key and a key that is not a key are the same answer, which is what a screen
    // shows "Image unavailable" from.
    expect((await serve(boardId, newBoardId())).status).toBe(404);
    expect((await serve(newBoardId(), assetId)).status).toBe(404);
    expect((await SELF.fetch('http://localhost/api/assets/not-a-key')).status).toBe(404);

    // A path written to climb out of the bucket. A browser or a fetch collapses `..` before the
    // Worker sees it, so what arrives is a one-segment address that names nothing; the encoded
    // form keeps its shape and is refused by the key pattern, which cannot contain a percent.
    expect((await SELF.fetch(`http://localhost/api/assets/${boardId}/../x`)).status).toBe(404);
    const encoded = await SELF.fetch(`http://localhost/api/assets/${boardId}/..%2F${assetId}`);
    expect(encoded.status).toBe(404);
    // Neither of them was ever answered with the app, which would be a 200 and an HTML body.
    const traversal = await SELF.fetch(`http://localhost/api/assets/${boardId}/../../api/boards`);
    expect(traversal.status).toBe(404);
    expect(traversal.headers.get('Content-Type')).toContain('application/json');
  });

  it('serves every accepted type under the name it was stored with', async () => {
    const boardId = await makeBoard();
    const fixtures: [string, string][] = [
      ['png-24', 'image/png'],
      ['jpeg-24', 'image/jpeg'],
      ['webp-640x480', 'image/webp'],
      ['gif-animated', 'image/gif'],
    ];

    for (const [name, contentType] of fixtures) {
      const res = await upload(boardId, imageBytes(name));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { assetKey: string; contentType: string };
      expect(body.contentType).toBe(contentType);
      const served = await SELF.fetch(`http://localhost/api/assets/${body.assetKey}`);
      expect(served.status).toBe(200);
      expect(served.headers.get('Content-Type')).toBe(contentType);
    }
    expect(await storedKeys(boardId)).toHaveLength(fixtures.length);
  });
});
