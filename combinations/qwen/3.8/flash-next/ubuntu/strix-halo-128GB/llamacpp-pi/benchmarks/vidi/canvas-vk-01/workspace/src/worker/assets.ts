import {
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../shared/config';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  newAssetId,
  sniffImageType,
} from '../shared/image-format';
import { isValidBoardId } from '../shared/board-id';
import type { Limiter } from './create-board';
import type { Env } from './env';

/**
 * The asset API (story 12): store an uploaded image, then serve it back.
 *
 * Storage is Cloudflare R2, and R2 is written *after* the bytes are known to be
 * an accepted image: the leading bytes are sniffed with the shared rules, so a
 * file named `.png` that is really a PDF never becomes a stored object. Nothing
 * here decodes an image — the signature is the whole decision — and the key is
 * built from an id the client cannot choose, so an upload cannot name where it
 * lands.
 *
 * Upload is unauthenticated, as everything on the board is: the capability is the
 * board id, and what stands in for authentication is the size cap, the sniff, and
 * a per-visitor rate limit. Errors are machine-readable codes; the wording the
 * user sees is the client's, so it can differ between a toast and a caption
 * without a Worker deploy.
 */

/** One year, and the content never changes: keys are minted, not edited. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Why an upload was refused, as the JSON `error` code. */
export type UploadErrorCode =
  | 'board_not_found'
  | 'unsupported_image_type'
  | 'too_large'
  | 'rate_limited'
  | 'storage';

const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const refuse = (code: UploadErrorCode, status: number, headers: Record<string, string> = {}): Response =>
  json({ error: code }, status, headers);

/** A limiter that has never seen a request before, for a runtime with no binding. */
const UNLIMITED: Limiter = { limit: async () => ({ success: true }) };

/** The per-visitor key the rate limit counts against. */
const visitorKey = (request: Request): string => request.headers.get('CF-Connecting-IP') ?? 'unknown';

/**
 * Store one image for a board (`image.types`, `image.size_limit`,
 * `image.rate_limit`).
 *
 * The order is the order of what each step costs: reject a malformed board id and
 * an over-quota visitor without touching storage; ask the board whether it exists
 * before writing a key nothing can ever read; refuse an oversized body — the
 * declared `Content-Length` first, so a huge upload is refused without reading it
 * — and only then look at the bytes.
 *
 * A successful reply is `{"ok":true,"assetId":"..."}`: the client assembles the
 * key from its own board id and this id, and that pair is what its object stores.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  // The board id is half of the storage key, so it has to be a board id.
  if (!isValidBoardId(boardId)) {
    return refuse('board_not_found', 404);
  }

  const limiter = env.ASSET_UPLOAD_LIMITER ?? UNLIMITED;
  const allowed = await limiter.limit({ key: visitorKey(request) });
  if (!allowed.success) {
    // The window is a period, not a moment, so say how long to wait for.
    return refuse('rate_limited', 429, {
      'Retry-After': String(IMAGE_UPLOAD_PERIOD_SECONDS),
      'X-RateLimit-Limit': String(IMAGE_UPLOAD_LIMIT),
      'X-RateLimit-Window': String(IMAGE_UPLOAD_PERIOD_SECONDS),
    });
  }

  // A key is only readable through the board that owns it; without this check an
  // upload for a made-up board would store bytes no page can ever address.
  const board = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  if (!(await board.exists())) {
    return refuse('board_not_found', 404);
  }

  const declared = Number(request.headers.get('Content-Length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return refuse('too_large', 413);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return refuse('too_large', 413);
  }

  // The type is whatever the content says it is (`image.types`); the request's
  // own `Content-Type` is never read, because a name is not evidence.
  const contentType = sniffImageType(body);
  if (contentType === null) {
    return refuse('unsupported_image_type', 415);
  }

  const assetKey = assetKeyFor(boardId, newAssetId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, { httpMetadata: { contentType } });
  } catch {
    // Storage refused it. The client keeps its placeholder and offers Retry, so
    // this is a failed service call rather than a bad file (`image.upload_failure`).
    return refuse('storage', 500);
  }

  // The key comes back whole: the client stores it on its object and never has to
  // guess how a board id and an asset id are joined.
  return json({ assetKey, contentType }, 201);
}

/**
 * Serve a stored image (`image.serve`). The key is matched against
 * `<boardId>/<assetId>` before the bucket is touched, so `..` and anything else
 * shaped like a path never reaches it.
 *
 * An image is immutable — a key is written once and never rewritten — so the
 * answer is that it may be cached for a year and need never be revalidated. The
 * type comes from the stored metadata, never from the request, and the body is
 * served as the bytes they are: not a script, not a document, not readable.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return refuse('board_not_found', 404);
  }
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) {
    return refuse('board_not_found', 404);
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': ASSET_CACHE_CONTROL,
      // Nothing may decide this is other than the type it is served as.
      'X-Content-Type-Options': 'nosniff',
      // The body is image bytes and nothing else: no scripts, no framing, and no
      // document that could read it back out of this URL.
      'Content-Security-Policy': "default-src 'none'",
      ...(object.etag !== undefined ? { ETag: object.etag } : {}),
    },
  });
}
