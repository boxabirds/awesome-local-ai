import { newBoardId, isValidBoardId } from '../shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { AcceptedImageType } from '../shared/image-format';
import type { Env } from './index';

/**
 * Storing and serving board images (story 12).
 *
 * Two routes, and the order of their checks is the whole design:
 *
 * | method + path                    | success                                       | errors                                |
 * |----------------------------------|-----------------------------------------------|---------------------------------------|
 * | `POST /api/boards/:id/assets`    | `201 {"assetKey","contentType"}`              | `404` `413` `415` `500`               |
 * | `GET  /api/assets/:board/:asset` | `200` bytes, immutable, `nosniff`, CSP none    | `404`                                  |
 *
 * A board that does not exist cannot receive an upload (PRD share.unguessable: only
 * boards that exist can receive uploads), so the story 5 `exists()` RPC is asked
 * before a single byte is looked at. What is looked at next is the body's own bytes
 * and nothing else — not its name, not its `Content-Type` — because both of those are
 * written by whoever is uploading (PRD image.types).
 *
 * Nothing is written on any error path: the size limit and the type are settled before
 * `put` is called, so a refused file is never in storage and never needs removing.
 */

/**
 * The body a request may carry: `IMAGE_MAX_BYTES`, no more.
 *
 * The body is read in chunks and counted while it arrives, and the stream is abandoned
 * the moment it has passed the limit — so a request that claims nothing about its size
 * (no `Content-Length`, a chunked body) cannot make the Worker buffer 4 GB of it before
 * saying no. `tooBig` is answered exactly like a `Content-Length` that is too large.
 */
type ReadBody = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'tooBig' };

async function readBody(request: Request, cap: number): Promise<ReadBody> {
  const stream = request.body;
  if (!stream) return { kind: 'bytes', bytes: new Uint8Array(await request.arrayBuffer()) };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    total += chunk.byteLength;
    if (total > cap) {
      // Nothing is kept, and nothing is written: the size is settled from the bytes.
      await reader.cancel();
      return { kind: 'tooBig' };
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { kind: 'bytes', bytes };
}

/** Is the request bigger than it is allowed to be, by its own admission? */
function declaresItselfTooBig(request: Request): boolean {
  const declared = Number(request.headers.get('content-length'));
  // No header at all (or one that is not a number) is not a claim of being too big;
  // the byte count below is the authority either way.
  return Number.isFinite(declared) && declared > IMAGE_MAX_BYTES;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notFound = () => json({ error: 'not_found' }, 404);

/**
 * `POST /api/boards/:boardId/assets` — store one image for one board.
 *
 * The checks happen in the order that costs least: an id that is not a board id and a
 * board nobody created are answered without touching the body; a body that is too
 * large is answered from `Content-Length` before it is read, and in bytes after it
 * is; the type comes from the first `IMAGE_SNIFF_BYTES` of the body; only then does
 * anything reach the bucket. So an oversized or unsupported file is refused without
 * ever being stored, and the reply says which of the two happened (`413`, `415`).
 *
 * @sideeffect exactly one `put` per accepted upload, at a fresh unguessable key.
 */
export async function handleUpload(request: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return notFound();

  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  if (!(await room.exists())) return notFound();

  if (declaresItselfTooBig(request)) return new Response(null, { status: 413 });
  const read = await readBody(request, IMAGE_MAX_BYTES);
  if (read.kind === 'tooBig') return new Response(null, { status: 413 });
  const bytes = read.bytes;

  // The client's `Content-Type` is ignored on purpose: a PDF named `photo.png` arrives
  // claiming to be `image/png`, and the bytes say `%PDF` (PRD image.types).
  const contentType: AcceptedImageType | null = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);

  const key = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    // Storage said no. The board has nothing to show for the attempt, and the client
    // can retry the same file (PRD image.upload_failure).
    return json({ error: 'storage_failed' }, 500);
  }
  return json({ assetKey: key, contentType }, 201);
}

/**
 * `GET /api/assets/:boardId/:assetId` — the stored bytes, as an image.
 *
 * The key has to be exactly `<board id>/<asset id>` before the bucket is asked
 * anything, so `../` and its relatives are a 404 rather than a lookup. A stored file
 * is then served with the type it was sniffed as, `nosniff` and a
 * `Content-Security-Policy: default-src 'none'`, so a file that somehow *was* a
 * document could never execute when fetched (PRD constraints: served images must
 * never be interpreted as anything other than images). Caching is immutable because a
 * key is written once and never points at different bytes.
 *
 * Story 17 (export) reads images through this same route.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object) return notFound();

  const headers = new Headers();
  // Not `writeHttpMetadataHeaders`: only the sniffed type is ever written into the
  // object, so only the sniffed type is ever handed back, and nothing else about the
  // upload (a filename, a disposition) can travel with the bytes.
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('cache-control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'");
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}
