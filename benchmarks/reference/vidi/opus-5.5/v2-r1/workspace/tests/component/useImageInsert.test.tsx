// image.insert (TC-17 to TC-19, TC-29): drop, paste and offline flows with a real Y.Doc, a
// mocked uploadImage and a stubbed createImageBitmap.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { uploadImage } from '../../src/client/images/uploadImage';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { initDoc } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import {
  corruptFile,
  dropFiles,
  fakeUploads,
  finish,
  imageFile,
  imagesOf,
  pasteFiles,
  stubBitmaps,
} from './imageHelpers';
import { docWithNote, noteEl, renderApp } from './stickyHelpers';
import { toWorld } from './shapeHelpers';

vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: vi.fn() }));

let uploads: ReturnType<typeof fakeUploads>;
beforeEach(() => {
  stubBitmaps();
  uploads = fakeUploads();
  vi.mocked(uploadImage).mockImplementation(uploads.impl);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(uploadImage).mockReset();
});

const toast = () => document.querySelector('.toast-region')!;

describe('image.insert drop', () => {
  it('TC-17 three files: placeholders in a row from the drop point, progress, then ready', async () => {
    const { doc, viewport } = renderApp();
    const files = [imageFile('a.png', 400, 300), imageFile('b.png', 1600, 1200), imageFile('c.gif', 100, 200, 'image/gif')];
    await dropFiles(viewport, files, { x: 100, y: 50 });

    const images = imagesOf(doc);
    expect(images).toHaveLength(3);
    const at = toWorld({ x: 100, y: 50 });
    const byX = [...images].sort((a, b) => a.x - b.x);
    expect(byX.map((i) => [i.width, i.height])).toEqual([
      [400, 300],
      [800, 600],
      [100, 200],
    ]);
    expect(byX[0]).toMatchObject({ x: at.x, y: at.y, status: 'uploading' });
    expect(byX.map((i) => i.y)).toEqual([at.y, at.y, at.y]);
    expect(byX[1].x).toBe(at.x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(byX[2].x).toBe(at.x + 400 + 800 + 2 * IMAGE_LAYOUT_GAP_WORLD);

    // One upload per file, all started at once.
    expect(uploads.calls.map((c) => c.file)).toEqual(files);
    const first = document.querySelector(`[data-image-id="${byX[0].id}"]`)!;
    expect(first.textContent).toContain('0%');
    uploads.calls[0].progress(0.37);
    expect(first.textContent).toContain('37%');
    expect(first.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('37');
    uploads.calls[0].progress(0.9);
    expect(first.textContent).toContain('90%');

    await finish(uploads.calls[0], { kind: 'ok', assetKey: 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB' });
    await waitFor(() => expect(imagesOf(doc).find((i) => i.id === byX[0].id)!.status).toBe('ready'));
    const img = first.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/assets/AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB');
    expect(img.getAttribute('alt')).toBe('Image');
    expect(img.getAttribute('draggable')).toBe('false');
    // The others are still uploading.
    expect(imagesOf(doc).filter((i) => i.status === 'uploading')).toHaveLength(2);
  });

  it('shows the drop highlight only while files are dragged over the board', async () => {
    const { viewport } = renderApp();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    const enter = createDrag('dragenter', ['Files']);
    act(() => {
      viewport.dispatchEvent(enter);
    });
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    act(() => {
      viewport.dispatchEvent(createDrag('dragleave', ['Files']));
    });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    // Dragging text from the page is not a file drag.
    act(() => {
      viewport.dispatchEvent(createDrag('dragenter', ['text/plain']));
    });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('unsupported and oversized files are explained; supported files in the same drop are added', async () => {
    const { doc, viewport } = renderApp();
    const big = imageFile('big.png', 10, 10);
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await dropFiles(viewport, [new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), big, imageFile('ok.png', 50, 40)], { x: 10, y: 10 });
    expect(imagesOf(doc)).toHaveLength(1);
    expect(toast().textContent).toContain(REJECTION_MESSAGES.type);
    expect(toast().textContent).toContain(REJECTION_MESSAGES.size);
    expect(uploads.calls).toHaveLength(1);
  });

  it('adding images is one undo step; upload completion is not a step', async () => {
    const { doc, viewport } = renderApp();
    await dropFiles(viewport, [imageFile('a.png', 40, 30), imageFile('b.png', 40, 30)], { x: 10, y: 10 });
    await finish(uploads.calls[0], { kind: 'ok', assetKey: 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB' });
    await finish(uploads.calls[1], { kind: 'failed', status: 500 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(imagesOf(doc)).toHaveLength(0);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' }).disabled).toBe(true);
  });
});

function createDrag(type: string, types: string[]) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types, files: [], dropEffect: 'none' } });
  return e;
}

describe('image.insert paste', () => {
  it('TC-18 paste while editing a note adds nothing; paste on the board adds the image centred in view', async () => {
    const { doc } = docWithNote('hello');
    renderApp(doc);
    fireEvent.doubleClick(noteEl());
    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    expect(document.activeElement).toBe(textarea);
    const inEditor = await pasteFiles(textarea, [imageFile('shot.png', 400, 300)]);
    expect(imagesOf(doc)).toHaveLength(0);
    expect(inEditor.defaultPrevented).toBe(false);
    expect(uploads.calls).toHaveLength(0);

    fireEvent.keyDown(textarea, { key: 'Escape' });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    const onBoard = await pasteFiles(document.body, [imageFile('shot.png', 400, 300)]);
    expect(onBoard.defaultPrevented).toBe(true);
    const [img] = imagesOf(doc);
    // jsdom viewport 1024×768 with the initial camera: the view centre is world (0, 0).
    const centre = toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(img.x + img.width / 2).toBeCloseTo(centre.x);
    expect(img.y + img.height / 2).toBeCloseTo(centre.y);
    expect([img.width, img.height]).toEqual([400, 300]);
  });

  it('a paste without image files is left alone', async () => {
    const { doc } = renderApp();
    const e = await pasteFiles(document.body, []);
    expect(e.defaultPrevented).toBe(false);
    expect(imagesOf(doc)).toHaveLength(0);
  });
});

/** The hook alone, with a controllable connection state. */
function Harness(props: { doc: Y.Doc; connection: ConnectionState; onMessage(m: string): void }) {
  const images = useImageInsert({
    doc: props.doc,
    boardId: 'AAAAAAAAAAAAAAAAAAAAAA',
    camera: { x: 0, y: 0, zoom: 1 },
    connection: props.connection,
    identityId: 'g_leo',
    notify: props.onMessage,
  });
  return (
    <div
      data-testid="surface"
      onDragEnter={images.onDragEnter}
      onDragOver={images.onDragOver}
      onDragLeave={images.onDragLeave}
      onDrop={images.onDrop}
    >
      <button type="button" onClick={() => images.openPicker()}>
        pick
      </button>
    </div>
  );
}

describe('image.insert offline', () => {
  it('TC-19 reconnecting: drop, paste and picker show the offline message and add nothing', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const messages: string[] = [];
    const { rerender } = render(<Harness doc={doc} connection="connected" onMessage={(m) => messages.push(m)} />);
    rerender(<Harness doc={doc} connection="reconnecting" onMessage={(m) => messages.push(m)} />);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');

    await dropFiles(screen.getByTestId('surface'), [imageFile('a.png', 40, 30)], { x: 5, y: 5 });
    await pasteFiles(document.body, [imageFile('b.png', 40, 30)]);
    fireEvent.click(screen.getByRole('button', { name: 'pick' }));

    expect(messages).toEqual([REJECTION_MESSAGES.offline, REJECTION_MESSAGES.offline, REJECTION_MESSAGES.offline]);
    expect(imagesOf(doc)).toHaveLength(0);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('connected: the drop point is converted with the camera', async () => {
    const doc = new Y.Doc();
    initDoc(doc);
    render(<Harness doc={doc} connection="confirmed" onMessage={() => {}} />);
    await dropFiles(screen.getByTestId('surface'), [imageFile('a.png', 40, 30)], { x: 5, y: 7 });
    expect(imagesOf(doc)[0]).toMatchObject({ x: 5, y: 7, width: 40, height: 30, uploaderId: 'g_leo' });
    expect(uploads.calls[0].boardId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });
});

describe('image.insert decode failure', () => {
  it('TC-29 a file that cannot be decoded: type message, no placeholder, no upload', async () => {
    const { doc, viewport } = renderApp();
    await dropFiles(viewport, [corruptFile('broken.png')], { x: 10, y: 10 });
    expect(imagesOf(doc)).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(toast().textContent).toBe(REJECTION_MESSAGES.type);
    expect(toast().getAttribute('role')).toBe('status');
  });
});

describe('image.insert picker', () => {
  const imageButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Image (I)' });

  it('the Image button and I open the picker filtered to image types; choosing adds centred, then Select', async () => {
    const { doc } = renderApp();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(imageButton());
    expect(click).toHaveBeenCalledTimes(1);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    expect(imageButton().getAttribute('aria-pressed')).toBe('true');

    const files = [imageFile('a.png', 100, 50), imageFile('b.png', 100, 50)];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(imageButton().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    const images = imagesOf(doc).sort((p, q) => p.x - q.x);
    expect(images).toHaveLength(2);
    const centre = toWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const left = images[0].x;
    const right = images[1].x + images[1].width;
    expect((left + right) / 2).toBeCloseTo(centre.x);

    // I opens it again; cancelling returns to Select with nothing added.
    fireEvent.keyDown(window, { key: 'i' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(imageButton().getAttribute('aria-pressed')).toBe('true');
    act(() => {
      input.dispatchEvent(new Event('cancel'));
    });
    expect(imageButton().getAttribute('aria-pressed')).toBe('false');
    expect(imagesOf(doc)).toHaveLength(2);
    click.mockRestore();
  });

  it('more than 20 files: the first 20 are added with the count message', async () => {
    const { doc } = renderApp();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(imageButton());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = Array.from({ length: 21 }, (_, i) => imageFile(`f${i}.png`, 10, 10));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(imagesOf(doc)).toHaveLength(20);
    expect(uploads.calls.map((c) => c.file)).toEqual(files.slice(0, 20));
    expect(toast().textContent).toBe(REJECTION_MESSAGES.count);
    click.mockRestore();
  });
});
