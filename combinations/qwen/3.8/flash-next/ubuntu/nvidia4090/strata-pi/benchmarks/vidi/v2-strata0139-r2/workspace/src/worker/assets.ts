/**
 * `assets.api` — the two routes that store and serve a board's images.
 *
 *   `POST /api/boards/:boardId/assets`
 *     the whole file in the request body; the type is read from the body's
 *     leading bytes and nothing else — not from `Content-Type`, not from a
 *     filename. Under the limit and a recognised signature, it is written to R2
 *     once, under a fresh unguessable key, and the key is the response.
 *
 *   `GET /api/assets/:boardId/:assetId`
 *     the stored bytes with `Cache-Control: … immutable` (a key is never
 *     rewritten), `X-Content-Type-Options: nosniff` and a CSP that lets this
 *     document do nothing but show an image.
 *
 * Order on the upload route, and why: the cheap guards (method, declared
 * `Content-Type`, declared `Content-Length`) run before the body is read, so an
 * oversized or mislabelled upload never allocates a 10 MB buffer; the body's own
 * size is checked again after reading, because `Content-Length` is a claim and
 * not a fact; the key is minted last, so a refused upload never stores anything
 * (TC-14, TC-16).
 *
 * The board existence check is the one thing here that is *not* the Worker's
 * own rule: it is the same read-only Durable Object RPC story 5 uses for
 * `GET /api/boards/:id`, so a link that is not a board 404s before a write
 * (TC-16).
 */

import { newBoardId } from "../shared/board-id";
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from "../shared/config";
import { assetKeyFor, isAssetKey, sniffImageType } from "../shared/image-format";
import type { Env } from "./index";

/** Where an upload goes: the whole file as the request body. */
export const ASSET_UPLOAD_SUFFIX = "/assets";
/** Where a stored asset is served from. */
export const ASSET_SERVE_PREFIX = "/api/assets/";

/** The board a key belongs to, or null when the path segment is not a key. */
export function assetKeyFromPath(segments: string): string | null {
  const key = decodePath(segments);
  return key === null || !isAssetKey(key) ? null : key;
}

/**
 * `POST /api/boards/:boardId/assets`.
 *
 * @param boardId the id from the path, already percent-decoded and shape-checked.
 */
export async function handleUpload(
  request: Request,
  env: Env,
  boardId: string,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  // A declared `Content-Type` is refused before the body is read: the type a
  // client claims is never what this Worker stores (`assets.api`).
  const declaredType = request.headers.get("content-type");
  if (declaredType !== null && !readsAsImageBody(declaredType)) return unsupportedType();

  // `Content-Length` is a claim, so it is only used to refuse an upload early.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return tooLarge();

  const body = await request.arrayBuffer();
  const bytes = new Uint8Array(body);

  // The claim was checked: now the file is measured.
  if (bytes.byteLength > IMAGE_MAX_BYTES) return tooLarge();
  if (bytes.byteLength === 0) return emptyBody();

  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) return unsupportedType();

  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);
  try {
    await env.ASSETS_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
  } catch {
    // A bucket outage is a 500, and nothing was written (TC-15).
    return json({ error: "storage_failed" }, 500);
  }

  return json({ assetKey: key, contentType }, 201);
}

/**
 * `GET /api/assets/:boardId/:assetId`.
 *
 * A key this Worker did not mint is a 404 without a bucket read: the key
 * pattern is what makes an id unguessable, so refusing a malformed one is both
 * the access rule and the shape rule.
 */
export async function handleServe(
  request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET");
  if (!isAssetKey(key)) return notFound();

  let stored: R2Object | null;
  try {
    // `head` for a HEAD request: the metadata only, with no object body opened.
    stored = request.method === "HEAD" ? await env.ASSETS_BUCKET.head(key) : await env.ASSETS_BUCKET.get(key);
  } catch {
    return json({ error: "storage_failed" }, 500);
  }
  if (stored === null) return notFound();

  const contentType = stored.httpMetadata?.contentType ?? "application/octet-stream";
  const headers: HeadersInit = {
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    "X-Content-Type-Options": "nosniff",
    // The bytes of an uploaded file are never a document: this CSP is what
    // keeps a stored image from becoming a page that can fetch or run anything.
    "Content-Security-Policy": "default-src 'none'",
    "Content-Length": String(stored.size),
  };

  return new Response(request.method === "HEAD" ? null : (stored as R2ObjectBody).body, { status: 200, headers });
}

// ---- responses ------------------------------------------------------------

function readsAsImageBody(declaredType: string): boolean {
  // The body is a raw file: `application/octet-stream` (or nothing) is normal.
  // A *specific* declared type is what is refused when it is not an image,
  // because refusing it here is cheaper than reading 10 MB to find out.
  const base = declaredType.split(";")[0].trim().toLowerCase();
  if (base === "" || base === "application/octet-stream") return true;
  return base.startsWith("image/");
}

function decodePath(segments: string): string | null {
  try {
    return decodeURIComponent(segments);
  } catch {
    return null;
  }
}

function notFound(): Response {
  return json({ error: "not_found" }, 404);
}

function unsupportedType(): Response {
  return json({ error: "unsupported_type" }, 415);
}

function tooLarge(): Response {
  return json({ error: "too_large" }, 413);
}

function emptyBody(): Response {
  return json({ error: "empty_body" }, 400);
}

function methodNotAllowed(allowed: string): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: allowed },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
