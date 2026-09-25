/**
 * Helpers for story 12 component tests: the real board with a fake room connection that can be
 * "connected", a controllable uploadImage mock, stubbed createImageBitmap (jsdom cannot decode
 * images) and drop / paste events carrying files.
 */
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import type { BoardProvider } from '../../src/client/sync/connectBoard';
import { newBoardId } from '../../src/shared/board-id';
import { objectSnapshot } from '../../src/shared/board-model';
import { isImage, type ImageSnap } from '../../src/shared/objects/image';
import { flushFrame } from './stickyHelpers';

export { mockUpload, uploads, type UploadCall } from './uploadMock';

type Status = 'connecting' | 'connected' | 'disconnected';

/** Stands in for WebsocketProvider: tests emit `status` and `sync` by hand. */
export class FakeProvider implements BoardProvider {
  private statusHandlers: ((e: { status: Status }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  wsconnected = false;

  on(event: 'status' | 'sync' | 'connection-close', handler: never): void {
    if (event === 'status') this.statusHandlers.push(handler);
    else if (event === 'sync') this.syncHandlers.push(handler);
  }
  connect(): void {}
  disconnect(): void {}
  destroy(): void {}

  /** A successful first sync: the board is `connected`. */
  connectAndSync(): void {
    act(() => {
      this.wsconnected = true;
      this.statusHandlers.forEach((h) => h({ status: 'connected' }));
      this.syncHandlers.forEach((h) => h(true));
    });
  }

  /** The connection drops after having synced: `reconnecting`. */
  drop(): void {
    act(() => {
      this.wsconnected = false;
      this.syncHandlers.forEach((h) => h(false));
      this.statusHandlers.forEach((h) => h({ status: 'disconnected' }));
    });
  }
}

/** Natural sizes the stubbed createImageBitmap reports, by file name; missing names fail to decode. */
export function stubDecoder(sizes: Record<string, { width: number; height: number }>): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      const size = sizes[file.name];
      if (!size) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      return { ...size, close: () => undefined };
    }),
  );
}

export function imageFile(name: string, type = 'image/png', size = 1024): File {
  const file = new File([new Uint8Array(1)], name, { type });
  // Size matters only to validation; avoid allocating large buffers.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

type FakeableTimer = 'setInterval' | 'clearInterval' | 'Date';

/**
 * Renders the whole board connected to a fake room; returns the provider. Animation frames are
 * fake (as in renderBoard); `alsoFake` adds more fake timers.
 */
export function renderConnectedBoard(connect = true, alsoFake: readonly FakeableTimer[] = []): FakeProvider {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', ...alsoFake] });
  const provider = new FakeProvider();
  render(<Board boardId={newBoardId()} createProvider={() => provider} />);
  flushFrame();
  if (connect) provider.connectAndSync();
  return provider;
}

function hooksDoc(): Y.Doc {
  const h = window.__vidi6;
  if (!h) throw new Error('test hooks not installed');
  return h.getDoc();
}

export function images(): ImageSnap[] {
  return objectSnapshot(hooksDoc()).filter(isImage);
}

export function imageEls(): HTMLElement[] {
  return screen.queryAllByTestId('image-object');
}

export function imageEl(id: string): HTMLElement {
  const el = imageEls().find((e) => e.dataset.id === id);
  if (!el) throw new Error(`image ${id} not rendered`);
  return el;
}

/** Drops `files` on `el` at client point `p` (a file drag: dataTransfer.types has "Files"). */
export function dropFiles(el: Element, files: File[], p: { x: number; y: number }): void {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' };
  fireEvent.dragEnter(el, { dataTransfer });
  fireEvent.dragOver(el, { dataTransfer });
  const drop = createEvent.drop(el, { dataTransfer });
  Object.defineProperties(drop, { clientX: { value: p.x }, clientY: { value: p.y } });
  fireEvent(el, drop);
}

/** Pastes clipboard content with `files` on `target` (bubbles to window). */
export function pasteFiles(target: Element, files: File[]): void {
  const clipboardData = {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: ['Files'],
  };
  fireEvent.paste(target, { clipboardData });
}

export function toastText(): string {
  return screen.getByRole('status', { name: 'Messages' }).textContent ?? '';
}
