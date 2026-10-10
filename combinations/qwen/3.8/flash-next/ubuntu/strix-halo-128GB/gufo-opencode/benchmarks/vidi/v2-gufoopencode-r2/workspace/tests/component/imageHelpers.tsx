// Shared helpers for story 12 ui-component tests: fixture files, drop/paste
// event delivery (jsdom has no real DataTransfer), image snapshot access and
// per-object element lookup.

import { screen } from '@testing-library/react';
import { objectSnapshots } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import { board } from './stickyHelpers';

export function makeFile(name: string, type = 'image/png', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

export interface FileMap {
  width: number;
  height: number;
  decodeFails?: boolean;
}

export const bitmapDims = new Map<string, FileMap>();

// jsdom has no image decoding; stub createImageBitmap with the dimensions a
// real decoder would report for each fixture name (default 400x300).
export function installBitmapStub(): void {
  globalThis.createImageBitmap = ((file: Blob) => {
    const dims = bitmapDims.get((file as File).name) ?? { width: 400, height: 300 };
    if (dims.decodeFails) return Promise.reject(new Error('decode error'));
    return Promise.resolve({
      width: dims.width,
      height: dims.height,
      close: () => undefined,
    });
  }) as unknown as typeof createImageBitmap;
}

export function dataTransferFor(files: File[]): unknown {
  return { files, types: ['Files'], getData: () => '', items: files };
}

export function imageSnaps(): ImageSnap[] {
  return objectSnapshots(board().doc).filter((o) => o.type === 'image') as ImageSnap[];
}

export function imageEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('image-object')
    .find((e) => e.getAttribute('data-image-id') === id);
  if (!el) throw new Error(`image ${id} not rendered`);
  return el as HTMLElement;
}

// The mocked ResizeObserver reports a 1280x800 viewport at origin (0,0), so
// client coordinates equal viewport-relative ones in these tests.
export const VIEWPORT_SIZE = { width: 1280, height: 800 };

export function expectNear(actual: number, expected: number, tolerance = 2): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ${actual} to be within ${tolerance} of ${expected}`);
  }
}

export function pointOf(snap: ImageSnap): Point & { width: number; height: number } {
  return { x: snap.x, y: snap.y, width: snap.width ?? 0, height: snap.height ?? 0 };
}
