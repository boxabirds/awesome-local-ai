// Story 12 — image.insert flows in jsdom with a mocked upload and a stubbed
// createImageBitmap (TC-17, TC-18, TC-19, TC-29), plus picker, limits and undo.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_FILES_PER_ADD, TOAST_DURATION_MS } from '../../src/shared/config';
import { isImage, type ImageSnap } from '../../src/shared/objects/image';
import { createUndo } from '../../src/client/board/undo';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { uploadImage, type UploadResult } from '../../src/client/images/uploadImage';
import { newBoardId } from '../../src/shared/board-id';
import { PDF_BYTES, SMALL_PNG } from '../fixtures/image-bytes';
import { HARNESS_BOARD, HARNESS_VIEW, ImageHarness, ME, newDoc, TestDragEvent } from './image-harness';

vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: vi.fn() }));

interface Pending {
  file: File;
  progress(f: number): void;
  resolve(r: UploadResult): void;
}
let pending: Pending[] = [];
const upload = vi.mocked(uploadImage);

/** Natural sizes by file name (jsdom cannot decode images). */
const DIMENSIONS: Record<string, [number, number]> = {
  'wide.png': [1600, 1200],
  'small.png': [400, 300],
  'tall.png': [300, 3200],
};

beforeEach(() => {
  vi.stubGlobal('DragEvent', TestDragEvent);
  pending = [];
  upload.mockReset();
  upload.mockImplementation((_board, file, onProgress) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => (resolve = r));
    pending.push({ file, progress: onProgress, resolve });
    return { promise, abort: vi.fn() };
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (file.name.startsWith('corrupt')) throw new DOMException('decode failed', 'InvalidStateError');
      const [width, height] = DIMENSIONS[file.name] ?? [64, 40];
      return { width, height, close() {} };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const png = (name: string) => new File([SMALL_PNG], name, { type: 'image/png' });
const images = (doc: Y.Doc) => objectsSnapshot(doc).filter(isImage) as ImageSnap[];
const KEY = () => `${HARNESS_BOARD}/${newBoardId()}`;

function drop(files: File[], at = { clientX: 100, clientY: 50 }) {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' };
  const vp = screen.getByTestId('viewport');
  fireEvent.dragEnter(vp, { dataTransfer });
  fireEvent.dragOver(vp, { dataTransfer });
  fireEvent.drop(vp, { dataTransfer, ...at });
}

function paste(target: Element, files: File[]) {
  const ev = fireEvent.paste(target, { clipboardData: { files, types: ['Files'] } });
  return ev;
}

describe('drop (image.drop)', () => {
  it('TC-17: 3 files → 3 placeholders in a row from the drop point; progress text updates; ready after resolve', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    drop([png('wide.png'), png('small.png'), png('tall.png')], { clientX: 100, clientY: 50 });

    await waitFor(() => expect(images(doc)).toHaveLength(3));
    const [a, b, c] = [...images(doc)].sort((p, q) => p.x - q.x);
    expect([a.x, a.y]).toEqual([100, 50]);
    expect([a.width, a.height]).toEqual([800, 600]);
    expect([b.x, b.y, b.width, b.height]).toEqual([100 + 800 + IMAGE_LAYOUT_GAP_WORLD, 50, 400, 300]);
    expect([c.x, c.y, c.width, c.height]).toEqual([b.x + 400 + IMAGE_LAYOUT_GAP_WORLD, 50, 75, 800]);
    expect(images(doc).every((i) => i.status === 'uploading' && i.uploaderId === ME)).toBe(true);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls.every((call) => call[0] === HARNESS_BOARD)).toBe(true);

    expect(screen.getAllByText('0%')).toHaveLength(3);
    const first = pending.find((p) => p.file.name === 'wide.png')!;
    act(() => first.progress(0.42));
    const aEl = document.querySelector(`[data-image-id="${a.id}"]`)!;
    expect(aEl).toHaveTextContent('42%');
    expect(aEl.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '42');

    const key = KEY();
    await act(async () => first.resolve({ kind: 'ok', assetKey: key }));
    expect(images(doc).find((i) => i.id === a.id)!.status).toBe('ready');
    expect(aEl.querySelector('img')).toHaveAttribute('src', `/api/assets/${key}`);
    expect(aEl.querySelector('img')).toHaveAttribute('alt', 'Image');
    // The others are still uploading.
    expect(images(doc).filter((i) => i.status === 'uploading')).toHaveLength(2);
  });

  it('shows the drop highlight only while files are dragged over the board', () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    const vp = screen.getByTestId('viewport');
    fireEvent.dragEnter(vp, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireEvent.dragEnter(vp, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();
    fireEvent.dragLeave(vp, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('a failed upload shows Upload failed; the other uploads carry on', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    drop([png('small.png')]);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve({ kind: 'failed', status: 500 }));
    expect(images(doc)[0].status).toBe('failed');
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
  });

  it('adding is one undo step; the upload finishing adds none', async () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    render(<ImageHarness doc={doc} connection="connected" undo={undo} />);
    drop([png('a.png'), png('b.png'), png('c.png')]);
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => pending[0].resolve({ kind: 'ok', assetKey: KEY() }));
    act(() => {
      expect(undo.undo()).toBe(true);
    });
    expect(images(doc)).toEqual([]);
    expect(undo.canUndo()).toBe(false);
    // Uploads finishing after the undo change nothing.
    await act(async () => pending[1].resolve({ kind: 'ok', assetKey: KEY() }));
    expect(images(doc)).toEqual([]);
    undo.destroy();
  });
});

describe('paste (image.paste)', () => {
  it('TC-18: paste while editing sticky text adds nothing; paste on the focused board adds the image centred in view', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" withEditor />);
    const editor = screen.getByLabelText('Note text');
    editor.focus();
    const ev = paste(editor, [png('shot.png')]);
    expect(ev).toBe(true); // not prevented: the editor pastes as before
    await act(async () => {});
    expect(images(doc)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();

    const vp = screen.getByTestId('viewport');
    vp.focus();
    expect(paste(vp, [png('shot.png')])).toBe(false);
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    const img = images(doc)[0];
    expect(img.x + img.width / 2).toBe(HARNESS_VIEW.width / 2);
    expect(img.y + img.height / 2).toBe(HARNESS_VIEW.height / 2);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a paste without image files is ignored', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    const vp = screen.getByTestId('viewport');
    vp.focus();
    expect(paste(vp, [])).toBe(true);
    await act(async () => {});
    expect(images(doc)).toEqual([]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('picker (image.pick)', () => {
  it('opens the file input filtered to the accepted types; chosen files are centred in a row', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="confirmed" />);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByText('Pick'));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { files: [png('a.png'), png('b.png')] } });
    await waitFor(() => expect(images(doc)).toHaveLength(2));
    const [a, b] = [...images(doc)].sort((p, q) => p.x - q.x);
    expect((a.x + b.x + b.width) / 2).toBe(HARNESS_VIEW.width / 2);
    expect(b.x - (a.x + a.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });

  it('offline: the picker does not open and the offline message shows', () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connecting" />);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByText('Pick'));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(REJECTION_MESSAGES.offline);
  });
});

describe('refusals', () => {
  it('TC-19: reconnecting then drop → offline toast; no objects; upload not called', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="reconnecting" />);
    drop([png('small.png')]);
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent("You're offline — images can be added when you reconnect.");
    expect(images(doc)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('TC-29: createImageBitmap rejects for a corrupt file → type toast, no placeholder', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    drop([png('corrupt.png')]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(REJECTION_MESSAGES.type));
    expect(images(doc)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('a renamed PDF is refused by content; the PNG in the same drop is still added', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    drop([new File([PDF_BYTES], 'doc.png', { type: 'image/png' }), png('small.png')]);
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent(REJECTION_MESSAGES.type);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('more than IMAGE_MAX_FILES_PER_ADD files → first 20 added and the count message', async () => {
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="connected" />);
    drop(Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_, i) => png(`s${i}.png`)));
    await waitFor(() => expect(images(doc)).toHaveLength(IMAGE_MAX_FILES_PER_ADD));
    expect(screen.getByRole('status')).toHaveTextContent(REJECTION_MESSAGES.count);
    expect(upload.mock.calls.map((c) => c[1].name)).toEqual(
      Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_, i) => `s${i}.png`),
    );
  });

  it('the message toast goes away after TOAST_DURATION_MS, or when dismissed', () => {
    vi.useFakeTimers();
    const doc = newDoc();
    render(<ImageHarness doc={doc} connection="reconnecting" />);
    drop([png('small.png')]);
    expect(screen.getByRole('status')).toHaveTextContent(REJECTION_MESSAGES.offline);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
    drop([png('small.png')]);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Image tool on the board (image.pick)', () => {
  it('the toolbar has an Image (I) button; I and the button open the picker only when connected', async () => {
    const { renderApp, keyDown } = await import('./helpers');
    renderApp(); // component tests never connect: the board stays "Connecting…"
    const button = screen.getByRole('button', { name: 'Image (I)' });
    expect(button).toHaveAttribute('title', 'Image (I)');
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    keyDown(document.body, 'i');
    expect(screen.getByText(REJECTION_MESSAGES.offline)).toBeInTheDocument();
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    // The Image tool is a one-shot action: Select stays the active tool.
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
