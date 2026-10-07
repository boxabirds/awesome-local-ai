/**
 * Story 12 — `assets.api` (TC-10 … TC-16).
 *
 * These run inside workerd against the real Worker fetch handler and a real R2
 * bucket: what is asserted is what the bucket holds, not only what the response
 * says. The byte fixtures are the ones in `tests/fixtures/image-bytes.ts`,
 * because workerd has no filesystem to read `tests/fixtures/images/` from.
 *
 * Every response is read to the end before the test moves on (`read`): an
 * unread body is an unfinished stream, and the pool tears Durable Objects down
 * between tests — including the ones an R2 bucket is made of locally.
 *
 * Run: `npm run test:integration -- assets`
 */

import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { IMAGE_MAX_BYTES } from "../../src/shared/config";
import { ASSET_KEY_PATTERN, assetKeyFor } from "../../src/shared/image-format";
import { handleUpload } from "../../src/worker/assets";
import type { Env } from "../../src/worker/index";
import { gifBytes, jpegBytes, pdfBytes, pngBytes, svgBytes, webpBytes, ascii } from "../fixtures/image-bytes";
import { createTestBoard, fetchFromWorker, testBoardId } from "./helpers/ws-client";

const ORIGIN = "http://board.test";

interface Read {
  status: number;
  headers: Headers;
  body: Uint8Array;
  json: Record<string, unknown>;
}

async function read(response: Response | Promise<Response>): Promise<Read> {
  const result = await response;
  const body = new Uint8Array(await result.arrayBuffer());
  const text = new TextDecoder().decode(body);
  const isJson = (result.headers.get("Content-Type") ?? "").includes("application/json");
  return {
    status: result.status,
    headers: result.headers,
    body,
    json: isJson && text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

function uploadRequest(boardId: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/boards/${boardId}/assets`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/octet-stream", ...headers },
  });
}

function upload(boardId: string, body: BodyInit, headers?: Record<string, string>): Promise<Read> {
  return read(fetchFromWorker(uploadRequest(boardId, body, headers)));
}

function serve(key: string, init: RequestInit = {}): Promise<Read> {
  return read(fetchFromWorker(new Request(`${ORIGIN}/api/assets/${key}`, init)));
}

/** A real JPEG padded past its end marker to an exact byte count. */
function paddedImage(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  out.set(jpegBytes(), 0);
  return out;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  // A copy, so the fixture's own buffer is never detached by a fetch.
  return bytes.slice().buffer as ArrayBuffer;
}

/** What the bucket holds for a board: keys and their bytes. */
async function storedAssets(boardId: string): Promise<Array<{ key: string; bytes: Uint8Array }>> {
  const listed = await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` });
  const out: Array<{ key: string; bytes: Uint8Array }> = [];
  for (const object of listed.objects) {
    const stored = await env.ASSETS_BUCKET.get(object.key);
    out.push({ key: object.key, bytes: stored ? new Uint8Array(await stored.arrayBuffer()) : new Uint8Array(0) });
  }
  return out;
}

describe("asset upload (TC-10, TC-12, TC-14, TC-15)", () => {
  it("stores a real PNG and answers with the key it was stored under", async () => {
    const boardId = await createTestBoard();
    const png = pngBytes(8, 6);

    const response = await upload(boardId, bufferOf(png), { "Content-Type": "image/png" });
    expect(response.status).toBe(201);
    expect(typeof response.json.assetKey).toBe("string");
    expect(ASSET_KEY_PATTERN.test(String(response.json.assetKey))).toBe(true);
    expect(String(response.json.assetKey).startsWith(`${boardId}/`)).toBe(true);
    expect(response.json.contentType).toBe("image/png");

    // The bucket holds the file, once, under that key.
    const stored = await storedAssets(boardId);
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe(response.json.assetKey);
    expect(Array.from(stored[0].bytes)).toEqual(Array.from(png));
  });

  it("stores each of the four formats as the type its bytes are", async () => {
    const boardId = await createTestBoard();
    const cases: Array<[Uint8Array, string]> = [
      [pngBytes(4, 4), "image/png"],
      [jpegBytes(), "image/jpeg"],
      [gifBytes(), "image/gif"],
      [webpBytes(), "image/webp"],
    ];

    for (const [bytes, expected] of cases) {
      const response = await upload(boardId, bufferOf(bytes));
      expect(response.status).toBe(201);
      expect(response.json.contentType).toBe(expected);
    }
  });

  it("refuses an SVG and a PDF-named-.png with 415, and stores nothing", async () => {
    const boardId = await createTestBoard();

    const svg = await upload(boardId, bufferOf(svgBytes()), { "Content-Type": "image/svg+xml" });
    expect(svg.status).toBe(415);
    expect(svg.json.error).toBe("unsupported_type");

    // PDF bytes wearing a .png name: the server never looks at the name.
    const sneaky = await upload(boardId, bufferOf(pdfBytes()), { "Content-Type": "image/png" });
    expect(sneaky.status).toBe(415);

    // A declared Content-Type that is not an image is refused before the body is read.
    const text = await upload(boardId, bufferOf(ascii("hello")), { "Content-Type": "text/plain" });
    expect(text.status).toBe(415);

    expect(await storedAssets(boardId)).toHaveLength(0);
  });

  it("refuses a body over 10 MB with 413, at the byte exactly", async () => {
    const boardId = await createTestBoard();

    const exact = await upload(boardId, paddedImage(IMAGE_MAX_BYTES).buffer as ArrayBuffer);
    expect(exact.status).toBe(201);

    const over = await upload(boardId, paddedImage(IMAGE_MAX_BYTES + 1).buffer as ArrayBuffer);
    expect(over.status).toBe(413);
    expect(over.json.error).toBe("too_large");

    // Only the accepted one is in the bucket.
    const stored = await storedAssets(boardId);
    expect(stored).toHaveLength(1);
    expect(stored[0].bytes.byteLength).toBe(IMAGE_MAX_BYTES);
  });

  it("accepts a valid JPEG of exactly 10 MB", async () => {
    const boardId = await createTestBoard();
    const response = await upload(boardId, paddedImage(IMAGE_MAX_BYTES).buffer as ArrayBuffer);
    expect(response.status).toBe(201);
    expect(response.json.contentType).toBe("image/jpeg");
  });

  it("refuses a 10 MB body that is not an image at all", async () => {
    const boardId = await createTestBoard();
    const response = await upload(boardId, new Uint8Array(IMAGE_MAX_BYTES).buffer as ArrayBuffer);
    expect(response.status).toBe(415);
    expect(await storedAssets(boardId)).toHaveLength(0);
  });

  it("refuses an empty body with 400", async () => {
    const boardId = await createTestBoard();
    const response = await upload(boardId, new Uint8Array(0).buffer as ArrayBuffer);
    expect(response.status).toBe(400);
    expect(response.json.error).toBe("empty_body");
    expect(await storedAssets(boardId)).toHaveLength(0);
  });

  it("answers 500 when the bucket itself fails, and leaves nothing written", async () => {
    const boardId = await createTestBoard();
    const brokenBucket = {
      put: async () => {
        throw new Error("r2 unavailable");
      },
      get: async () => null,
      head: async () => null,
      list: async () => ({ objects: [], truncated: false }),
    } as unknown as R2Bucket;

    const before = await storedAssets(boardId);
    // A broken bucket handed to the same handler is how the Worker sees an R2
    // outage: a 500, and nothing half-written.
    const brokenEnv = { ...env, ASSETS_BUCKET: brokenBucket } as Env;
    const response = await read(
      handleUpload(uploadRequest(boardId, bufferOf(pngBytes(4, 4))), brokenEnv, boardId),
    );
    expect(response.status).toBe(500);
    expect(response.json.error).toBe("storage_failed");

    expect(await storedAssets(boardId)).toHaveLength(before.length);
  });
});

describe("asset upload route (TC-16)", () => {
  it("405s a GET on the upload route", async () => {
    const boardId = await createTestBoard();
    const response = await read(
      fetchFromWorker(new Request(`${ORIGIN}/api/boards/${boardId}/assets`, { method: "GET" })),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("404s an upload to a board that is not a board, and writes nothing", async () => {
    const ghost = testBoardId();

    const response = await upload(ghost, bufferOf(pngBytes(4, 4)));
    expect(response.status).toBe(404);
    expect(await storedAssets(ghost)).toHaveLength(0);

    const malformed = await read(
      fetchFromWorker(
        new Request(`${ORIGIN}/api/boards/not-an-id/assets`, {
          method: "POST",
          body: bufferOf(pngBytes(4, 4)),
        }),
      ),
    );
    expect(malformed.status).toBe(404);
  });
});

describe("asset serving (TC-11, TC-13)", () => {
  it("serves the stored bytes with immutable caching, nosniff and a CSP", async () => {
    const boardId = await createTestBoard();
    const png = pngBytes(6, 6);
    const uploadResponse = await upload(boardId, bufferOf(png), { "Content-Type": "image/png" });
    const key = String(uploadResponse.json.assetKey);

    const response = await serve(key);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("Cache-Control")).toContain("max-age=");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(Number(response.headers.get("Content-Length"))).toBe(png.byteLength);
    expect(Array.from(response.body)).toEqual(Array.from(png));
  });

  it("answers HEAD with the headers and no body", async () => {
    const boardId = await createTestBoard();
    const png = pngBytes(4, 4);
    const uploadResponse = await upload(boardId, bufferOf(png));
    const key = String(uploadResponse.json.assetKey);

    const response = await serve(key, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.body).toHaveLength(0);
  });

  it("serves a GIF and a WebP with their own content types", async () => {
    const boardId = await createTestBoard();
    const gif = await upload(boardId, bufferOf(gifBytes()));
    const webp = await upload(boardId, bufferOf(webpBytes()));

    const servedGif = await serve(String(gif.json.assetKey));
    const servedWebp = await serve(String(webp.json.assetKey));
    expect(servedGif.headers.get("Content-Type")).toBe("image/gif");
    expect(servedWebp.headers.get("Content-Type")).toBe("image/webp");
  });

  it("keeps one board's asset inside that board's prefix", async () => {
    const boardA = await createTestBoard();
    const boardB = await createTestBoard();

    const uploadResponse = await upload(boardA, bufferOf(pngBytes(4, 4)));
    const key = String(uploadResponse.json.assetKey);
    const assetId = key.split("/")[1];

    expect((await serve(key)).status).toBe(200);
    // The same asset id under another board's prefix is not that board's asset.
    expect((await serve(assetKeyFor(boardB, assetId))).status).toBe(404);
    expect((await serve(assetKeyFor(testBoardId(), assetId))).status).toBe(404);
  });

  it("404s a key that is not a key, without reading the bucket", async () => {
    for (const path of [
      "not-a-key",
      "a/b",
      "Zm9vYmFyYmF6aW5nZHVwZGE/Zm9vYmFyYmF6aW5nZHVwZGE",
      "Zm9vYmFyYmF6aW5nZHVwZA/Zm9vYmFyYmF6aW5nZHVwZGE/",
      "Zm9vYmFyYmF6aW5nZHVwZA/Zm9vYmFyYmF6aW5nZHVwZGE/../x",
      "Zm9vYmFyYmF6aW5nZHVwZA",
      "",
    ]) {
      const response = await serve(path);
      expect(response.status).toBe(404);
    }
  });

  it("never lets a `..` path read the bucket behind the prefix", async () => {
    const boardId = await createTestBoard();
    const png = pngBytes(4, 4);
    const uploadResponse = await upload(boardId, bufferOf(png));
    const key = String(uploadResponse.json.assetKey);
    const assetId = key.split("/")[1];

    // `fetch` normalises the path before the Worker sees it, so a `..` that
    // escapes `/api/assets/` is no longer an asset request at all: whatever
    // answers, it is not a stored image.
    for (const path of [`${boardId}/../${assetId}`, `../${boardId}/${assetId}`, `${boardId}/../../api/boards`]) {
      const response = await serve(path);
      expect(response.headers.get("Content-Type") ?? "").not.toMatch(/^image\//);
    }

    // A `..` that lands back on a real key serves that key's own asset and
    // nothing wider: the key is the whole access rule, and normalising it can
    // only name the same board and the same asset.
    const roundTrip = await serve(`${boardId}/${assetId}/../${assetId}`);
    expect(roundTrip.status).toBe(200);
    expect(Array.from(roundTrip.body)).toEqual(Array.from(png));

    // It cannot be stretched to another board's prefix.
    const otherBoard = await createTestBoard();
    expect((await serve(`${boardId}/${assetId}/../${otherBoard}/${assetId}`)).status).toBe(404);
  });
});
