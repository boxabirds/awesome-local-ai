/**
 * Component tests for the image insert hook (story 12, image.insert).
 * TC-17 to TC-19, TC-29.
 *
 * `uploadImage` is mocked (module) and `createImageBitmap` is stubbed globally,
 * so the flows run in jsdom without a real network or image decoder.
 */
import { useState, useEffect, type JSX } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, act } from '@testing-library/react';
import { initDoc, objects } from '../../src/shared/board-model';
import { useImageInsert, type ImageInsert } from '../../src/client/images/useImageInsert';
import { Toast } from '../../src/client/ui/Toast';
import { getObjectType } from '../../src/client/objects/registry';
import { ImageContext } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import type { UploadResult } from '../../src/client/images/uploadImage';

// Controllable uploadImage mock (module-level, hoisted).
const { mockUploadImpl } = vi.hoisted(() => ({
  mockUploadImpl: {
    current: null as null | (
      (boardId: string, file: File, onProgress: (f: number) => void) => {
        promise: Promise<UploadResult>;
        abort(): void;
      }
    ),
  },
}));
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (
    boardId: string,
    file: File,
    onProgress: (f: number) => void,
  ): { promise: Promise<UploadResult>; abort(): void } =>
    mockUploadImpl.current!(boardId, file, onProgress),
}));

// Controllable createImageBitmap mock (global).
const { mockBitmapImpl } = vi.hoisted(() => ({
  mockBitmapImpl: {
    current: null as null | ((file: File) => Promise<{ width: number; height: number; close(): void }>),
  },
}));

function file(name: string, type: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

let lastInsert: ImageInsert | null = null;
function Harness(props: {
  doc: Y.Doc;
  boardId: string;
  connection: 'connected' | 'confirmed' | 'reconnecting';
}): JSX.Element {
  const insert = useImageInsert({
    doc: props.doc,
    boardId: props.boardId,
    camera: { x: 0, y: 0, zoom: 1 },
    connection: props.connection,
    identityId: 'me',
  });
  lastInsert = insert;
  // Re-render on every doc update so the inserted objects appear.
  const [, setVersion] = useState(0);
  useEffect(() => {
    const cb = () => setVersion((v) => v + 1);
    props.doc.on('update', cb);
    return () => {
      props.doc.off('update', cb);
    };
  }, [props.doc]);
  const snapshot = objects(props.doc);
  const ctx = {
    progress: insert.progress,
    identityId: 'me',
    now: Date.now(),
    canRetry: insert.canRetry,
    retry: insert.retry,
    remove: () => {},
  };
  return (
    <>
      <ImageContext.Provider value={ctx}>
        <div>
          {snapshot.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const C = spec.Component;
            return (
              <C
                key={obj.id}
                obj={obj}
                doc={props.doc}
                zoom={1}
                selected={false}
                editing={false}
                onObjectPointerDown={() => {}}
                onStartEdit={() => {}}
                onEndEdit={() => {}}
              />
            );
          })}
        </div>
      </ImageContext.Provider>
      <Toast items={insert.toasts} />
    </>
  );
}

function dropEvent(files: File[], x = 100, y = 100) {
  return {
    clientX: x,
    clientY: y,
    dataTransfer: { files } as unknown as DataTransfer,
    preventDefault() {},
  };
}

function pasteEvent(files: File[]) {
  return {
    clipboardData: { files } as unknown as DataTransfer,
    preventDefault() {},
  };
}

describe('image.insert: useImageInsert', () => {
  let doc: Y.Doc;
  let pendingUploads: Array<{ resolve(r: UploadResult): void }>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    lastInsert = null;
    pendingUploads = [];
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = (f: File) =>
      mockBitmapImpl.current!(f);
  });

  afterEach(() => {
    delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
  });

  // A mock upload that reports 50% immediately and resolves on demand.
  function controlledUploads() {
    mockUploadImpl.current = (_boardId, _f, onProgress) => {
      onProgress(0.5);
      let resolve: (r: UploadResult) => void = () => {};
      const promise = new Promise<UploadResult>((r) => {
        resolve = r;
      });
      pendingUploads.push({ resolve });
      return { promise, abort() {} };
    };
  }

  // TC-17: drop 3 files → 3 placeholders in a row; progress updates; ready.
  it('TC-17: dropping 3 files creates a row, shows progress, then ready', async () => {
    mockBitmapImpl.current = () => Promise.resolve({ width: 400, height: 300, close() {} });
    controlledUploads();
    render(<Harness doc={doc} boardId="board" connection="connected" />);

    await act(async () => {
      lastInsert!.onDrop(dropEvent([file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')]));
      await flush();
    });

    let imgs = objects(doc) as unknown as ImageSnap[];
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img.status).toBe('uploading');
      expect(img.uploaderId).toBe('me');
    }
    // In a row: tops aligned at the drop y, x increasing by width + gap.
    const xs = imgs.map((i) => i.x).sort((a, b) => a - b);
    const ys = imgs.map((i) => i.y);
    expect(ys.every((y) => y === 100)).toBe(true);
    expect(xs[0]).toBe(100);
    expect(xs[1]).toBe(100 + 400 + 24);
    expect(xs[2]).toBe(100 + 400 + 24 + 400 + 24);
    // Progress text is 50% for each of the three images.
    const labels = screen.getAllByTestId('image-progress-label');
    expect(labels).toHaveLength(3);
    for (const label of labels) expect(label).toHaveTextContent('50%');

    // Resolve the uploads → ready.
    await act(async () => {
      for (const u of pendingUploads) u.resolve({ kind: 'ok', assetKey: 'b/a' });
      await flush();
    });
    imgs = objects(doc) as unknown as ImageSnap[];
    for (const img of imgs) {
      expect(img.status).toBe('ready');
      expect(img.assetKey).toBe('b/a');
    }
  });

  // TC-18: paste while editing text → no image; paste while board focused → centred.
  it('TC-18: paste inserts only when the board has focus, centred', async () => {
    mockBitmapImpl.current = () => Promise.resolve({ width: 400, height: 300, close() {} });
    controlledUploads();
    render(<Harness doc={doc} boardId="board" connection="connected" />);

    // While a text field has focus: no image.
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    await act(async () => {
      lastInsert!.onPaste(pasteEvent([file('a.png', 'image/png')]));
      await flush();
    });
    expect(objects(doc)).toHaveLength(0);
    ta.remove();

    // Board focused (body): one image, centred on the view centre.
    document.body.focus();
    await act(async () => {
      lastInsert!.onPaste(pasteEvent([file('a.png', 'image/png')]));
      await flush();
    });
    const imgs = objects(doc) as unknown as ImageSnap[];
    expect(imgs).toHaveLength(1);
    // View centre for a 1024x768 window at identity camera is (512, 384).
    const img = imgs[0]!;
    const centreX = img.x + img.width / 2;
    const centreY = img.y + img.height / 2;
    expect(centreX).toBeCloseTo(512, 0);
    expect(centreY).toBeCloseTo(384, 0);
  });

  // TC-19: offline (reconnecting) → offline toast, no objects, no upload.
  it('TC-19: while reconnecting, a drop shows the offline toast and adds nothing', async () => {
    mockBitmapImpl.current = () => Promise.resolve({ width: 100, height: 100, close() {} });
    controlledUploads();
    render(<Harness doc={doc} boardId="board" connection="reconnecting" />);

    await act(async () => {
      lastInsert!.onDrop(dropEvent([file('a.png', 'image/png')]));
      await flush();
    });

    expect(objects(doc)).toHaveLength(0);
    expect(pendingUploads).toHaveLength(0);
    expect(screen.getByText("You're offline — images can be added when you reconnect.")).toBeDefined();
  });

  // TC-29: createImageBitmap rejects → type toast, no placeholder.
  it('TC-29: a file that fails to decode shows the type toast and adds nothing', async () => {
    mockBitmapImpl.current = () => Promise.reject(new Error('decode failed'));
    controlledUploads();
    render(<Harness doc={doc} boardId="board" connection="connected" />);

    await act(async () => {
      lastInsert!.onDrop(dropEvent([file('a.png', 'image/png')]));
      await flush();
    });

    expect(objects(doc)).toHaveLength(0);
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeDefined();
  });

  // A failing upload marks the object failed (uploader can retry).
  it('a failed upload marks the object failed', async () => {
    mockBitmapImpl.current = () => Promise.resolve({ width: 100, height: 100, close() {} });
    mockUploadImpl.current = () => ({
      promise: Promise.resolve({ kind: 'failed', status: 500 }),
      abort() {},
    });
    render(<Harness doc={doc} boardId="board" connection="connected" />);

    await act(async () => {
      lastInsert!.onDrop(dropEvent([file('a.png', 'image/png')]));
      await flush();
    });
    const imgs = objects(doc) as unknown as ImageSnap[];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].status).toBe('failed');
    // The uploader can retry (file kept in memory).
    expect(lastInsert!.canRetry(imgs[0].id)).toBe(true);
  });

});
