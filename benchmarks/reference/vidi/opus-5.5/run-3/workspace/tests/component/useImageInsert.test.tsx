// image.insert in jsdom: the real App (or the hook alone) on a real Y.Doc, with `uploadImage` mocked (controllable
// progress and results) and `createImageBitmap` stubbed (jsdom cannot decode images; sizes come from file names).
import { act, createEvent, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { createSticky, objectSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { isImage, type ImageSnap } from '../../src/shared/objects/image';

interface Upload {
  file: File;
  progress(f: number): void;
  resolve(r: UploadResult): void;
}
const uploads: Upload[] = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => (resolve = r));
    uploads.push({ file, progress: (f) => act(() => onProgress(f)), resolve });
    return { promise, abort: () => resolve({ kind: 'failed' }) };
  }),
}));

/** `<name>-<w>x<h>.png` decodes to that size; a name containing "corrupt" fails to decode. */
function stubDecoding() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (file.name.includes('corrupt')) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      const m = /(\d+)x(\d+)/.exec(file.name);
      return { width: m ? Number(m[1]) : 100, height: m ? Number(m[2]) : 100, close() {} };
    }),
  );
}

function png(name: string): File {
  return new File([new Uint8Array(64)], name, { type: 'image/png' });
}

function fileDrag(files: File[]) {
  return { types: ['Files'], files, dropEffect: 'none', effectAllowed: 'all', items: [], getData: () => '' };
}

/** jsdom has no DragEvent, so drag events lack pointer coordinates unless they are added. */
function drag(type: 'dragEnter' | 'dragOver' | 'drop', el: Element, files: File[], x: number, y: number) {
  const event = createEvent[type](el, { dataTransfer: fileDrag(files) });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  fireEvent(el, event);
}

function images(doc: Y.Doc): ImageSnap[] {
  return objectSnapshot(doc).filter(isImage);
}

/** Lets the async add flow (decoding, then placeholders) finish. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function renderBoard(doc = new Y.Doc()) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const utils = render(<App doc={doc} identityId="leo" />);
  return { ...utils, doc, viewport: screen.getByTestId('board-viewport') };
}

beforeEach(() => {
  uploads.length = 0;
  stubDecoding();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image.insert: drop', () => {
  it('TC-17 three dropped files: placeholders in a row from the drop point, progress shown, ready when uploaded', async () => {
    const { doc, viewport } = renderBoard();
    const files = [png('a-400x300.png'), png('b-1600x1200.png'), png('c-200x200.png')];
    drag('dragEnter', viewport, files, 100, 120);
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();
    drag('drop', viewport, files, 100, 120);
    await settle();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    const placed = images(doc).sort((a, b) => a.x - b.x);
    expect(placed).toHaveLength(3);
    const at = screenToWorld(window.__vidi6!.getCamera(), { x: 100, y: 120 });
    expect(placed[0]).toMatchObject({ x: at.x, y: at.y, width: 400, height: 300, status: 'uploading', uploaderId: 'leo' });
    expect(placed[1]).toMatchObject({ x: at.x + 400 + IMAGE_LAYOUT_GAP_WORLD, y: at.y, width: 800, height: 600 });
    expect(placed[2]).toMatchObject({ x: at.x + 1200 + 2 * IMAGE_LAYOUT_GAP_WORLD, y: at.y, width: 200, height: 200 });
    expect(uploads.map((u) => u.file.name)).toEqual(files.map((f) => f.name));

    const first = document.querySelector<HTMLElement>(`[data-image-id="${placed[0].id}"]`)!;
    expect(within(first).getByText('0%')).toBeInTheDocument();
    uploads[0].progress(0.42);
    expect(within(first).getByText('42%')).toBeInTheDocument();
    expect(within(first).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');

    await act(async () => uploads[0].resolve({ kind: 'ok', assetKey: 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB' }));
    const ready = images(doc).find((i) => i.id === placed[0].id)!;
    expect(ready.status).toBe('ready');
    const img = within(first).getByRole('img', { name: 'Image' });
    expect(img).toHaveAttribute('src', '/api/assets/AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    expect(img).toHaveAttribute('draggable', 'false');
  });

  it('a drag without files shows no highlight and a drag leaving the board hides it', () => {
    const { viewport } = renderBoard();
    fireEvent.dragEnter(viewport, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireEvent.dragOver(viewport, { dataTransfer: fileDrag([png('a.png')]) });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();
    fireEvent.dragLeave(viewport, { relatedTarget: null });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('TC-29 a file that cannot be decoded: type toast, no placeholder for it; valid files in the drop are added', async () => {
    const { doc, viewport } = renderBoard();
    drag('drop', viewport, [png('corrupt.png')], 10, 10);
    await settle();
    expect(images(doc)).toEqual([]);
    expect(uploads).toEqual([]);
    expect(screen.getByTestId('toast')).toHaveTextContent(REJECTION_MESSAGES.type);

    drag('drop', viewport, [png('corrupt.png'), png('ok-50x40.png')], 10, 10);
    await settle();
    expect(images(doc)).toHaveLength(1);
    expect(uploads.map((u) => u.file.name)).toEqual(['ok-50x40.png']);
  });

  it('undoing an add removes all its images in one step', async () => {
    const { doc, viewport } = renderBoard();
    drag('drop', viewport, [png('a.png'), png('b.png')], 10, 10);
    await settle();
    expect(images(doc)).toHaveLength(2);
    await act(async () => uploads[0].resolve({ kind: 'ok', assetKey: 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(images(doc)).toEqual([]);
  });
});

describe('image.insert: paste', () => {
  function paste(target: EventTarget, files: File[]) {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { files, types: ['Files'], getData: () => '' } });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it('TC-18 pasting while editing a note adds no image; pasting with the board focused adds it centred in view', async () => {
    const doc = new Y.Doc();
    const { viewport } = renderBoard(doc);
    let noteId = '';
    act(() => {
      noteId = createSticky(doc, { x: 0, y: 0 });
    });
    fireEvent.doubleClick(document.querySelector(`[data-note-id="${noteId}"]`)!);
    const editor = screen.getByRole('textbox');
    editor.focus();
    const ignored = paste(editor, [png('shot-300x200.png')]);
    await settle();
    expect(ignored.defaultPrevented).toBe(false);
    expect(images(doc)).toEqual([]);
    expect(uploads).toEqual([]);

    fireEvent.keyDown(editor, { key: 'Escape' });
    viewport.focus();
    const handled = paste(viewport, [png('shot-300x200.png')]);
    await settle();
    expect(handled.defaultPrevented).toBe(true);
    const [img] = images(doc);
    expect(img).toBeDefined();
    const centre = screenToWorld(window.__vidi6!.getCamera(), { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(img.x + img.width / 2).toBeCloseTo(centre.x);
    expect(img.y + img.height / 2).toBeCloseTo(centre.y);
  });

  it('a paste without image files is left alone', async () => {
    const { doc, viewport } = renderBoard();
    viewport.focus();
    const e = paste(viewport, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
    await settle();
    expect(e.defaultPrevented).toBe(false);
    expect(images(doc)).toEqual([]);
  });
});

describe('image.insert: hook', () => {
  function renderInsert(connection: 'connected' | 'reconnecting' | 'connecting') {
    const doc = new Y.Doc();
    const hook = renderHook(
      (props: { connection: typeof connection }) =>
        useImageInsert({
          doc,
          boardId: 'AAAAAAAAAAAAAAAAAAAAAA',
          connection: props.connection,
          identityId: 'leo',
          toWorld: (x, y) => ({ x, y }),
          viewCentre: () => ({ x: 0, y: 0 }),
        }),
      { initialProps: { connection } },
    );
    return { doc, hook };
  }

  function dropEvent(files: File[]) {
    return {
      dataTransfer: fileDrag(files) as unknown as DataTransfer,
      clientX: 5,
      clientY: 5,
      currentTarget: null,
      preventDefault() {},
    };
  }

  it('TC-19 reconnecting: a drop shows the offline toast, creates nothing and uploads nothing', async () => {
    const { doc, hook } = renderInsert('reconnecting');
    act(() => hook.result.current.onDrop(dropEvent([png('a.png')])));
    await settle();
    expect(hook.result.current.message?.lines).toEqual([REJECTION_MESSAGES.offline]);
    expect(doc.getMap('objects').size).toBe(0);
    expect(uploads).toEqual([]);
    act(() => hook.result.current.openPicker());
    expect(hook.result.current.message?.lines).toEqual([REJECTION_MESSAGES.offline]);
  });

  it('TC-20 picker upload answered rate_limited: the image is failed and the rate toast shows', async () => {
    const doc = new Y.Doc();
    renderBoard(doc);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png('pic-120x80.png')] } });
    await settle();
    expect(images(doc)).toHaveLength(1);
    await act(async () => uploads[0].resolve({ kind: 'rate_limited' }));
    expect(images(doc)[0].status).toBe('failed');
    expect(screen.getByTestId('toast')).toHaveTextContent(REJECTION_MESSAGES.rate);
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
  });

  it('validation toasts: a mix of refused files and a valid one adds the valid one and lists every reason', async () => {
    const { doc, hook } = renderInsert('connected');
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    act(() => hook.result.current.onDrop(dropEvent([png('ok.png'), new File(['%PDF'], 'd.pdf', { type: 'application/pdf' }), big])));
    await settle();
    expect(images(doc)).toHaveLength(1);
    expect(hook.result.current.message?.lines).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.size]);
  });
});

describe('image.insert: Image tool', () => {
  it('the Image button and the I key open the file picker and leave the Select tool active', () => {
    renderBoard();
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'i' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
