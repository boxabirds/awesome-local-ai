/**
 * Story 12: the image insert flow (TC-17 to TC-24).
 *
 * A harness component runs `useImageInsert` against a real Y.Doc with an
 * identity camera; the upload is mocked at the module boundary (a
 * controllable stand-in for `uploadImage`) and `createImageBitmap` is
 * stubbed to read the dimensions from the file name (`<w>x<h>`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useMemo } from 'react';
import * as Y from 'yjs';
import { useImageInsert, type ImageInsert } from 'src/client/images/useImageInsert';
import { ToastHost } from 'src/client/ui/Toast';
import { allObjects } from 'src/shared/board-model';
import type { ConnectionState } from 'src/client/sync/connectBoard';
import { IMAGE_MAX_BYTES } from 'src/shared/config';
import type { UploadResult } from 'src/client/images/uploadImage';
import { makeJpegOfSize } from '../fixtures/images';

const { uploads } = vi.hoisted(() => ({
  uploads: [] as Array<{
    file: File;
    progress: (f: number) => void;
    resolve: (r: UploadResult) => void;
  }>,
}));

vi.mock('src/client/images/uploadImage', () => ({
  uploadImage: (_boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolveFn: (r: UploadResult) => void = () => {};
    const promise = new Promise<UploadResult>((r) => {
      resolveFn = r;
    });
    uploads.push({
      file,
      progress: (f: number) => onProgress(f),
      resolve: (r: UploadResult) => resolveFn(r),
    });
    return { promise, abort: () => {} };
  },
}));

beforeEach(() => {
  uploads.length = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      const m = /(\d+)x(\d+)/.exec(file.name);
      return {
        width: m ? Number(m[1]) : 100,
        height: m ? Number(m[2]) : 100,
        close: () => {},
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface HarnessOut {
  doc?: Y.Doc;
  insert?: ImageInsert;
}

function Harness(props: {
  out: HarnessOut;
  connection?: ConnectionState;
  viewSize?: { width: number; height: number };
}): React.JSX.Element {
  // The doc must survive re-renders (progress ticks re-render the harness).
  const doc = useMemo(() => new Y.Doc(), []);
  const insert = useImageInsert({
    doc,
    boardId: 'abcdefghijklmnopqrstuv',
    camera: { x: 0, y: 0, zoom: 1 },
    viewSize: props.viewSize ?? { width: 800, height: 600 },
    connection: props.connection ?? 'connected',
    identityId: 'uploader',
    boundary: () => {},
  });
  props.out.doc = doc;
  props.out.insert = insert;
  return (
    <>
      <div
        data-testid="board-viewport"
        onDragEnter={insert.onDragEnter}
        onDragOver={insert.onDragOver}
        onDragLeave={insert.onDragLeave}
        onDrop={insert.onDrop}
      />
      <ToastHost />
    </>
  );
}

// jsdom has no DataTransfer/DragEvent/ClipboardEvent: a plain object with the
// props the hook reads (types / files / dropEffect / clipboardData.files).
function makeDataTransfer(files: File[]) {
  return {
    types: ['Files'],
    files,
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function fileFromName(name: string, type = 'image/png', size?: number): File {
  if (size !== undefined) {
    const b = makeJpegOfSize(size);
    return new File([b.buffer as ArrayBuffer], name, { type });
  }
  // Full 8-byte PNG signature (the sniff needs it).
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes.buffer as ArrayBuffer], name, { type });
}

function fireDrag(el: Element, type: string, files: File[], clientX = 100, clientY = 50): void {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: makeDataTransfer(files) });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function dropOn(el: Element, files: File[], clientX = 100, clientY = 50): void {
  fireDrag(el, 'drop', files, clientX, clientY);
}

function firePaste(files: File[]): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: makeDataTransfer(files) });
  act(() => {
    window.dispatchEvent(ev);
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function imageObjects(doc: Y.Doc) {
  return allObjects(doc).filter((o) => o.type === 'image');
}

describe('TC-17: drop a PNG → placeholder at the drop point → progress → ready', () => {
  it('placeholder at drop point, progress reported, ready with assetKey on completion', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    dropOn(viewport, [fileFromName('shot-1440x900.png')], 100, 50);
    await flush();

    expect(out.doc).toBeDefined();
    const objs = imageObjects(out.doc!);
    expect(objs).toHaveLength(1);
    expect(objs[0].x).toBe(100);
    expect(objs[0].y).toBe(50);
    expect(objs[0].width).toBe(800); // longest side scaled to 800
    expect(objs[0].height).toBe(500);
    expect(objs[0].status).toBe('uploading');
    expect(objs[0].uploaderId).toBe('uploader');

    // Progress flows into the hook's progress map.
    act(() => {
      uploads[0].progress(0.5);
    });
    expect(out.insert!.progress.get(objs[0].id)).toBe(0.5);

    act(() => {
      uploads[0].resolve({ kind: 'ok', assetKey: 'abcdefghijklmnopqrstuv/assetkey1234567890abcd' });
    });
    await flush();
    const ready = imageObjects(out.doc!)[0];
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('abcdefghijklmnopqrstuv/assetkey1234567890abcd');
    expect(out.insert!.progress.has(ready.id)).toBe(false);
  });

  it('drag enter/leave toggles dragActive (the drop highlight)', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    fireDrag(viewport, 'dragenter', [fileFromName('a-10x10.png')]);
    expect(out.insert!.dragActive).toBe(true);
    fireDrag(viewport, 'dragleave', [fileFromName('a-10x10.png')]);
    expect(out.insert!.dragActive).toBe(false);
  });
});

describe('TC-18: multiple files drop left to right in a row, 24 world units apart', () => {
  it('places a row starting at the drop point', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    dropOn(
      viewport,
      [fileFromName('a-300x200.png'), fileFromName('b-100x400.png')],
      10,
      20,
    );
    await flush();

    const objs = imageObjects(out.doc!).sort((a, b) => a.x - b.x);
    expect(objs).toHaveLength(2);
    expect(objs[0].x).toBe(10);
    expect(objs[0].y).toBe(20);
    expect(objs[0].width).toBe(300);
    expect(objs[0].height).toBe(200);
    expect(objs[1].x).toBe(10 + 300 + 24);
    expect(objs[1].y).toBe(20); // top-aligned
    expect(objs[1].width).toBe(100);
    expect(objs[1].height).toBe(400);
  });
});

describe('TC-19: paste a screenshot → centred in the visible area', () => {
  it('places the image centred on the view', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} viewSize={{ width: 800, height: 600 }} />);
    firePaste([fileFromName('screenshot-1440x900.png')]);
    await flush();

    const objs = imageObjects(out.doc!);
    expect(objs).toHaveLength(1);
    // 800x500 centred in an 800x600 view → (0, 50).
    expect(objs[0].x).toBe(0);
    expect(objs[0].y).toBe(50);
  });
});

describe('TC-20: paste while editing a note’s text → no image added', () => {
  it('ignores the paste when a text control has focus', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    firePaste([fileFromName('shot-1440x900.png')]);
    await flush();

    expect(imageObjects(out.doc!)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});

describe('TC-21: file over 10 MB → refused with the size toast', () => {
  it('adds nothing and shows the size toast', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    dropOn(viewport, [fileFromName('big.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1)]);
    await flush();

    expect(imageObjects(out.doc!)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(screen.getByText('Images must be 10 MB or smaller.')).toBeDefined();
  });
});

describe('TC-22: more than 20 files → only the first 20 added, count toast', () => {
  it('adds exactly 20 and shows the count toast', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    const files = Array.from({ length: 25 }, (_, i) => fileFromName(`img-${i}-100x100.png`));
    dropOn(viewport, files);
    await flush();

    expect(imageObjects(out.doc!)).toHaveLength(20);
    expect(uploads).toHaveLength(20);
    expect(screen.getByText('Only 20 images can be added at once.')).toBeDefined();
  });
});

describe('TC-23: upload failure → failed state with retry (and 415 → type toast)', () => {
  it('failed upload shows failed status; retry restarts the upload', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    dropOn(viewport, [fileFromName('shot-1440x900.png')]);
    await flush();
    const id = imageObjects(out.doc!)[0].id;

    act(() => {
      uploads[0].resolve({ kind: 'failed', status: 500 });
    });
    await flush();
    expect(imageObjects(out.doc!)[0].status).toBe('failed');
    expect(out.insert!.canRetry(id)).toBe(true);

    act(() => {
      out.insert!.retry(id);
    });
    await flush();
    expect(imageObjects(out.doc!)[0].status).toBe('uploading');
    expect(uploads).toHaveLength(2);

    act(() => {
      uploads[1].resolve({ kind: 'ok', assetKey: 'abcdefghijklmnopqrstuv/retriedkey1234567890abcd' });
    });
    await flush();
    expect(imageObjects(out.doc!)[0].status).toBe('ready');
  });

  it('a 415 response surfaces the unsupported-type toast', async () => {
    const out: HarnessOut = {};
    render(<Harness out={out} />);
    const viewport = screen.getByTestId('board-viewport');
    dropOn(viewport, [fileFromName('shot-1440x900.png')]);
    await flush();
    expect(imageObjects(out.doc!)[0].status).toBe('uploading');

    act(() => {
      uploads[0].resolve({ kind: 'failed', status: 415 });
    });
    await flush();
    expect(imageObjects(out.doc!)[0].status).toBe('failed');
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeDefined();
  });
});

describe('TC-24: offline (not connected/confirmed) → offline toast, nothing added', () => {
  it.each(['connecting', 'reconnecting'] as const)(
    'connection "%s" blocks the insert with the offline toast',
    async (connection) => {
      const out: HarnessOut = {};
      render(<Harness out={out} connection={connection} />);
      const viewport = screen.getByTestId('board-viewport');
      dropOn(viewport, [fileFromName('shot-1440x900.png')]);
      await flush();

      expect(imageObjects(out.doc!)).toHaveLength(0);
      expect(uploads).toHaveLength(0);
      expect(screen.getByText("You're offline — images can be added when you reconnect.")).toBeDefined();
    },
  );
});
