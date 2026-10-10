/**
 * Story 12: the parts of an image upload a component test has to hold in its own hands.
 *
 * Two of the board's image dependencies are browser APIs that a component test cannot let
 * run: `createImageBitmap`, because jsdom has never heard of it and the real one would need
 * real pixels; and `uploadImage`, because a test that asserts what happens when an upload
 * fails has to be the one that decides it failed — and has to be able to make it report
 * progress and then succeed, in that order, on the test's schedule rather than the network's.
 * Everything else, including the document, the placeholders, the registry and the messages,
 * is the code under test.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { RECONNECTING_LABEL } from '../../../src/client/sync/ConnectionStatus';
import { socketsDrop, socketsLive } from './socket';

import type * as Y from 'yjs';
import { boardDoc, viewportElement } from './board';
import { newBoardId } from '../../../src/shared/board-id';
import { assetKeyFor } from '../../../src/shared/image-format';
import {
  IMAGE_TYPE,
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  placementSize,
  readImage,
  type ImageSnap,
} from '../../../src/shared/objects/image';
import { localIdentity } from '../../../src/client/useLocalIdentity';
export { uploadImageStub, uploads, lastUpload, resetUploads, type StubUpload } from './upload-stub';

/** One file of the given natural size, with bytes that mean nothing to anyone but the stub. */
export function imageFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

/* ---------------------------------------------------------------- decode */

/** What `createImageBitmap` will say about a file with this name. */
const decodeSizes = new Map<string, { width: number; height: number }>();
let decodeFailures: string[] = [];

/**
 * Teach jsdom to decode images: every file whose name is in `sizes` decodes to those pixels,
 * and every name in `fail` refuses to decode at all — which is what a file that is not
 * really a picture does, name notwithstanding (TC-29).
 */
export function stubImageDecode(
  sizes: Record<string, { width: number; height: number }>,
  fail: string[] = [],
): void {
  decodeSizes.clear();
  for (const [name, size] of Object.entries(sizes)) decodeSizes.set(name, size);
  decodeFailures = [...fail];
  globalThis.createImageBitmap = (async (file: Blob | File) => {
    const name = file instanceof File ? file.name : '';
    if (decodeFailures.includes(name)) throw new Error(`${name} is not a picture`);
    const size = decodeSizes.get(name) ?? { width: 100, height: 100 };
    return {
      width: size.width,
      height: size.height,
      close(): void {},
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

export function clearImageDecodeStub(): void {
  decodeSizes.clear();
  decodeFailures = [];
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
}

/* ---------------------------------------------------------------- connection */

/** The badge's own words, which is the only way to see the state the image code reads. */
export function connectionLabel(): string | null {
  return document.querySelector('[data-testid="connection-status"]')?.textContent ?? null;
}

/**
 * Open the stub sockets and wait until the board says nothing about its connection: the badge
 * is silent exactly while the board is `connected` or `confirmed`, which is precisely the
 * condition an image upload needs.
 */
export async function connected(): Promise<void> {
  await socketsLive();
  await vi.waitFor(() => {
    const label = connectionLabel();
    if (label !== null) throw new Error(`board is not connected yet: ${label}`);
  });
}

/** Pull the cable, and wait until the board knows it. */
export async function reconnected(): Promise<void> {
  socketsDrop();
  await vi.waitFor(() => {
    if (connectionLabel() !== RECONNECTING_LABEL) {
      throw new Error(`board does not know it is offline yet: ${connectionLabel()}`);
    }
  });
}

/* ---------------------------------------------------------------- events */

/** The files a `DataTransfer` carries, as far as these handlers read it. */
function fileTransfer(files: readonly File[]): DataTransfer {
  return {
    files,
    types: ['Files'],
    items: [],
    dropEffect: 'copy',
    effectAllowed: 'copy',
  } as unknown as DataTransfer;
}

function dispatchOn(target: EventTarget, type: string, init: Record<string, unknown>): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, init);
  act(() => {
    target.dispatchEvent(event);
  });
}

/**
 * Drag files over the board and let go there.
 *
 * `dragover` comes first because the browser (and this board) only allows a drop once
 * something has prevented the default on it — so a test that skipped it would be testing a
 * drop the code never sees.
 */
export function dropFiles(files: readonly File[], at: { x: number; y: number }): void {
  const dataTransfer = fileTransfer(files);
  const viewport = viewportElement();
  dispatchOn(viewport, 'dragover', { dataTransfer, clientX: at.x, clientY: at.y });
  dispatchOn(viewport, 'drop', { dataTransfer, clientX: at.x, clientY: at.y });
}

/** Are files being carried over the board right now? (the highlight's question) */
export function dragFilesOntoBoard(files: readonly File[]): void {
  dispatchOn(window, 'dragenter', { dataTransfer: fileTransfer(files), clientX: 10, clientY: 10 });
}

export function dragFilesAwayFromBoard(files: readonly File[]): void {
  dispatchOn(window, 'dragleave', { dataTransfer: fileTransfer(files), clientX: 10, clientY: 10 });
}

/**
 * Paste files at the window, which is where a paste lands when nothing is being typed into;
 * pass `target` to put the caret somewhere else, which is the other half of TC-18.
 */
export function pasteFiles(files: readonly File[], target: EventTarget = window): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { files: fileTransfer(files).files } });
  act(() => {
    target.dispatchEvent(event);
  });
}

/* ---------------------------------------------------------------- queries */

/** Every image object in the board's document, as the model reads it. */
export function imagesInDoc(doc: Y.Doc = boardDoc()): ImageSnap[] {
  const out: ImageSnap[] = [];
  doc.getMap<Y.Map<unknown>>('objects').forEach((_item, id) => {
    const image = readImage(doc, id);
    if (image !== null) out.push(image);
  });
  return out;
}

/** A key of the shape a 201 answer would carry. */
export function storedKey(): string {
  return assetKeyFor(newBoardId(), newBoardId());
}

/** The placeholder boxes on screen, in the states the model gave them. */
export function imageStateElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image-state"]'));
}

export function imageElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="image-object"]');
  if (!element) throw new Error('no image element on the board');
  return element;
}

export function hasImageElement(): boolean {
  return document.querySelector('[data-testid="image-object"]') !== null;
}

export function imageType(): string {
  return IMAGE_TYPE;
}
/* ---------------------------------------------------------------- seeding */

/**
 * Put an image object straight into the board's document, in whichever state a test wants to
 * look at. Going through the model rather than through the insert flow is the point: the
 * state of an image somebody else left behind is exactly what a test of the states has to
 * start from, and `uploaderId` says whose upload it was, which the insert flow decides for
 * itself and a test cannot change.
 */
export function seedImage(
  options: {
    status?: 'uploading' | 'ready' | 'failed';
    uploaderId?: string;
    /** Natural size, which is what the board's box is scaled from. */
    size?: { width: number; height: number };
    at?: { x: number; y: number };
    startedAt?: number;
    doc?: Y.Doc;
  } = {},
): string {
  const doc = options.doc ?? boardDoc();
  const natural = options.size ?? { width: 400, height: 200 };
  const [rect] = layoutRow(
    [placementSize(natural.width, natural.height)],
    options.at ?? { x: 0, y: 0 },
    'top-left',
  );
  const [id] = createImagePlaceholders(
    doc,
    [{ rect, naturalWidth: natural.width, naturalHeight: natural.height, contentType: 'image/png' }],
    options.uploaderId ?? localIdentity(),
    options.startedAt ?? Date.now(),
  );
  if (options.status === 'ready') markImageReady(doc, id, storedKey());
  if (options.status === 'failed') markImageFailed(doc, id);
  return id;
}

/** The element that holds an image object of either sort — the picture or the box. */
export function imageObjectElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-note-id="${id}"][data-testid="image-object"], [data-note-id="${id}"][data-testid="image-state"]`,
  );
  if (!element) throw new Error(`no element rendered for image ${id}`);
  return element;
}

/** The box an image is drawn in, whatever state it is in — its size is what must not change. */
export function imageBox(id: string): { width: string; height: string; left: string; top: string } {
  const element = imageObjectElement(id);
  return {
    width: element.style.width,
    height: element.style.height,
    left: element.style.left,
    top: element.style.top,
  };
}

export function imageButton(testId: 'image-retry' | 'image-remove'): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

export function clickImageButton(testId: 'image-retry' | 'image-remove'): void {
  const button = imageButton(testId);
  if (!button) throw new Error(`no ${testId} button on the board`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Say the picture's bytes will not load, which is the browser's job and so cannot be waited for. */
export function failImageLoad(id: string): void {
  const element = document.querySelector<HTMLElement>(
    `[data-note-id="${id}"][data-testid="image-object"]`,
  );
  if (!element) throw new Error(`no picture element for image ${id}`);
  act(() => {
    element.dispatchEvent(new Event('error', { bubbles: false }));
  });
}
