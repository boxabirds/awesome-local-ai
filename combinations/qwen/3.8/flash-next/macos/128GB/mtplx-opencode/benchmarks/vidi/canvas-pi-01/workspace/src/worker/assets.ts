/**
 * Story 12 · the assets API (design "assets.api").
 *
 * Two endpoints, both handled in the Worker before static-asset fallback:
 *
 *  - `POST /api/boards/:id/assets` — upload, multipart form, field name
 *    `images`;
 *  - `GET  /api/assets/:boardId/:assetId` — serve, immutable cache.
 *
 * Design rules honoured here:
 *
 *  - **The stored object's `contentType` is decided by sniffing the first bytes,
 *    never trusted from the request** (PRD image.types). A file whose magic does
 *    not match a supported image is refused `415`, whether it is an SVG with a
 *    script or a PDF renamed `.png`;
 *  - **size is checked before content**, so an oversized file is a `413` and
 *    never reaches the sniff (`image.size_limit`);
 *  - **the whole batch is atomic**: if any file fails, none are stored
 *    (`image.count_limit`);
 *  - **a read is scoped to its own board**: we only ever look up a key of the
 *    form `<path board>/<path asset>`, so a read can never be pointed at another
 *    board's key, and a wrong-length id never touches the bucket (TC-15).
 *
 * No authentication, as everywhere: possession of the URL is the access control.
 * The bucket bindings are typed *structurally* (see {@link BucketLike}) so the
 * whole handler is unit-testable in plain Node with a fake bucket, exactly like
 * `create-board.ts`.
 */
import { isBoardId } from '../shared/board-id';
import { IMAGE_MAX_BYTES, IMAGE_MAX_FILES_PER_ADD } from '../shared/config';
import { ASSET_KEY_PATTERN, sniffImageType } from '../shared/image-format';
import type { AssetResult } from '../shared/assets-protocol';
import type { BucketLike, Env } from './env';

/** The upload field name (single and repeated both use it). */
export const UPLOAD_FIELD = 'images';

/** 1 year, in seconds — the immutable lifetime for a served asset. */
export const ASSET_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** A fresh 22-character, URL-safe asset id. */
function newAssetId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url of 16 bytes = 22 characters, no padding.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonError(reason: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, reason, status }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function boardKey(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

export interface UploadDeps {
  env: Env;
  boardId: string;
  /** The rate-limit key (the visitor's IP), or `''`. */
  key: string;
  now?: () => number;
}

/**
 * Handle `POST /api/boards/:id/assets`. Returns the response to send; the caller
 * in `index.ts` has already confirmed the method and path shape.
 */
export async function handleAssetUpload(
  request: Request,
  deps: UploadDeps,
): Promise<Response> {
  const { env, boardId } = deps;
  // An invalid board id is the same 404 as an unknown board (nothing is leaked
  // about the id space) and, importantly, no file is read or stored for it.
  if (!isBoardId(boardId)) return jsonError('bad_board', 404);
  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) return jsonError('failed', 500);

  // Rate limit before touching the body, so an abusive client cannot make us read
  // 20 files just to throw them away. Absent (a plain build) → not enforced.
  const limiter = env.ASSET_UPLOAD_LIMITER;
  if (limiter !== undefined) {
    const allowed = await limiter.limit({ key: deps.key });
    if (!allowed.success) return jsonError('rate_limited', 429);
  }

  // Multipart body. A request we cannot even parse as form data is a client
  // error, not a storage failure.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('unsupported', 415);
  }
  const entries = form.getAll(UPLOAD_FIELD);
  const files = entries.filter((entry): entry is File => typeof entry === 'object'
    && entry !== null
    && 'arrayBuffer' in entry
    && 'type' in entry);

  if (files.length === 0) return jsonError('unsupported', 415);

  // Count first: over the per-request allowance, the whole batch is refused and
  // nothing is stored (PRD image.count_limit). We do not process a prefix of it.
  if (files.length > IMAGE_MAX_FILES_PER_ADD) {
    return jsonError('too_large', 413);
  }

  // Validate the whole batch before storing any of it (atomic). Size is checked
  // before content, per the PRD.
  const sized: Array<{ file: File; bytes: Uint8Array }> = [];
  for (const file of files) {
    if (file.size > IMAGE_MAX_BYTES) return jsonError('too_large', 413);
    const buffer = await file.arrayBuffer();
    sized.push({ file, bytes: new Uint8Array(buffer) });
  }
  const types: string[] = [];
  for (const item of sized) {
    const mime = sniffImageType(item.bytes);
    if (mime === null) return jsonError('unsupported', 415);
    types.push(mime);
  }

  // Everything passed: store each under its own new id, with the sniffed type and
  // the immutable cache policy. (No dedupe is needed for correctness; re-adding
  // the same bytes twice is only an optimisation we deliberately skip.)
  const keys: string[] = [];
  for (let i = 0; i < sized.length; i++) {
    const assetId = newAssetId();
    const key = boardKey(boardId, assetId);
    await bucket.put(key, sized[i].bytes, {
      httpMetadata: { contentType: types[i] },
      cacheControl: `public, max-age=${ASSET_MAX_AGE_SECONDS}, immutable`,
    });
    keys.push(key);
  }
  // One line per stored key (the design's response shape). The client stores each
  // back on its own placeholder; `assetKey` is kept for the single-file case.
  const body: AssetResult = { ok: true, assetKey: keys[0] };
  return new Response(JSON.stringify({ ...body, keys }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

export interface ReadTarget {
  boardId: string;
  assetId: string;
}

/**
 * Parse a `/api/assets/:boardId/:assetId` path into its two 22-character parts,
 * or `null` for anything else (a wrong length, a missing part, a traversal). The
 * check is on the *whole* joined key through {@link ASSET_KEY_PATTERN}, so a
 * path like `/api/assets/../../etc/passwd` is rejected before the bucket is
 * touched (TC-15, design "A `..` path is refused").
 */
export function parseAssetPath(pathname: string): ReadTarget | null {
  const prefix = '/api/assets/';
  if (!pathname.startsWith(prefix)) return null;
  const key = decodeURIComponent(pathname.slice(prefix.length));
  if (!ASSET_KEY_PATTERN.test(key)) return null;
  const [boardId, assetId] = key.split('/');
  if (!isBoardId(boardId)) return null;
  return { boardId, assetId };
}

/**
 * Handle `GET /api/assets/:boardId/:assetId`. A miss or a malformed key answers
 * 404 with no distinction (nothing is leaked about which assets exist), and no
 * bucket read is issued for a malformed key.
 */
export async function handleAssetRead(
  deps: UploadDeps & { target: ReadTarget },
): Promise<Response> {
  const { env, target } = deps;
  const bucket = env.ASSETS_BUCKET;
  if (bucket === undefined) return jsonError('failed', 500);
  const key = boardKey(target.boardId, target.assetId);
  const object = await bucket.get(key);
  if (object === null) return jsonError('failed', 404);

  // Worker keeps the type under `httpMetadata`; the `contentType` shorthand is not
  // populated on a fetched object. Read the real field, fall back to octet-stream.
  const storedType =
    object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers = new Headers();
  headers.set('content-type', storedType);
  headers.set('cache-control', `public, max-age=${ASSET_MAX_AGE_SECONDS}, immutable`);
  // Sniffing was done at write time; on the way back we still forbid the browser
  // from re-sniffing a stored body into a different type (design "Security").
  headers.set('x-content-type-options', 'nosniff');
  if (object.httpEtag) headers.set('etag', object.httpEtag);

  return new Response(object.body as BodyInit, { status: 200, headers });
}