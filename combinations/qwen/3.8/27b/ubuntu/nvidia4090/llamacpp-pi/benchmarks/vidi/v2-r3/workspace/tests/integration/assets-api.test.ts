/**
 * Story 12 integration tests for the assets API (TC-10 to TC-13, TC-15,
 * TC-16), against the real wrangler dev worker: real R2 bucket, real Durable
 * Objects. R2 state is inspected through the /__test/assets hook routes.
 */
import { Socket } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN, sniffImageType } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import { BASE } from './ws-client';
import { b64, createBoard, unb64 } from './hooks';
import {
  corruptPng,
  gifBytes,
  jpegBytes,
  pdfBytes,
  sizedBytes,
  solidPng,
  svgWithScript,
  webpBytes,
} from '../fixtures/images';

async function postAsset(boardId: string, body: Uint8Array, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers['content-type'] = contentType;
  return fetch(`${BASE}/api/boards/${boardId}/assets`, { method: 'POST', body, headers });
}

async function r2List(boardId: string): Promise<string[]> {
  const res = await fetch(`${BASE}/__test/assets/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId }),
  });
  if (!res.ok) throw new Error(`__test/assets/list -> ${res.status}`);
  return ((await res.json()) as { keys: string[] }).keys;
}

async function r2Get(key: string): Promise<{ missing: boolean; size?: number; contentType?: string | null; bytes?: Uint8Array }> {
  const res = await fetch(`${BASE}/__test/assets/get`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`__test/assets/get -> ${res.status}`);
  const body = (await res.json()) as { missing: boolean; size?: number; contentType?: string | null; bytes?: string };
  return body.missing
    ? { missing: true }
    : { missing: false, size: body.size, contentType: body.contentType, bytes: unb64(body.bytes as string) };
}

async function setAssetsFault(mode: 'throw' | 'clear'): Promise<void> {
  const res = await fetch(`${BASE}/__test/faults/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`__test/faults/assets -> ${res.status}`);
}

describe('assets API (story 12)', () => {
  let png: Uint8Array;

  beforeAll(() => {
    png = solidPng(48, 32, [10, 120, 220]);
  });

  it('TC-10: stores a PNG under <boardId>/<assetId> with the sniffed content type', async () => {
    const board = await createBoard();
    const res = await postAsset(board, png); // no content-type header at all
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${board}/`)).toBe(true);
    expect(body.contentType).toBe('image/png');

    const [stored] = await r2List(board);
    expect(stored).toBe(body.assetKey);
    const obj = await r2Get(body.assetKey);
    expect(obj.missing).toBe(false);
    expect(obj.size).toBe(png.length);
    expect(obj.contentType).toBe('image/png');
    expect(b64(obj.bytes as Uint8Array)).toBe(b64(png));
  });

  it('TC-10b: every accepted format is stored with its sniffed type', async () => {
    const board = await createBoard();
    const cases: Array<[Uint8Array, string]> = [
      [png, 'image/png'],
      [jpegBytes(4096), 'image/jpeg'],
      [gifBytes(4096), 'image/gif'],
      [gifBytes(4096, '87a'), 'image/gif'],
      [webpBytes(4096), 'image/webp'],
    ];
    for (const [bytes, type] of cases) {
      const res = await postAsset(board, bytes);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { contentType: string };
      expect(body.contentType).toBe(type);
    }
    expect(await r2List(board)).toHaveLength(5);
  });

  it('TC-11: uploads for a never-created or malformed board are 404 and store nothing', async () => {
    // A syntactically valid id that was never created:
    const ghost = newBoardId();
    const res = await postAsset(ghost, png);
    expect(res.status).toBe(404);
    expect(await r2List(ghost)).toEqual([]);
    // A malformed id:
    const res2 = await postAsset('nope', png);
    expect(res2.status).toBe(404);
  });

  it('TC-12: 10 MB + 1 byte is 413 (nothing stored); exactly 10 MB is accepted', async () => {
    const board = await createBoard();
    const over = await postAsset(board, sizedBytes(IMAGE_MAX_BYTES + 1, jpegBytes(12)));
    expect(over.status).toBe(413);
    expect(await r2List(board)).toEqual([]);

    const at = await postAsset(board, sizedBytes(IMAGE_MAX_BYTES, jpegBytes(12)));
    expect(at.status).toBe(201);
    const body = (await at.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    const obj = await r2Get(body.assetKey);
    expect(obj.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-13: a PDF or SVG with an image Content-Type is 415 (magic bytes decide)', async () => {
    const board = await createBoard();
    const pdf = await postAsset(board, pdfBytes, 'image/png');
    expect(pdf.status).toBe(415);
    const svg = await postAsset(board, svgWithScript, 'image/svg+xml');
    expect(svg.status).toBe(415);
    // A truncated PNG is not a PNG by header either… (the header bytes of a
    // truncated PNG are still a PNG header; the corrupt fixture is exercised
    // client-side. Here: arbitrary binary with an image header is 415.)
    const junk = await postAsset(board, new Uint8Array(64).fill(7), 'image/png');
    expect(junk.status).toBe(415);
    expect(await r2List(board)).toEqual([]);
    // Sanity: the sniffer agrees with the fixture intent.
    expect(sniffImageType(pdfBytes)).toBeNull();
    expect(sniffImageType(svgWithScript)).toBeNull();
    expect(sniffImageType(corruptPng().slice(0, 12))).toBe('image/png');
  });

  it('TC-15: an injected R2 put failure surfaces as 500 and stores nothing', async () => {
    const board = await createBoard();
    await setAssetsFault('throw');
    try {
      const res = await postAsset(board, png);
      expect(res.status).toBe(500);
      expect(await r2List(board)).toEqual([]);
    } finally {
      await setAssetsFault('clear');
    }
    // After the fault is cleared the same upload succeeds.
    const ok = await postAsset(board, png);
    expect(ok.status).toBe(201);
  });

  it('TC-16: GET serves the stored bytes with immutable caching headers', async () => {
    const board = await createBoard();
    const up = await postAsset(board, png);
    const key = ((await up.json()) as { assetKey: string }).assetKey;
    const res = await fetch(`${BASE}/api/assets/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(b64(bytes)).toBe(b64(png));
  });

  it('TC-16b: unknown, malformed and traversal keys are 404; non-GET is 405', async () => {
    // A well-formed key that was never stored:
    const missing = await fetch(`${BASE}/api/assets/${newBoardId()}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    // Malformed (too short) ids:
    const short = await fetch(`${BASE}/api/assets/abc/def`);
    expect(short.status).toBe(404);
    // Extra segments:
    const extra = await fetch(`${BASE}/api/assets/${newBoardId()}/${newBoardId()}/x`);
    expect(extra.status).toBe(404);
    // Traversal: sent raw (spec-compliant clients normalize '../' before
    // sending). The platform (workerd) normalizes dot segments before the
    // fetch handler, so the wire-level property is that a traversal request
    // never resolves to asset bytes — the handler's own guard (404 on the
    // literal path) is proven in tests/unit/assets-handler.test.ts.
    for (const path of ['/api/assets/../x', '/api/assets/%2E%2E/x']) {
      const raw = await rawGet(path);
      expect(raw).not.toMatch(/content-type:\s*image\//i);
      expect(raw).not.toContain('immutable');
    }
    // Non-GET on the assets route:
    const post = await fetch(`${BASE}/api/assets/`, { method: 'POST', body: new Uint8Array(0) });
    expect(post.status).toBe(405);
  });
});

/** A raw HTTP GET with an un-normalized request path (node fetch would
 * normalize dot segments in the URL before sending). Resolves with the
 * status line + headers as soon as they arrive — the body is irrelevant
 * here (and the wrangler dev proxy does not always flush chunked bodies on
 * raw sockets).
 */
async function rawGet(path: string): Promise<string> {
  const port = Number(new URL(BASE).port);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let data = '';
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(5000, () => fail(new Error('rawGet timed out')));
    socket.on('error', fail);
    socket.on('data', (d) => {
      data += String(d);
      const end = data.indexOf('\r\n\r\n');
      if (end !== -1) {
        socket.destroy();
        resolve(data.slice(0, end + 4));
      }
    });
    socket.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
  });
}
