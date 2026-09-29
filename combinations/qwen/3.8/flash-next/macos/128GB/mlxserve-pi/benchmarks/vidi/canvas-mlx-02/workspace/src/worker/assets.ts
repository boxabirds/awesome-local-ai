// The asset upload and serving handlers (story 12, design `assets.api`).
//
// These are the two HTTP faces of "an image lives outside the Y.Doc, in R2, behind
// an unguessable key":
//
//   POST /api/boards/:boardId/assets   store one file, get back its key
//   GET  /api/assets/:boardId/:assetId serve one stored file, immutably cached
//
// The order of checks in the upload is the design's, and every refusal happens
// BEFORE anything is written, so a rejected upload leaves nothing in storage:
//   id pattern -> rate limit -> board exists() -> Content-Length -> read body ->
//   byte length -> magic-byte sniff -> put. The type is decided from the file's
// CONTENT only, never from the `Content-Type` a client sent (a PDF renamed
// `.png` is a PDF to the sniffer and gets 415).
//
// The serving handler adds the two headers that make a stored file safe to hand to
// a browser - `X-Content-Type-Options: nosniff` and
// `Content-Security-Policy: default-src 'none'` - so an image can never execute as
// a document, and `Cache-Control: ... immutable` because a key is written once and
// never changes.

import { newBoardId } from '../shared/board-id.ts';
import { isValidBoardId } from '../shared/board-id.ts';
import { sniffImageType, assetKeyFor, ASSET_KEY_PATTERN } from '../shared/image-format.ts';
import {
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../shared/config.ts';

/** The room RPC the upload needs: only "does this board exist?". */
interface RoomStub {
  exists(): Promise<boolean>;
}
interface RoomNamespace {
  idFromName(id: string): unknown;
  get(id: unknown): RoomStub;
}
/** The slice of the environment these handlers use; the worker `Env` is a superset. */
export interface AssetsEnv {
  ASSETS_BUCKET: R2Bucket;
  ASSET_UPLOAD_LIMITER: RateLimit;
  BOARD_ROOM: RoomNamespace;
}

function status(status: number, message: string): Response {
  return new Response(message, { status });
}

/**
 * Who an upload is charged to: the connecting IP, so one visitor cannot fill the
 * bucket (design `image.rate_limit`). No IP is charged to one shared bucket - the
 * strictest reading, never the loosest.
 */
function visitorKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown-visitor';
}

/**
 * Handle `POST /api/boards/:boardId/assets`: store the raw body as an image and
 * return `201 { assetKey, contentType }`.
 *
 * Refusals, all with NOTHING written: `404` unknown/malformed board, `429` over the
 * per-visitor rate limit, `413` over IMAGE_MAX_BYTES (checked on Content-Length
 * first so a huge body is refused before it is buffered, then on the real byte
 * length), `415` a sniffed type that is not an accepted image, `500` an R2 failure.
 */
export async function handleUpload(
  request: Request,
  env: AssetsEnv,
  boardId: string,
): Promise<Response> {
  // 1. A malformed code is nobody's board and never reaches the namespace, exactly
  //    as the story 5 existence route already promises.
  if (!isValidBoardId(boardId)) return status(404, 'not_found');

  // 2. Rate limit BEFORE any work, so a limited request costs the service nothing.
  const limit = await env.ASSET_UPLOAD_LIMITER.limit({ key: visitorKey(request) });
  if (!limit.success) return status(429, 'rate_limited');

  // 3. The board must exist - its own room is the authority (design `image.upload_failure`).
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  const exists = await stub.exists();
  if (!exists) return status(404, 'not_found');

  // 4. Refuse an over-limit body on its declared length before buffering it.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return status(413, 'too_large');

  // 5. Read the body fully (it is at most 10 MB), then 6. check the REAL length -
  //    a request can lie about Content-Length, so the byte count is the fact.
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return status(400, 'bad_request');
  }
  if (body.byteLength > IMAGE_MAX_BYTES) return status(413, 'too_large');

  // 7. Decide the type from CONTENT alone. `null` - an SVG, a disguised PDF, three
  //    random bytes - is a 415, and nothing is written for it.
  const bytes = new Uint8Array(body);
  const sniffed = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (sniffed === null) return status(415, 'unsupported_type');

  // 8. Store it under an unguessable key with the SNIFFED type as its metadata, so
  //    a later GET serves exactly what the bytes really are.
  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType: sniffed },
    });
  } catch (err) {
    // A storage failure is the service's to own, not the file's to blame for.
    console.error(`[assets] R2 put failed: ${err instanceof Error ? err.message : String(err)}`);
    return status(500, 'storage_error');
  }

  return Response.json({ assetKey: key, contentType: sniffed }, { status: 201 });
}

/**
 * Handle `GET /api/assets/:boardId/:assetId`: return the stored bytes with the
 * headers that make them safe and cacheable, or `404` for a key that is malformed
 * (fails ASSET_KEY_PATTERN - a `../` probe, a missing half) or names nothing in R2.
 *
 * A miss answers exactly like a malformed key, so probing cannot learn what a real
 * stored image looks like - and the client turns either into "Image unavailable".
 */
export async function handleServe(env: AssetsEnv, key: string, request: Request): Promise<Response> {
  // The key is checked against the pattern BEFORE storage is touched, so a probe
  // never reads R2 and a traversal is a 404 like any other unknown key.
  if (!ASSET_KEY_PATTERN.test(key)) return status(404, 'not_found');

  let object: R2ObjectBody | null;
  try {
    object = await env.ASSETS_BUCKET.get(key);
  } catch (err) {
    console.error(`[assets] R2 get failed: ${err instanceof Error ? err.message : String(err)}`);
    return status(404, 'not_found');
  }
  if (!object) return status(404, 'not_found');

  // The content type is whatever was stored (the sniffed type), never a guess; a
  // body with no recorded type is handed back as bytes rather than mislabelled.
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const etag = etagOf(object);
  const base = {
    'Content-Type': contentType,
    'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Accept-Ranges': 'bytes',
  } as Record<string, string>;

  // Read the whole object once (at most 10 MB) so a byte range is a plain slice.
  const bytes = await readBody(object.body);
  const total = bytes.byteLength;

  // A conditional request whose ETag still matches answers 304 with no body at all.
  // `immutable` already tells a well-behaved cache not to revalidate, so this is the
  // courtesy for a client that does, not the main path (image.serve).
  const inm = request.headers.get('if-none-match');
  if (inm !== null && etag !== null && (inm === etag || inm === `"${etag}"`)) {
    return new Response(null, { status: 304, headers: { ETag: quote(etag) } });
  }

  const range = parseRange(request.headers.get('range'));
  if (range !== null) {
    const span = clampRange(range, total);
    // An If-Range that does not match the object's ETag means the bytes moved since
    // the client last saw them, so the stored bytes may differ - serve the WHOLE
    // object with 200 instead of splicing a range into a body that is now different.
    const ifRange = request.headers.get('if-range');
    if (ifRange !== null && (etag === null || !(ifRange === etag || ifRange === `"${etag}"`))) {
      return new Response(bytes, { status: 200, headers: { ...base, 'Content-Length': String(total), ...(etag ? { ETag: quote(etag) } : {}) } });
    }
    if (span === null) {
      // A range over the end of the object is unsatisfiable, not a truncation.
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    return new Response(bytes.subarray(span.start, span.end + 1), {
      status: 206,
      headers: {
        ...base,
        'Content-Length': String(span.end - span.start + 1),
        'Content-Range': `bytes ${span.start}-${span.end}/${total}`,
        ...(etag ? { ETag: quote(etag) } : {}),
      },
    });
  }

  return new Response(bytes, {
    status: 200,
    headers: { ...base, 'Content-Length': String(total), ...(etag ? { ETag: quote(etag) } : {}) },
  });
}

/** Read a whole R2 body stream into bytes (an object is at most 10 MB). */
async function readBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    size += r.value.byteLength;
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** The object's ETag without its surrounding quotes, or null if it has none. */
function etagOf(object: R2Object): string | null {
  const raw = object.httpEtag;
  if (!raw) return null;
  return raw.replace(/^"|"$/g, '') || null;
}

function quote(etag: string): string {
  return `"${etag}"`;
}

/** A closed byte span, both ends inclusive. */
interface Range {
  start: number;
  end: number;
}

/**
 * Parse a `Range: bytes=a-b` header. Only a single range is honoured (the only kind
 * an `<img>` ever asks for); `bytes=a-` runs to the end and `bytes=-n` is the last n
 * bytes. Anything else - several ranges, a unit that is not bytes, nonsense - is null
 * and the caller serves the whole object.
 */
function parseRange(header: string | null): Range | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startStr = m[1] ?? '';
  const endStr = m[2] ?? '';
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    // A suffix range: the last n bytes; resolved against the size by the caller.
    const n = Number(endStr);
    return Number.isFinite(n) && n >= 0 ? { start: -1, end: n } : null; // start -1 flags a suffix
  }
  const start = Number(startStr);
  const end = endStr === '' ? Infinity : Number(endStr);
  if (!Number.isFinite(start) || start < 0 || start > end) return null;
  return { start, end };
}

/** Resolve a parsed range against the real byte length (null = unsatisfiable). */
function clampRange(range: Range, total: number): Range | null {
  if (range.start === -1) {
    // A suffix range: the last `range.end` bytes.
    const n = range.end;
    if (n === 0 || total === 0) return null;
    const start = Math.max(0, total - n);
    return { start, end: total - 1 };
  }
  if (range.start >= total) return null;
  const end = Number.isFinite(range.end) ? Math.min(range.end, total - 1) : total - 1;
  return { start: range.start, end };
}
