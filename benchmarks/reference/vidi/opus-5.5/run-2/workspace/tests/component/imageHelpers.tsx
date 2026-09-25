/**
 * Story 12 component test helpers: a controllable `uploadImage` mock, a `createImageBitmap`
 * stub (jsdom cannot decode images) and file / drop / paste builders.
 */
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import { snapshotObjects } from '../../src/shared/board-model';
import { isImageSnap, type ImageSnap } from '../../src/shared/objects/image';
import type { UploadResult } from '../../src/client/images/uploadImage';
import type { Point } from '../../src/client/canvas/camera';

export interface PendingUpload {
  boardId: string;
  file: File;
  onProgress(fraction: number): void;
  resolve(result: UploadResult): void;
  aborted: boolean;
}

/** Natural sizes the createImageBitmap stub reports, by file name; names containing "corrupt" fail to decode. */
export const DIMENSIONS: Record<string, { width: number; height: number }> = {
  'shot-a.png': { width: 400, height: 300 },
  'shot-b.png': { width: 1600, height: 1200 },
  'shot-c.png': { width: 300, height: 3200 },
  'photo.jpg': { width: 640, height: 480 },
  'clip.png': { width: 200, height: 100 },
};

export function stubCreateImageBitmap(): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      const dims = DIMENSIONS[file.name];
      if (file.name.includes('corrupt') || dims === undefined) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      return { ...dims, close: () => undefined };
    }),
  );
}

export function imageFile(name: string, type = name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', size = 2048): File {
  return new File([new Uint8Array(size)], name, { type });
}

export function images(doc: Y.Doc): ImageSnap[] {
  return snapshotObjects(doc).filter(isImageSnap);
}

/** Dispatches dragenter, dragover and drop of `files` at the screen point `at` on `el`. */
export async function dropFiles(el: Element, files: File[], at: Point): Promise<void> {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none', items: [] };
  // jsdom has no DragEvent, so the pointer position is set on the generic event.
  const make = (type: 'dragEnter' | 'dragOver' | 'drop') => {
    const event = createEvent[type](el, { dataTransfer });
    Object.defineProperties(event, { clientX: { value: at.x }, clientY: { value: at.y } });
    return event;
  };
  fireEvent(el, make('dragEnter'));
  fireEvent(el, make('dragOver'));
  await act(async () => {
    fireEvent(el, make('drop'));
    await flushAsync();
  });
}

/** A paste event carrying `files`, dispatched on `target` (bubbles to window). */
export async function pasteFiles(target: EventTarget, files: File[]): Promise<Event> {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, types: files.length > 0 ? ['Files'] : [] } });
  await act(async () => {
    target.dispatchEvent(event);
    await flushAsync();
  });
  return event;
}

/** Chooses `files` in the hidden Image picker input. */
export async function pickFiles(files: File[]): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][data-testid="image-picker"]');
  if (input === null) throw new Error('image picker input missing');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    fireEvent.change(input);
    await flushAsync();
  });
}

/** Lets pending promise callbacks (decoding, upload results) run. */
export async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function settle(upload: PendingUpload, result: UploadResult): Promise<void> {
  await act(async () => {
    upload.resolve(result);
    await flushAsync();
  });
}

export function toastText(): string | null {
  return screen.queryByTestId('toast')?.textContent ?? null;
}
