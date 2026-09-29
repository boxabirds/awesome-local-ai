/**
 * Component (jsdom) tests for the image insertion flows: TC-17 to TC-20, TC-29.
 *
 * The hook is mounted by a small harness that also renders every image object of
 * the doc through the registry component, so one drop can be asserted end to end:
 * the doc *and* the placeholder the user sees. `uploadImage` is mocked (the flows
 * are under test, not the network) and `createImageBitmap` is stubbed, because
 * jsdom cannot decode images.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useRef, useSyncExternalStore, type JSX } from 'react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshotAll, type ObjectSnapshot } from '../../src/shared/board-model';
import { IMAGE_ACCEPTED_TYPES, IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_BYTES } from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { ImageBoardObject } from '../../src/client/objects/ImageObject';
import { DropHighlight } from '../../src/client/images/DropHighlight';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { clearToasts, ToastHost } from '../../src/client/ui/Toast';
import { resetUploadQueue } from '../../src/client/images/uploadQueue';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { pdfBytes, pngBytes } from '../fixtures/imageBytes';

// --- uploadImage mock --------------------------------------------------------
const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) =>
    uploadMock(boardId, file, onProgress),
  assetUrlFor: (key: string) => `/api/assets/${key}`,
}));

interface RecordedUpload {
  boardId: string;
  file: File;
  /** Push a progress tick, as the browser's XHR would. */
  progress(fraction: number): void;
  /** Settle the upload, as the server's response would. */
  settle(result: UploadResult): void;
}

let recorded: RecordedUpload[] = [];
/** What the next upload should do; 'pending' leaves it in flight. */
let nextBehaviour: 'pending' | UploadResult = 'pending';
let decodeShouldFail = false;

const BITMAP_SIZES = new Map<string, { width: number; height: number }>();

beforeEach(() => {
  recorded = [];
  nextBehaviour = 'pending';
  decodeShouldFail = false;
  BITMAP_SIZES.clear();

  uploadMock.mockImplementation((boardId: string, file: File, onProgress: unknown) => {
    let settle: (result: UploadResult) => void = () => undefined;
    const promise = new Promise<UploadResult>((resolve) => {
      settle = resolve;
    });
    const entry: RecordedUpload = {
      boardId,
      file,
      progress: (fraction) => (onProgress as (value: number) => void)(fraction),
      settle: (result) => settle(result),
    };
    recorded.push(entry);
    if (nextBehaviour !== 'pending') settle(nextBehaviour);
    return {
      promise,
      abort() {
        settle({ kind: 'aborted' });
      },
    };
  });

  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (decodeShouldFail) throw new Error('unsupported image data');
      const size = BITMAP_SIZES.get(file.name) ?? { width: 640, height: 480 };
      return { width: size.width, height: size.height, close() {} } as unknown as ImageBitmap;
    }),
  );
});

afterEach(() => {
  cleanup();
  clearToasts();
  resetUploadQueue();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- fixtures and helpers ----------------------------------------------------
const BOARD_ID = 'b'.repeat(22);

function pngFile(name = 'shot.png'): File {
  return new File([pngBytes(8, 6)], name, { type: 'image/png' });
}

function transferOf(files: File[]): DataTransfer {
  return {
    files,
    types: files.length > 0 ? ['Files'] : [],
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function imageObjects(doc: Y.Doc): ImageSnap[] {
  return snapshotAll(doc).filter((o) => o.type === 'image') as unknown as ImageSnap[];
}

/** The rendered placeholder of one object. */
function placeholder(id: string): HTMLElement {
  const el = document.querySelector(`[data-image-id="${id}"]`);
  if (!el) throw new Error(`placeholder for ${id} is not rendered`);
  return el as HTMLElement;
}

function progressText(id: string): HTMLElement {
  return within(placeholder(id)).getByTestId('image-progress-text');
}

function drop(files: File[], at = { x: 120, y: 90 }): void {
  fireBoardEvent('drop', document.body, {
    dataTransfer: transferOf(files),
    clientX: at.x,
    clientY: at.y,
  });
}

function paste(files: File[], target: EventTarget = document.body): void {
  fireBoardEvent('paste', target, { clipboardData: transferOf(files) });
}

/** Live image snapshots of a doc (invalidated by any objects-map change). */
function useImageSnapshots(doc: Y.Doc): readonly ObjectSnapshot[] {
  const cache = useRef<readonly ObjectSnapshot[] | null>(null);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap('objects');
      const observer = () => {
        cache.current = null;
        onStoreChange();
      };
      objects.observeDeep(observer);
      return () => objects.unobserveDeep(observer);
    },
    [doc],
  );
  const getSnapshot = useCallback(() => {
    if (cache.current === null) {
      cache.current = snapshotAll(doc).filter((o) => o.type === 'image');
    }
    return cache.current;
  }, [doc]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * jsdom has no DragEvent / ClipboardEvent data, so drag and paste events are
 * built by hand: a plain cancelable Event with `dataTransfer` (and the drop
 * point) assigned onto it — exactly what the handlers read.
 */
function fireBoardEvent(type: string, target: EventTarget, props: Record<string, unknown>): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  act(() => {
    target.dispatchEvent(event);
  });
}

function Harness(props: {
  doc: Y.Doc;
  connection?: ConnectionState;
  boardId?: string;
}): JSX.Element {
  const images = useImageInsert({
    doc: props.doc,
    boardId: props.boardId ?? BOARD_ID,
    connection: props.connection ?? 'connected',
    toWorld: (point) => point,
    viewportCentreWorld: () => ({ x: 512, y: 384 }),
    getBoardRect: () => null,
  });
  const objects = useImageSnapshots(props.doc);

  return (
    <div>
      <ToastHost />
      <DropHighlight visible={images.highlight} />
      {objects.map((obj) => (
        <ImageBoardObject
          key={obj.id}
          obj={obj}
          doc={props.doc}
          zoom={1}
          selected={false}
          editing={false}
          readOnly={false}
          onObjectPointerDown={() => undefined}
          onStartEdit={() => undefined}
          onEndEdit={() => undefined}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TC-17: drop three files
// ---------------------------------------------------------------------------
describe('TC-17: dropping three files', () => {
  it('places three placeholders in a row, reports progress, then becomes ready', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);

    BITMAP_SIZES.set('a.png', { width: 200, height: 100 });
    BITMAP_SIZES.set('b.png', { width: 100, height: 100 });
    BITMAP_SIZES.set('c.png', { width: 300, height: 150 });

    drop([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')], { x: 40, y: 60 });

    await waitFor(() => expect(imageObjects(doc)).toHaveLength(3));
    expect(recorded).toHaveLength(3);
    expect(recorded[0].boardId).toBe(BOARD_ID);

    // Left to right, tops aligned at the drop point, one gap between neighbours.
    const [a, b, c] = imageObjects(doc);
    expect(a.x).toBeCloseTo(40);
    expect(b.x).toBeCloseTo(40 + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(c.x).toBeCloseTo(40 + 200 + 100 + 2 * IMAGE_LAYOUT_GAP_WORLD);
    expect([a.y, b.y, c.y]).toEqual([60, 60, 60]);
    expect(a.width).toBeCloseTo(200);
    expect(a.height).toBeCloseTo(100);

    expect(screen.getAllByTestId('image-uploading')).toHaveLength(3);

    act(() => {
      recorded[0].progress(0.5);
    });
    await waitFor(() => expect(progressText(a.id)).toHaveTextContent('50%'));
    // The other two have not reported anything yet.
    expect(progressText(b.id)).toHaveTextContent('0%');

    act(() => {
      recorded[0].settle({ kind: 'ok', assetKey: `${BOARD_ID}/${'a'.repeat(22)}` });
    });
    await waitFor(() => expect(imageObjects(doc)[0].status).toBe('ready'));
    expect(imageObjects(doc)[0].assetKey).toBe(`${BOARD_ID}/${'a'.repeat(22)}`);
    // The others are still uploading, in the same place.
    expect(screen.getAllByTestId('image-uploading')).toHaveLength(2);

    doc.destroy();
  });

  it('highlights the board while files are dragged over it', () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);

    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireBoardEvent('dragenter', document.body, { dataTransfer: transferOf([pngFile()]) });
    fireBoardEvent('dragover', document.body, { dataTransfer: transferOf([pngFile()]) });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();
    fireBoardEvent('dragleave', document.body, { dataTransfer: transferOf([pngFile()]) });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-18: paste
// ---------------------------------------------------------------------------
describe('TC-18: pasting an image', () => {
  it('adds it centred in the visible area when the board has focus', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);
    BITMAP_SIZES.set('shot.png', { width: 640, height: 480 });

    paste([pngFile('shot.png')]);

    await waitFor(() => expect(imageObjects(doc)).toHaveLength(1));
    const [img] = imageObjects(doc);
    // Centred on (512, 384): a 640 x 480 image starts at 192 / 144.
    expect(img.x).toBeCloseTo(192);
    expect(img.y).toBeCloseTo(144);

    doc.destroy();
  });

  it('leaves the paste to the text editor when one has focus', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);

    paste([pngFile('shot.png')], editor);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(imageObjects(doc)).toHaveLength(0);
    expect(recorded).toHaveLength(0);

    editor.remove();
    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-19: offline
// ---------------------------------------------------------------------------
describe('TC-19: adding images while reconnecting', () => {
  it('explains, adds nothing and uploads nothing', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} connection="reconnecting" />);

    drop([pngFile(), pngFile('other.png')]);

    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.offline)).toBeInTheDocument());
    expect(imageObjects(doc)).toHaveLength(0);
    expect(uploadMock).not.toHaveBeenCalled();

    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-20: the server says "too quickly"
// ---------------------------------------------------------------------------
describe('TC-20: a rate limited upload', () => {
  it('marks the object failed and explains why', async () => {
    const doc = new Y.Doc();
    nextBehaviour = { kind: 'rate_limited' };
    render(<Harness doc={doc} />);

    // The picker path: a file chosen through the hidden input.
    const input = document.querySelector(
      '[data-testid="image-file-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.accept).toBe(IMAGE_ACCEPTED_TYPES.join(','));
    expect(input?.multiple).toBe(true);

    Object.defineProperty(input, 'files', { value: [pngFile('picked.png')], configurable: true });
    act(() => {
      fireEvent.change(input as unknown as EventTarget);
    });

    await waitFor(() => expect(imageObjects(doc)).toHaveLength(1));
    await waitFor(() => expect(imageObjects(doc)[0].status).toBe('failed'));
    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.rate)).toBeInTheDocument());
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();

    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// TC-29: content that is not a decodable image, and files over the limit
// ---------------------------------------------------------------------------
describe('TC-29: files that cannot be added', () => {
  it('explains a renamed PDF that will not decode, and adds nothing', async () => {
    const doc = new Y.Doc();
    decodeShouldFail = true;
    render(<Harness doc={doc} />);

    drop([new File([pdfBytes()], 'renamed-pdf.png', { type: 'image/png' })]);

    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.type)).toBeInTheDocument());
    expect(imageObjects(doc)).toHaveLength(0);
    expect(recorded).toHaveLength(0);

    doc.destroy();
  });

  it('refuses a file over IMAGE_MAX_BYTES before uploading it', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);

    drop([new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'huge.png', { type: 'image/png' })]);

    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.size)).toBeInTheDocument());
    expect(imageObjects(doc)).toHaveLength(0);
    expect(recorded).toHaveLength(0);

    doc.destroy();
  });

  it('keeps the supported files of a mixed drop and explains the rest', async () => {
    const doc = new Y.Doc();
    render(<Harness doc={doc} />);

    drop([
      pngFile('good.png'),
      new File([pdfBytes()], 'deck.pdf', { type: 'application/pdf' }),
    ]);

    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.type)).toBeInTheDocument());
    await waitFor(() => expect(imageObjects(doc)).toHaveLength(1));
    expect(recorded).toHaveLength(1);

    doc.destroy();
  });
});

// ---------------------------------------------------------------------------
// Picker entry points (image.pick)
// ---------------------------------------------------------------------------
describe('picker wiring', () => {
  it('the Image button and the I key both open the file picker without leaving Select', () => {
    const doc = new Y.Doc();
    render(<App doc={doc} />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockClear();
    fireEvent.keyDown(window, { key: 'i' });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    expect(
      screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed'),
    ).toBe('true');

    clickSpy.mockRestore();
    doc.destroy();
  });
});
