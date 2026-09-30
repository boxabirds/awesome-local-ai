// Story 12 — image.insert flows in jsdom with a real Y.Doc: TC-17, TC-18, TC-19, TC-29.
// uploadImage is mocked with controllable progress; createImageBitmap is stubbed.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { Toast } from '../../src/client/ui/Toast';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { createSticky, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { type ImageSnap, isImage } from '../../src/shared/objects/image';
import { flushFrame } from './helpers';
import { type FakeUpload, filesTransfer, imageFile, stubCreateImageBitmap } from './image-test-utils';

const uploads = vi.hoisted(() => [] as FakeUpload[]);
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: FakeUpload['resolve'];
    const promise = new Promise<Parameters<FakeUpload['resolve']>[0]>((r) => (resolve = r));
    const abort = vi.fn();
    uploads.push({ boardId, file, onProgress, resolve, abort });
    return { promise, abort };
  }),
}));

const SIZES = {
  'a.png': { width: 400, height: 300 },
  'b.jpg': { width: 1600, height: 1200 },
  'c.gif': { width: 100, height: 100 },
};

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const images = (doc: Y.Doc) => objectsSnapshot(doc).filter(isImage) as ImageSnap[];
const imageEl = (id: string) => document.querySelector(`[data-image-object][data-id="${id}"]`) as HTMLElement;

function renderBoard(doc: Y.Doc) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  render(<App doc={doc} />);
  act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom: 1 }));
  flushFrame();
}

beforeEach(() => {
  uploads.length = 0;
  stubCreateImageBitmap(SIZES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('drop (TC-17)', () => {
  it('3 files → 3 placeholders in a row from the drop point; progress updates; ready after the upload resolves', async () => {
    const doc = newDoc();
    renderBoard(doc);
    const viewport = screen.getByTestId('board-viewport');
    const files = [imageFile('a.png'), imageFile('b.jpg', 'image/jpeg'), imageFile('c.gif', 'image/gif')];
    fireEvent.dragEnter(viewport, { dataTransfer: filesTransfer(files) });
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    fireEvent.drop(viewport, { dataTransfer: filesTransfer(files), clientX: 100, clientY: 150 });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    await waitFor(() => expect(uploads).toHaveLength(3));

    const placed = images(doc).sort((p, q) => p.x - q.x);
    expect(placed.map((i) => [i.width, i.height])).toEqual([
      [400, 300],
      [800, 600],
      [100, 100],
    ]);
    expect(placed.map((i) => i.y)).toEqual([150, 150, 150]);
    expect(placed[0]!.x).toBe(100);
    expect(placed[1]!.x).toBe(100 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed[2]!.x).toBe(placed[1]!.x + 800 + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed.every((i) => i.status === 'uploading')).toBe(true);
    expect(uploads.map((u) => u.file.name)).toEqual(['a.png', 'b.jpg', 'c.gif']);

    // Placeholders keep the files' order: a.png is the leftmost.
    const first = placed[0]!;
    const el = imageEl(first.id);
    expect(el.style.width).toBe('400px');
    expect(el.textContent).toContain('0%');
    act(() => uploads[0]!.onProgress(0.42));
    expect(el.textContent).toContain('42%');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');

    await act(async () => uploads[0]!.resolve({ kind: 'ok', assetKey: 'boardboardboardboard00/assetassetassetasset0' }));
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/assets/boardboardboardboard00/assetassetassetasset0');
    expect(img.alt).toBe('Image');
    expect(images(doc).find((i) => i.id === first.id)?.status).toBe('ready');
    // The others are still uploading.
    expect(images(doc).filter((i) => i.status === 'uploading')).toHaveLength(2);
  });

  it('a drag of something other than files shows no highlight and adds nothing', () => {
    const doc = newDoc();
    renderBoard(doc);
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.dragEnter(viewport, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireEvent.drop(viewport, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(images(doc)).toHaveLength(0);
  });

  it('refused files are explained; supported ones in the same drop are still added', async () => {
    const doc = newDoc();
    renderBoard(doc);
    const viewport = screen.getByTestId('board-viewport');
    const files = [imageFile('a.png'), imageFile('doc.pdf', 'application/pdf'), imageFile('x.svg', 'image/svg+xml')];
    fireEvent.drop(viewport, { dataTransfer: filesTransfer(files), clientX: 10, clientY: 10 });
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(images(doc)).toHaveLength(1);
    expect(screen.getByTestId('toast').textContent).toBe(REJECTION_MESSAGES.type);
    expect(screen.getByTestId('toast').getAttribute('role')).toBe('status');
  });

  it('adding images is one undo step', async () => {
    const doc = newDoc();
    renderBoard(doc);
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.drop(viewport, { dataTransfer: filesTransfer([imageFile('a.png'), imageFile('c.gif', 'image/gif')]), clientX: 0, clientY: 0 });
    await waitFor(() => expect(images(doc)).toHaveLength(2));
    await act(async () => uploads[0]!.resolve({ kind: 'ok', assetKey: 'k/1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(images(doc)).toHaveLength(0);
  });
});

describe('paste (TC-18)', () => {
  it('pasting while editing sticky text adds no image; pasting on the board adds one centred in view', async () => {
    const doc = newDoc();
    createSticky(doc, { x: 300, y: 300 });
    renderBoard(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    fireEvent.doubleClick(note);
    const editor = await screen.findByRole('textbox');
    editor.focus();
    const png = imageFile('a.png');
    const pasteInEditor = fireEvent.paste(editor, { clipboardData: filesTransfer([png]) });
    // The editor keeps its own paste (default not prevented) and nothing is added.
    expect(pasteInEditor).toBe(true);
    await act(async () => {});
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);

    fireEvent.keyDown(editor, { key: 'Escape' });
    editor.blur();
    const viewport = screen.getByTestId('board-viewport');
    viewport.focus();
    fireEvent.paste(viewport, { clipboardData: filesTransfer([png]) });
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    const [img] = images(doc);
    // jsdom's window is 1024×768: the view centre is world (512, 384) at this camera.
    expect(img!.x + img!.width / 2).toBe(window.innerWidth / 2);
    expect(img!.y + img!.height / 2).toBe(window.innerHeight / 2);
    expect(uploads).toHaveLength(1);
  });

  it('a paste without files is ignored', () => {
    const doc = newDoc();
    renderBoard(doc);
    const result = fireEvent.paste(screen.getByTestId('board-viewport'), { clipboardData: { files: [], types: ['text/plain'] } });
    expect(result).toBe(true);
    expect(images(doc)).toHaveLength(0);
  });
});

function Harness(props: { doc: Y.Doc; connection: ConnectionState }) {
  const insert = useImageInsert({
    doc: props.doc,
    boardId: 'b',
    camera: { x: 0, y: 0, zoom: 1 },
    connection: props.connection,
    identityId: 'me',
  });
  return (
    <>
      <div data-testid="target" onDrop={insert.onDrop} onDragOver={insert.onDragOver} />
      <button type="button" onClick={insert.openPicker}>
        Image
      </button>
      <Toast messages={insert.messages} />
    </>
  );
}

describe('offline (TC-19)', () => {
  it.each(['reconnecting', 'connecting', 'load_failed'] as const)('%s: drop → offline toast, no objects, no upload', async (connection) => {
    const doc = newDoc();
    const { uploadImage } = await import('../../src/client/images/uploadImage');
    render(<Harness doc={doc} connection={connection} />);
    fireEvent.drop(screen.getByTestId('target'), { dataTransfer: filesTransfer([imageFile('a.png')]) });
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe("You're offline — images can be added when you reconnect.");
    expect(images(doc)).toHaveLength(0);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('reconnecting: the picker is not opened, the offline toast shows', () => {
    const doc = newDoc();
    render(<Harness doc={doc} connection="reconnecting" />);
    const input = document.querySelector('[data-testid="image-file-input"]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(REJECTION_MESSAGES.offline);
  });

  it('confirmed (just reconnected) counts as online', async () => {
    const doc = newDoc();
    render(<Harness doc={doc} connection="confirmed" />);
    fireEvent.drop(screen.getByTestId('target'), { dataTransfer: filesTransfer([imageFile('a.png')]) });
    await waitFor(() => expect(images(doc)).toHaveLength(1));
  });
});

describe('decode failure (TC-29)', () => {
  it('createImageBitmap rejects for a corrupt file → type toast, no placeholder', async () => {
    const doc = newDoc();
    render(<Harness doc={doc} connection="connected" />);
    fireEvent.drop(screen.getByTestId('target'), { dataTransfer: filesTransfer([imageFile('truncated.png')]) });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(REJECTION_MESSAGES.type));
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});

describe('picker', () => {
  it('the Image button opens a multi-file picker filtered to the accepted types; chosen files are centred in view', async () => {
    const doc = newDoc();
    renderBoard(doc);
    const input = document.querySelector('[data-testid="image-file-input"]') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'i' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    Object.defineProperty(input, 'files', { configurable: true, value: [imageFile('a.png'), imageFile('c.gif', 'image/gif')] });
    fireEvent.change(input);
    await waitFor(() => expect(images(doc)).toHaveLength(2));
    const placed = images(doc).sort((p, q) => p.x - q.x);
    const left = placed[0]!.x;
    const right = placed[1]!.x + placed[1]!.width;
    expect((left + right) / 2).toBe(window.innerWidth / 2);
  });
});
