import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { initDoc, snapshotAll, type ObjectSnapshot, type ImageSnap } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import type { UploadResult } from '../../src/client/images/uploadImage';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

interface UploadCall {
  boardId: string;
  file: File;
  onProgress(fraction: number): void;
  resolve(result: UploadResult): void;
}

const mocks = vi.hoisted(() => ({
  upload: null as null | ((boardId: string, file: File, handlers: {
    onProgress(fraction: number): void;
    onDone(result: { ok: true; assetKey: string; contentType: string } | { ok: false }): void;
  }) => { abort(): void })
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (
    boardId: string,
    file: File,
    handlers: {
      onProgress(fraction: number): void;
      onDone(result: { ok: true; assetKey: string; contentType: string } | { ok: false }): void;
    }
  ) => mocks.upload!(boardId, file, handlers)
}));

const uploads: UploadCall[] = [];
let bitmapImpl: (file: File) => Promise<{ width: number; height: number }> = () =>
  Promise.resolve({ width: 100, height: 50 });

interface Reg {
  doc: Y.Doc;
  selection: SelectionApi;
}
let registry: MutableRefObject<Reg | null> = { current: null };

function Harness(props: { connection?: ConnectionState; canEdit?: boolean }): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;
  const [notes, setNotes] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const observer = (): void => setNotes(snapshotAll(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  const selection = useSelection(notes);
  registry.current = { doc, selection };
  return (
    <BoardViewport
      doc={doc}
      notes={notes}
      selection={selection}
      editable={props.canEdit !== false}
      boardId="test-board"
      connection={props.connection ?? 'connected'}
    />
  );
}

const ctrl = (): Reg => registry.current!;
const objects = (): readonly ObjectSnapshot[] => snapshotAll(ctrl().doc);
const images = (): ImageSnap[] => objects().filter((obj): obj is ImageSnap => obj.type === 'image');
const viewport = (): HTMLElement => screen.getByTestId('board-viewport');
const halfW = (): number => window.innerWidth / 2;
const halfH = (): number => window.innerHeight / 2;

function makeFile(name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2])], name, { type: 'image/png' });
}

// jsdom has no DataTransfer constructor; a minimal structural stand-in is all
// the handlers read (files and types).
interface FakeTransfer {
  files: File[];
  items: { add(file: File): void };
  types: string[];
  dropEffect: string;
}

function transfer(files: File[]): FakeTransfer {
  return {
    files: [...files],
    items: { add: () => undefined },
    types: files.length > 0 ? ['Files'] : [],
    dropEffect: 'none'
  };
}

// fireEvent's event map drops clientX and dataTransfer for drag events, so the
// properties are attached to a plain bubbling event the React handlers read.
function fireBoardEvent(type: string, init: { dataTransfer?: FakeTransfer; clientX?: number; clientY?: number }): void {
  const element = viewport();
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value });
  }
  act(() => {
    element.dispatchEvent(event);
  });
}

async function dropFiles(files: File[], x = 100, y = 80): Promise<void> {
  fireBoardEvent('drop', { dataTransfer: transfer(files), clientX: x, clientY: y });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function pasteFiles(files: File[], target: Node | Window = window): Promise<void> {
  const dt = transfer(files);
  await act(async () => {
    fireEvent.paste(target, { clipboardData: dt });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  registry = { current: null };
  uploads.length = 0;
  bitmapImpl = () => Promise.resolve({ width: 100, height: 50 });
  globalThis.createImageBitmap = ((file: Blob) => bitmapImpl(file as File)) as typeof globalThis.createImageBitmap;
  mocks.upload = () => ({ abort: () => undefined });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('image.insert component flows (story 12)', () => {
  test('TC-17 drop three files: row of placeholders from the drop point, progress, then ready', async () => {
    render(<Harness />);
    mocks.upload = (boardId, file, handlers) => {
      uploads.push({
        boardId,
        file,
        onProgress: handlers.onProgress,
        resolve: (result) => handlers.onDone(result)
      });
      return { abort: () => undefined };
    };
    await dropFiles([makeFile('a.png'), makeFile('b.png'), makeFile('c.png')], 100, 80);

    const placed = images();
    expect(placed.length).toBe(3);
    // Drop point (100, 80) maps to world (100 − halfW, 80 − halfH) at the
    // default camera; tops aligned, left to right with the layout gap.
    const sorted = [...placed].sort((a, b) => a.x - b.x);
    expect(sorted[0]!.x).toBeCloseTo(100 - halfW(), 5);
    expect(sorted[0]!.y).toBeCloseTo(80 - halfH(), 5);
    expect(sorted[1]!.x).toBeCloseTo(sorted[0]!.x + sorted[0]!.width + IMAGE_LAYOUT_GAP_WORLD, 5);
    expect(sorted[2]!.x).toBeCloseTo(sorted[1]!.x + sorted[1]!.width + IMAGE_LAYOUT_GAP_WORLD, 5);
    expect(sorted.every((img) => img.status === 'uploading')).toBe(true);
    expect(uploads.length).toBe(3);
    expect(uploads.every((call) => call.boardId === 'test-board')).toBe(true);

    act(() => {
      uploads[0]!.onProgress(0.5);
    });
    const progressTexts = screen.getAllByTestId(/image-progress-/);
    expect(progressTexts.map((node) => node.textContent)).toContain('50%');

    await act(async () => {
      uploads[0]!.resolve({ ok: true, assetKey: 'board/asset', contentType: 'image/png' });
      uploads[1]!.resolve({ ok: true, assetKey: 'board/asset', contentType: 'image/png' });
      uploads[2]!.resolve({ ok: true, assetKey: 'board/asset', contentType: 'image/png' });
      await Promise.resolve();
    });
    const ready = images();
    expect(ready.every((img) => img.status === 'ready')).toBe(true);
    const imgs = document.querySelectorAll('img[data-testid^="image-bitmap-"]');
    expect(imgs.length).toBe(3);
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe('/api/assets/board/asset');
  });

  test('drop highlight shows while files are dragged over the board only', () => {
    render(<Harness />);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    const files = transfer([makeFile('a.png')]);
    fireBoardEvent('dragenter', { dataTransfer: files });
    fireBoardEvent('dragover', { dataTransfer: files });
    expect(screen.getByTestId('drop-highlight')).toBeDefined();
    fireBoardEvent('dragleave', { dataTransfer: files });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    const text = transfer([]);
    // A drag without files never triggers the highlight.
    fireBoardEvent('dragenter', { dataTransfer: text });
    fireBoardEvent('dragleave', { dataTransfer: text });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  test('TC-18 paste in a text field is ignored; paste on the board centres the image', async () => {
    render(<Harness />);
    mocks.upload = (boardId, file, handlers) => {
      uploads.push({ boardId, file, onProgress: handlers.onProgress, resolve: (r) => handlers.onDone(r) });
      return { abort: () => undefined };
    };
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    await pasteFiles([makeFile('a.png')], textarea);
    expect(images().length).toBe(0);
    expect(uploads.length).toBe(0);
    document.body.removeChild(textarea);

    await pasteFiles([makeFile('b.png')]);
    expect(images().length).toBe(1);
    // 'centre' anchor: the row is centred on the view centre (world origin).
    const img = images()[0]!;
    expect(img.x).toBeCloseTo(-img.width / 2, 5);
    expect(img.y).toBeCloseTo(-img.height / 2, 5);
  });

  test('TC-19 reconnecting: drop shows the offline toast and adds nothing', async () => {
    render(<Harness connection="reconnecting" />);
    mocks.upload = (boardId, file, handlers) => {
      uploads.push({ boardId, file, onProgress: handlers.onProgress, resolve: (r) => handlers.onDone(r) });
      return { abort: () => undefined };
    };
    await dropFiles([makeFile('a.png')]);
    expect(images().length).toBe(0);
    expect(uploads.length).toBe(0);
    expect(screen.getByTestId('image-toast').textContent).toBe(REJECTION_MESSAGES.offline);
  });

  test('TC-29 undecodable file gets the type toast and no placeholder', async () => {
    render(<Harness />);
    bitmapImpl = () => Promise.reject(new Error('corrupt'));
    mocks.upload = (boardId, file, handlers) => {
      uploads.push({ boardId, file, onProgress: handlers.onProgress, resolve: (r) => handlers.onDone(r) });
      return { abort: () => undefined };
    };
    await dropFiles([makeFile('corrupt.png')]);
    expect(images().length).toBe(0);
    expect(uploads.length).toBe(0);
    expect(screen.getByTestId('image-toast').textContent).toBe(REJECTION_MESSAGES.type);
  });

  test('21 valid files: the first 20 are added with the count toast; mixed batch toasts type', async () => {
    render(<Harness />);
    mocks.upload = (boardId, file, handlers) => {
      uploads.push({ boardId, file, onProgress: handlers.onProgress, resolve: (r) => handlers.onDone(r) });
      return { abort: () => undefined };
    };
    const many = Array.from({ length: 21 }, (_, i) => makeFile(`f${i}.png`));
    await dropFiles(many);
    expect(images().length).toBe(20);
    const toastTexts = screen.getAllByTestId('image-toast').map((node) => node.textContent);
    expect(toastTexts).toContain(REJECTION_MESSAGES.count);

    cleanup();
    registry = { current: null };
    render(<Harness />);
    const pdf = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    await dropFiles([pdf, makeFile('ok.png')]);
    expect(images().length).toBe(1);
    expect(screen.getByTestId('image-toast').textContent).toBe(REJECTION_MESSAGES.type);
  });
});
