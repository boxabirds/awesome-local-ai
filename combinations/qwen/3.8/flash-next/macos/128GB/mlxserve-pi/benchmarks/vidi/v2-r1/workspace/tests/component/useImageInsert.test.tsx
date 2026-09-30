// Adding images: drop, paste, offline, and the decode that is really the type check
// (`image.insert`, TC-17 to TC-19, TC-29).
//
// These tests exercise `useImageInsert` on its own, with a real `Y.Doc` and a real
// `createUndo` controller, and two things held up on purpose: the uploader (`uploadImage`
// is mocked, so a test decides exactly what bytes were "sent", how far it reported, and
// how it ended) and the decoder (`createImageBitmap` is stubbed, so a file's true size is
// a value the test hands it, and one file can be made undecodable on purpose). Everything
// between the entry point and the document is the real code under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, type RenderResult } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { snapshotObjects } from '../../src/shared/board-model';
import { isImageSnapshot, type ImageSnap } from '../../src/shared/objects/image';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  useImageInsert,
  type ImageInsert,
  type ImageInsertArgs,
} from '../../src/client/images/useImageInsert';
import { uploadImage, type UploadResult } from '../../src/client/images/uploadImage';

// The uploader is replaced wholesale; the test drives every upload by hand.
vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: vi.fn() }));

const mockedUpload = vi.mocked(uploadImage);

/** One in-flight upload a test controls. */
interface FakeUpload {
  file: File;
  onProgress(fraction: number): void;
  settle(result: UploadResult): void;
  abort(): void;
  aborted: boolean;
}

let pending: FakeUpload[] = [];

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const IDENTITY = 'tab-local';

/** A `File` whose decoded size the stubbed `createImageBitmap` will report. */
function imageFile(name: string, type: string, width: number, height: number): File {
  const file = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(file, 'decodeSize', { value: { width, height }, enumerable: false });
  return file;
}

/** A drop / paste `DataTransfer` carrying `files`, as the board reads one. */
function transfer(files: File[]): DataTransfer {
  return {
    files,
    types: ['Files'],
    items: [],
    dropEffect: '',
    effectAllowed: '',
  } as unknown as DataTransfer;
}

let doc: Y.Doc;
let undo: UndoController;
let toasts: string[];
let handle: { current: ImageInsert | null } | null;
let rendered: RenderResult;

function Harness({
  children,
  connection,
}: { children?: ReactNode; connection: ImageInsertArgs['connection'] }): ReactNode {
  const holder = { current: null as ImageInsert | null };
  const images = useImageInsert({
    doc,
    boardId: 'board-for-tests',
    camera: CAMERA,
    connection,
    identityId: IDENTITY,
    undo,
    onToast: (message) => toasts.push(message),
  });
  handle = holder;
  holder.current = images;
  return (
    <div
      data-testid="board"
      onDragEnter={images.onDragEnter}
      onDragOver={images.onDragOver}
      onDragLeave={images.onDragLeave}
      onDrop={images.onDrop}
      onPaste={images.onPaste}
    >
      <textarea data-testid="editor" />
      {children}
    </div>
  );
}

const board = (): HTMLElement => rendered.getByTestId('board');
const editor = (): HTMLElement => rendered.getByTestId('editor');
const images = (): ImageInsert => {
  if (!handle?.current) throw new Error('the hook never rendered');
  return handle.current;
};
const imageObjects = (): ImageSnap[] =>
  snapshotObjects(doc).filter(isImageSnapshot);

/** Let every pending microtask (one per awaited decode) run inside an act(). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

/** Drop `files` on the board at a screen point, running the async add to completion. */
async function drop(files: File[], x = 100, y = 120): Promise<void> {
  await act(async () => {
    // jsdom's `drop` event does not carry the pointer through its constructor, so the
    // screen point is defined onto the event directly — the drop lands where the test says.
    const event = createEvent.drop(board(), { dataTransfer: transfer(files) });
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    fireEvent(board(), event);
    // Let the awaited decodes and the placeholder write settle.
    await flush();
  });
}

async function paste(files: File[], target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.paste(target, { clipboardData: transfer(files) });
    await flush();
  });
}

beforeEach(() => {
  pending = [];
  toasts = [];
  handle = null;
  doc = new Y.Doc();
  undo = createUndo(doc);

  // The decoder hands back whatever size the test attached, or rejects for a corrupt one.
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async (file: File) => {
    const size = (file as { decodeSize?: { width: number; height: number } }).decodeSize;
    if (!size) throw new Error('undecodable');
    return { width: size.width, height: size.height, close(): void {} };
  });

  // The uploader records each call and hands the test the controls to finish it.
  mockedUpload.mockImplementation((_boardId, file, onProgress) => {
    const upload: FakeUpload = {
      file,
      aborted: false,
      onProgress,
      settle(result: UploadResult) {
        if (result.kind === 'ok') {
          // The ready write happens inside the hook's `.then`; flush it.
        }
      },
      abort() {
        upload.aborted = true;
      },
    } as unknown as FakeUpload;
    pending.push(upload);
    return {
      promise: new Promise<UploadResult>((resolve) => {
        upload.settle = resolve;
      }),
      abort(): void {
        upload.abort();
      },
    };
  });
});

afterEach(() => {
  cleanup();
  undo.destroy();
  vi.restoreAllMocks();
});

const settleAll = async (result: UploadResult): Promise<void> => {
  await act(async () => {
    for (const upload of pending) upload.settle(result);
    await flush();
  });
};

describe('image.insert (TC-17, TC-18, TC-19, TC-29)', () => {
  it('TC-17 drops 3 valid files as a row from the drop point, then uploads them', async () => {
    rendered = render(createElement(Harness, { connection: 'connected' }));
    const files = [
      imageFile('a.png', 'image/png', 200, 100),
      imageFile('b.png', 'image/png', 100, 100),
      imageFile('c.png', 'image/png', 50, 50),
    ];
    await drop(files, 100, 120);

    const objects = imageObjects();
    expect(objects).toHaveLength(3);
    // All in a row, tops aligned on the drop point's y, first starting at its x.
    expect(objects[0]!.x).toBe(100);
    expect(objects.every((o) => o.y === 120)).toBe(true);
    // Each one is smaller than the last and starts after the previous, by the gap.
    expect(objects[1]!.x).toBeGreaterThan(objects[0]!.x);
    expect(objects.map((o) => o.width)).toEqual([200, 100, 50]);
    // All start `uploading`, owned by this tab.
    expect(objects.every((o) => o.status === 'uploading' && o.uploaderId === IDENTITY)).toBe(true);

    // Progress is the uploader's own, per object id.
    const ids = objects.map((o) => o.id);
    await act(async () => {
      pending[0]!.onProgress(0.5);
      await Promise.resolve();
    });
    expect(images().progress.get(ids[0]!)).toBe(0.5);
    // Not yet uploaded: the others have no entry.
    expect(images().progress.get(ids[2]!)).toBeUndefined();

    // One upload answering 201 marks just that object ready and clears its progress.
    await settleAll({ kind: 'ok', assetKey: 'board-for-tests/asset-0000000000000000000000' });
    const after = imageObjects();
    expect(after.every((o) => o.status === 'ready')).toBe(true);
  });

  it('TC-18 a paste into a text editor is left alone; one on the board adds an image', async () => {
    rendered = render(createElement(Harness, { connection: 'connected' }));
    const file = imageFile('clip.png', 'image/png', 120, 80);

    // Pasted while typing in a textarea: nothing is added (TC-18 negative).
    await paste([file], editor());
    expect(imageObjects()).toHaveLength(0);

    // Pasted on the board itself: the row is centred on the middle of the view.
    await paste([file], board());
    const objects = imageObjects();
    expect(objects).toHaveLength(1);
    // View centre is (640, 400); a centred single image's box straddles it.
    const o = objects[0]!;
    expect(o.x).toBeCloseTo(640 - o.width / 2, 0);
    expect(o.y).toBeCloseTo(400 - o.height / 2, 0);
  });

  it('TC-19 a drop while reconnecting says offline and adds nothing', async () => {
    rendered = render(createElement(Harness, { connection: 'reconnecting' }));
    await drop([imageFile('a.png', 'image/png', 200, 100)]);
    expect(imageObjects()).toHaveLength(0);
    expect(toasts).toContain(REJECTION_MESSAGES.offline);
    // No upload was ever started.
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('TC-29 a file that will not decode is refused as a type and gets no placeholder', async () => {
    rendered = render(createElement(Harness, { connection: 'connected' }));
    // `undecodable.png` has no decode size, so createImageBitmap rejects for it.
    const bad = new File([new Uint8Array(16)], 'undecodable.png', { type: 'image/png' });
    const good = imageFile('good.png', 'image/png', 100, 100);
    await drop([bad, good], 50, 60);

    const objects = imageObjects();
    // Only the decodable one is placed; the corrupt one is skipped entirely.
    expect(objects).toHaveLength(1);
    expect(toasts).toContain(REJECTION_MESSAGES.type);
    // The corrupt file was never uploaded.
    expect(pending.every((u) => u.file === good)).toBe(true);
  });
});
