import { act, fireEvent, render, screen } from '@testing-library/react';
import { useReducer, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import * as Yjs from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { createImagePlaceholders } from '../../src/shared/objects/image';
import { collectImageSnapshots, type ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  ImageObject,
  ImageControlsProvider,
  ImageObjectView
} from '../../src/client/objects/ImageObject';
import {
  useImageInsert,
  type ImageInsertController
} from '../../src/client/images/useImageInsert';
import { initialCamera } from './helpers';

const uploadImage = vi.hoisted(() => vi.fn());
vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage }));

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'i1',
    type: 'image',
    x: 10,
    y: 20,
    z: 1,
    width: 400,
    height: 300,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'ready',
    uploadStartedAt: 0,
    uploaderId: 'me',
    ...over
  };
}

beforeEach(() => {
  uploadImage.mockReset();
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 400, height: 300, close: () => undefined })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageObject states', () => {
  // TC-21: failed object — uploader gets Retry + Remove, anyone else sees
  // the unavailable box.
  it('TC-21 failed renders Retry/Remove for the uploader and unavailable for others', () => {
    const failed = snap({ status: 'failed' });
    const { unmount } = render(
      <ImageObject
        image={failed}
        isUploader
        canRetry
        now={0}
        onRetry={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    unmount();

    render(
      <ImageObject
        image={failed}
        isUploader={false}
        canRetry={false}
        now={0}
        onRetry={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // TC-22: a stale uploading placeholder shows the unfinished message and
  // Remove works for anyone.
  it('TC-22 stale upload shows unfinished and Remove deletes', () => {
    const now = Date.now();
    const stale = snap({
      status: 'uploading',
      uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1
    });
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={stale}
        isUploader={false}
        canRetry={false}
        now={now}
        onRetry={() => undefined}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // TC-23: a ready image whose file cannot be loaded swaps to the same-size
  // unavailable box.
  it('TC-23 img load error swaps to same-size unavailable box', () => {
    const ready = snap({ status: 'ready', assetKey: 'b1/gone.png' });
    const { container } = render(
      <ImageObject
        image={ready}
        isUploader={false}
        canRetry={false}
        now={0}
        onRetry={() => undefined}
        onRemove={() => undefined}
      />
    );
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    const box = screen.getByTestId('image-object') as HTMLElement;
    expect(box.style.width).toBe('400px');
    expect(box.style.height).toBe('300px');
  });

  // TC-24: Retry restarts the upload while the file is in memory; after a
  // "reload" (fresh hook) only Remove remains.
  it('TC-24 retry with file in memory, Remove only after reload', async () => {
    const doc: Y.Doc = new Yjs.Doc();
    initDoc(doc);
    let controller: ImageInsertController | null = null;
    let bump: (() => void) | null = null;

    function Harness(): JSX.Element {
      const [, force] = useReducer((n: number) => n + 1, 0);
      bump = force;
      controller = useImageInsert({
        doc,
        boardId: 'b1',
        camera: initialCamera(),
        connection: 'connected',
        identityId: 'me'
      });
      const snaps = collectImageSnapshots(doc);
      return (
        <ImageControlsProvider
          doc={doc}
          controls={{
            identityId: 'me',
            progress: (id) => controller!.progress.get(id),
            canRetry: controller!.canRetry,
            retry: (id) => {
              controller!.retry(id);
            }
          }}
        >
          {snaps.map((s) => (
            <ImageObjectView
              key={s.id}
              obj={s}
              doc={doc}
              zoom={1}
              selected={false}
              editing={false}
              editable
              onObjectPointerDown={() => undefined}
              onStartEdit={() => undefined}
              onEndEdit={() => undefined}
            />
          ))}
        </ImageControlsProvider>
      );
    }

    // First mount: the upload fails, so Retry and Remove appear.
    uploadImage.mockImplementation(() => ({
      promise: Promise.resolve({ kind: 'failed' as const }),
      abort: () => undefined
    }));
    render(<Harness />);
    await act(async () => {
      controller!.onDrop({
        preventDefault: () => undefined,
        clientX: 100,
        clientY: 100,
        dataTransfer: {
          types: ['Files'],
          files: [new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })]
        } as unknown as DataTransfer
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      bump!();
    });
    expect(collectImageSnapshots(doc)[0]!.status).toBe('failed');
    uploadImage.mockImplementation(() => ({
      promise: Promise.resolve({ kind: 'ok' as const, assetKey: 'b1/retry.png' }),
      abort: () => undefined
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => {
      bump!();
    });
    const retried = collectImageSnapshots(doc)[0]!;
    expect(retried.status).toBe('ready');
    expect(retried.assetKey).toBe('b1/retry.png');
    expect(uploadImage).toHaveBeenCalledTimes(2);

    // Simulated reload: a fresh view without a provider has no in-memory
    // file, so Retry disappears and Remove deletes the object.
    const reloaded = new Yjs.Doc();
    initDoc(reloaded);
    const [, ...rest] = createImagePlaceholders(
      reloaded,
      [{ rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' }],
      'me',
      Date.now() - IMAGE_UPLOAD_STALE_MS - 1000
    );
    void rest;
    const failedSnap = collectImageSnapshots(reloaded)[0]!;
    render(
      <ImageObjectView
        obj={failedSnap}
        doc={reloaded}
        zoom={1}
        selected={false}
        editing={false}
        editable
        onObjectPointerDown={() => undefined}
        onStartEdit={() => undefined}
        onEndEdit={() => undefined}
      />
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(collectImageSnapshots(reloaded)).toHaveLength(0);
  });
});
