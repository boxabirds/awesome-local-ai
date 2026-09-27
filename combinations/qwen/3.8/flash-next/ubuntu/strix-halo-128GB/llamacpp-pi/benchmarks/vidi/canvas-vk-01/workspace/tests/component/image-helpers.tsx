import { act, render } from '@testing-library/react';

export { deferred, uploadSpy, uploadImageMock, type Deferred, type UploadCall, type UploadSpy } from './image-upload-spy';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { initDoc } from '../../src/shared/board-model';

/**
 * Sharing the board (`image.drop`, `image.paste`, `image.pick`) in jsdom.
 *
 * jsdom implements none of the file drag-and-drop or clipboard API, so these
 * helpers build the smallest event that carries what the board actually reads —
 * `dataTransfer.types`, `dataTransfer.files`, a drop point — in the same shape a
 * browser hands them over. Everything else is real: a real `Y.Doc`, the real
 * viewport, the real upload module replaced only at its own boundary.
 */

/**
 * Stand in for the browser's image decoder. Every accepted file is measured with
 * `createImageBitmap`, so this decides what the board believes the picture's own
 * pixel size is — and refusing to decode is how a corrupt file is tested.
 */
export function stubDecode(
  size: { width: number; height: number } | ((file: File) => { width: number; height: number }),
): void {
  const global = globalThis as unknown as { createImageBitmap?: unknown };
  global.createImageBitmap = (file: File) => {
    const resolved = typeof size === 'function' ? size(file) : size;
    if (resolved.width <= 0 || resolved.height <= 0) {
      return Promise.reject(new Error('could not decode'));
    }
    return Promise.resolve({
      width: resolved.width,
      height: resolved.height,
      close(): void {},
    });
  };
}

/** A file that refuses to decode, as the browser reports it. */
export function stubDecodeFailure(): void {
  const global = globalThis as unknown as { createImageBitmap?: unknown };
  global.createImageBitmap = (): Promise<unknown> => Promise.reject(new Error('could not decode'));
}

export function restoreDecode(): void {
  delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
}

/** A board doc of the test's making, with the story 5 metadata. */
export function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A board with a doc of the test's making, as the application renders it. */
export function renderImageBoard(options: { doc?: Y.Doc; boardId?: string } = {}) {
  const doc = options.doc ?? createDoc();
  const view =
    options.boardId === undefined
      ? render(<BoardApp doc={doc} />)
      : render(<BoardApp doc={doc} boardId={options.boardId} />);
  return { ...view, doc, viewport: view.getByTestId('board-viewport') as HTMLElement };
}

/** The `dataTransfer` of a file drag: types, files, and an effect to set. */
function fileTransfer(files: readonly File[]): DataTransfer {
  return {
    types: ['Files'],
    files: [...files],
    dropEffect: 'none',
    items: [...files],
  } as unknown as DataTransfer;
}

function emptyTransfer(types: readonly string[] = ['text/plain']): DataTransfer {
  return { types, files: [], items: [] } as unknown as DataTransfer;
}

/**
 * Drive a drag over the board. `clientX/Y` are the pointer, and the drop point of
 * the first image (`image.drop`).
 */
export function fireDrag(
  target: Element,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  files: readonly File[] = [],
  at: { x: number; y: number } = { x: 0, y: 0 },
  relatedTarget: Element | null = null,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const transfer = files.length > 0 ? fileTransfer(files) : emptyTransfer();
  Object.defineProperties(event, {
    dataTransfer: { value: transfer },
    clientX: { value: at.x },
    clientY: { value: at.y },
    relatedTarget: { value: relatedTarget },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Paste onto the board; with no files this is an ordinary text paste. */
export function firePaste(
  files: readonly File[] | null,
  target: EventTarget = globalThis.document,
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const transfer = files !== null && files.length > 0 ? fileTransfer(files) : emptyTransfer();
  Object.defineProperty(event, 'clipboardData', { value: transfer });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * Choose files in the hidden picker. A real click cannot be followed in jsdom,
 * but the input's change handler is the whole of what the button achieves.
 */
export function chooseFiles(input: HTMLElement, files: readonly File[]): void {
  Object.defineProperty(input, 'files', { value: [...files], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Wait for the board's async add to have run to its end. */
export async function flushed(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
