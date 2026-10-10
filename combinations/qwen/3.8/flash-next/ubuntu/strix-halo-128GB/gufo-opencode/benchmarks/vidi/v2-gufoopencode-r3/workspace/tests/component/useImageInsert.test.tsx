import { act, render, screen } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { collectImageSnapshots } from '../../src/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import {
  useImageInsert,
  type ImageInsertController
} from '../../src/client/images/useImageInsert';
import { ToastHost, clearToasts } from '../../src/client/ui/Toast';
import { initialCamera } from './helpers';

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage }));

function pngFile(name = 'shot.png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
}

function dragEvent(files: File[], clientX = 100, clientY = 200) {
  return {
    preventDefault: vi.fn(),
    clientX,
    clientY,
    dataTransfer: {
      types: ['Files'],
      files
    } as unknown as DataTransfer
  };
}

function clipboardEvent(files: File[], target: EventTarget = document.body) {
  return {
    preventDefault: vi.fn(),
    target,
    clipboardData: { files } as unknown as DataTransfer
  };
}

let doc: Y.Doc;
let controller: ImageInsertController | null = null;
let connection: 'connected' | 'reconnecting' = 'connected';
let bump: (() => void) | null = null;

function mount(): void {
  doc = new Y.Doc();
  initDoc(doc);
  connection = 'connected';
  function Harness(): null {
    const [, force] = useReducer((n: number) => n + 1, 0);
    bump = force;
    controller = useImageInsert({
      doc,
      boardId: 'b1',
      camera: initialCamera(),
      connection,
      identityId: 'me'
    });
    return null;
  }
  render(
    <>
      <Harness />
      <ToastHost />
    </>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  uploadImage.mockReset();
  controller = null;
  mount();
  // jsdom has no createImageBitmap; stand in for the decoder.
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 400, height: 300, close: () => undefined })
  );
});

afterEach(() => {
  clearToasts();
  vi.unstubAllGlobals();
});

function deferredUpload() {
  let resolve!: (r: { kind: 'ok'; assetKey: string }) => void;
  const promise = new Promise<{ kind: 'ok'; assetKey: string }>((res) => {
    resolve = res;
  });
  uploadImage.mockImplementation(
    (_boardId: string, _file: File, onProgress: (f: number) => void) => {
      onProgress(0.5);
      return { promise, abort: () => undefined };
    }
  );
  return { resolve };
}

function resolveUpload(assetKey = 'b1/key1.png'): void {
  uploadImage.mockImplementation(
    (_boardId: string, _file: File, onProgress: (f: number) => void) => {
      onProgress(0.5);
      return {
        promise: Promise.resolve({ kind: 'ok' as const, assetKey }),
        abort: () => undefined
      };
    }
  );
}

describe('useImageInsert', () => {
  // TC-17: drop 3 files → 3 placeholders in a row, progress shown, ready
  // after the upload resolves.
  it('TC-17 drop places a row of placeholders and resolves them', async () => {
    const { resolve } = deferredUpload();
    await act(async () => {
      controller!.onDrop(dragEvent([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]));
    });
    await settle();
    const snaps = collectImageSnapshots(doc);
    expect(snaps).toHaveLength(3);
    expect(snaps.every((s) => s.status === 'uploading')).toBe(true);
    expect(snaps[0].x).toBeLessThan(snaps[1].x);
    expect(snaps[1]!.x).toBe(snaps[0]!.x + snaps[0]!.width! + IMAGE_LAYOUT_GAP_WORLD);
    expect(snaps[1].y).toBe(snaps[0].y);
    // progress (emitted by the mocked upload at 0.5) reaches the controller
    expect([...controller!.progress.values()].sort()).toEqual([0.5, 0.5, 0.5]);
    await act(async () => {
      resolve({ kind: 'ok', assetKey: 'b1/key1.png' });
    });
    await settle();
    const ready = collectImageSnapshots(doc);
    expect(ready.every((s) => s.status === 'ready' && s.assetKey === 'b1/key1.png')).toBe(true);
    expect(controller!.progress.size).toBe(0);
  });

  // TC-18: paste with an image adds one centred in view; pasting into a
  // text field creates nothing.
  it('TC-18 paste centred in view, skipped while editing text', async () => {
    resolveUpload();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    await act(async () => {
      controller!.onPaste(clipboardEvent([pngFile()], textarea));
    });
    await settle();
    expect(collectImageSnapshots(doc)).toHaveLength(0);

    const cam = initialCamera();
    const centreX = cam.x + window.innerWidth / 2 / cam.zoom;
    const centreY = cam.y + window.innerHeight / 2 / cam.zoom;
    await act(async () => {
      controller!.onPaste(clipboardEvent([pngFile()]));
    });
    await settle();
    const [img] = collectImageSnapshots(doc);
    expect(img).toBeDefined();
    expect(img!.x + img!.width! / 2).toBeCloseTo(centreX, 5);
    expect(img!.y + img!.height! / 2).toBeCloseTo(centreY, 5);
  });

  // TC-19: while reconnecting nothing is added and no upload starts.
  it('TC-19 offline drop shows the offline toast and uploads nothing', async () => {
    connection = 'reconnecting';
    act(() => {
      bump!();
    });
    await act(async () => {
      controller!.onDrop(dragEvent([pngFile()]));
    });
    await settle();
    expect(collectImageSnapshots(doc)).toHaveLength(0);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(
      screen.getByText("You're offline — images can be added when you reconnect.")
    ).toBeTruthy();
  });

  // TC-29: a file the browser cannot decode is refused with the type
  // message and never becomes a placeholder.
  it('TC-29 undecodable file gets the type toast and no placeholder', async () => {
    resolveUpload();
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('corrupt')));
    await act(async () => {
      controller!.onDrop(dragEvent([pngFile('broken.png')]));
    });
    await settle();
    expect(collectImageSnapshots(doc)).toHaveLength(0);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeTruthy();
  });
});
