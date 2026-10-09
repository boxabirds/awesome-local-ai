/**
 * Story 12 — board image assets on R2.
 *
 * POST /api/boards/:boardId/assets   upload one image (magic-byte sniff,
 *                                    10 MB limit, key <boardId>/<assetId>)
 * GET  /api/assets/:boardId/:assetId serve an image immutably (immutable +
 *                                    1-year Cache-Control, strict CSP, no
 *                                    sniffing)
 *
 * The client Content-Type is never trusted: the image format is decided from
 * the first IMAGE_SNIFF_BYTES of the body (a PDF renamed to .png is a 415).
 */
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { assetKeyFor, ASSET_KEY_PATTERN, sniffImageType } from '../shared/image-format';
import { newBoardId } from '../shared/board-id';
import type { AcceptedImageType } from '../shared/config';
import type { Env } from './index';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type PutCall = (key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }) => Promise<unknown>;

/**
 * Test-only fault seam (TC-15): makes the R2 put() throw, so the worker's
 * error path (500) is testable. Set only by the /__test hook routes
 * (env.TEST_HOOKS === '1'); production code never sets it.
 */
let injectedPutFailure: Error | null = null;

export function injectAssetPutFailureForTests(failure: Error | null): void {
  injectedPutFailure = failure;
}

function putWrapper(bucket: R2Bucket): PutCall {
  return (key, value, opts) => {
    if (injectedPutFailure !== null) {
      const f = injectedPutFailure;
      return Promise.reject(f);
    }
    return bucket.put(key, value, opts);
  };
}

/**
 * Upload one image for a board. Returns 201 { assetKey, contentType } on
 * success; 413 (too large), 404 (board unknown), 415 (not an image by magic
 * bytes) or 500 (storage failure) otherwise.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Size gate: Content-Length first (no body read when clearly over),
  //    then the real byte length.
  const contentLength = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  // 2. The board must exist (rooms never materialize on an asset upload).
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await room.exists();
  if (!exists) {
    return json({ error: 'not_found' }, 404);
  }
  // 3. Sniff the real format from the leading bytes — never the header.
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    return json({ error: 'not_an_image' }, 415);
  }
  // 4. Store under <boardId>/<assetId>; assets are immutable. The asset id
  //    is a random 22-char base64url id (same scheme as board ids), so every
  //    key matches ASSET_KEY_PATTERN (<22>/<22>).
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await putWrapper(env.ASSETS_BUCKET)(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      httpMetadata: { contentType },
    });
  } catch {
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey: key, contentType }, 201);
}

/**
 * Serve one stored image. The key is validated against ASSET_KEY_PATTERN
 * first, so '/../…' style paths are 404s, not traversals.
 */
export async function handleServe(env: Env, boardId: string, assetId: string): Promise<Response> {
  const key = assetKeyFor(boardId, assetId);
  if (!ASSET_KEY_PATTERN.test(key)) {
    return json({ error: 'not_found' }, 404);
  }
  const obj = await env.ASSETS_BUCKET.get(key);
  if (obj === null) {
    return json({ error: 'not_found' }, 404);
  }
  // Prefer the stored (sniffed) content type; fall back to sniffing the head.
  const stored = (obj.httpMetadata?.contentType as AcceptedImageType | undefined) ?? null;
  const body = new Uint8Array(await obj.arrayBuffer());
  const contentType = stored !== null && stored.length > 0 ? stored : (sniffImageType(body) ?? 'application/octet-stream');
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      // Images never change: cache for a year, immutably.
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      // The image is the only content here: no scripts, no other sources.
      'content-security-policy': "default-src 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}
