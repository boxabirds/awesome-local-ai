// Asset upload and serving (story 12, assets.api contract):
//
//   POST /api/boards/:boardId/assets  → 201 {"assetKey","contentType"}
//   GET  /api/assets/:boardId/:assetId → 200 immutable bytes
//
// Order of checks on upload: id pattern → exists() RPC → Content-Length
// over limit → read body → byte length over limit → sniff → put. Nothing is
// written on any error. The type is decided from the first IMAGE_SNIFF_BYTES
// of the body (magic bytes) — never from a file name or Content-Type — so a
// renamed PDF or an SVG is refused with 415 and never stored or served.

import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { isValidBoardId } from '../shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const notFound = (): Response => json(404, { error: 'not_found' });

/**
 * Store one image for an existing board. Returns 201 with the permanent,
 * unguessable asset key; 404 unknown/malformed board; 413 over
 * IMAGE_MAX_BYTES; 415 unsupported sniffed type; 500 storage failure.
 */
export async function handleUpload(
  req: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  // Malformed ids are indistinguishable from unknown ones (nothing leaked).
  if (!isValidBoardId(boardId)) return notFound();

  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  if (!(await stub.exists())) return notFound();

  // Size check: Content-Length first (cheap), actual byte length second.
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }
  // Bodies are read fully into memory (≤ 10 MB) so sniffing happens before
  // anything is written.
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return json(413, { error: 'too_large' });

  const contentType = sniffImageType(body.slice(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return json(415, { error: 'unsupported_type' });

  const assetId = newBoardId();
  const assetKey = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return json(500, { error: 'storage' });
  }
  return json(201, { assetKey, contentType });
}

/**
 * Serve a stored asset immutably (keys never change) with nosniff and a CSP
 * that forbids the bytes from ever executing as a document. 404 for a
 * malformed key or a missing object.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) return notFound();
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
