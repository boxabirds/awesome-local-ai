/**
 * Story 12: e2e file-drop helper (image.drop).
 *
 * Builds a real `DataTransfer` from fixture files INSIDE the page (base64 →
 * Uint8Array → File) and dispatches dragenter / dragover / drop on the board
 * viewport at given screen coordinates. E2e runs at the default camera
 * (0,0,1), so screen coordinates equal world coordinates.
 *
 * Fixture files are also written to a temp dir so the file-picker path can
 * use them with `setInputFiles`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  makePng,
  makeGif,
  JPEG_BYTES,
  WEBP_BYTES,
  makePdf,
  makeSvgWithScript,
  makeJpegOfSize,
  makeCorruptPng,
  toBase64,
} from '../../fixtures/images';

let fixtureDir: string | null = null;
function ensureFixtureDir(): string {
  if (!fixtureDir) {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidi6-images-'));
  }
  return fixtureDir;
}

export interface E2eFile {
  name: string;
  type: string;
  /** On-disk path (for `setInputFiles`). */
  path: string;
  /** Base64 of the exact bytes (for in-page DataTransfer drops). */
  base64: string;
}

/** Materialises a fixture (writes it to the temp dir, returns the handle). */
export function makeFixture(name: string, bytes: Uint8Array, type: string): E2eFile {
  const p = path.join(ensureFixtureDir(), name);
  fs.writeFileSync(p, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { name, type, path: p, base64: toBase64(bytes) };
}

/** Convenience builders mirroring the fixture module. */
export const fixtures = {
  png: (name: string, w = 1440, h = 900, rgb: [number, number, number] = [226, 119, 60]): E2eFile =>
    makeFixture(name, makePng(w, h, rgb), 'image/png'),
  gif: (name: string): E2eFile => makeFixture(name, makeGif(), 'image/gif'),
  jpeg: (name: string): E2eFile => makeFixture(name, JPEG_BYTES, 'image/jpeg'),
  webp: (name: string): E2eFile => makeFixture(name, WEBP_BYTES, 'image/webp'),
  pdf: (name: string): E2eFile => makeFixture(name, makePdf(), 'application/pdf'),
  svg: (name: string): E2eFile => makeFixture(name, makeSvgWithScript(), 'image/svg+xml'),
  corruptPng: (name: string): E2eFile => makeFixture(name, makeCorruptPng(), 'image/png'),
  /** A file of exactly n bytes with a JPEG magic head (size-limit fixtures). */
  jpegOfSize: (name: string, n: number): E2eFile =>
    makeFixture(name, makeJpegOfSize(n), 'image/jpeg'),
};

/**
 * Drops `files` on the board viewport at screen point (x, y) — the
 * top-left corners of the placed images start at that world point.
 */
export async function dropFilesAt(page: Page, files: E2eFile[], x: number, y: number): Promise<void> {
  const payloads = files.map((f) => ({ name: f.name, type: f.type, base64: f.base64 }));
  await page.evaluate(
    ({ files: fs_, x, y }) => {
      const fromBase64 = (b64: string): Uint8Array =>
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      for (const f of fs_) {
        dt.items.add(new File([fromBase64(f.base64)], f.name, { type: f.type }));
      }
      const target = document.querySelector(
        '[data-testid="board-viewport"]',
      ) as HTMLElement | null;
      if (!target) throw new Error('board viewport not found');
      const make = (type: string): DragEvent =>
        new DragEvent(type, {
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
      target.dispatchEvent(make('dragenter'));
      target.dispatchEvent(make('dragover'));
      target.dispatchEvent(make('drop'));
    },
    { files: payloads, x, y },
  );
}
