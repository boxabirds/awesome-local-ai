import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { deleteObjects, initDoc, snapshotAll, type ImageSnap } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady
} from '../../src/shared/objects/image';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { ImageInsertContext, type ImageInsertContextValue } from '../../src/client/images/ImageInsertContext';
import { getObjectType } from '../../src/client/objects/registry';
import { getSessionId } from '../../src/client/session';

function setup(): { doc: Y.Doc; add: () => string } {
  const doc = new Y.Doc();
  initDoc(doc);
  return {
    doc,
    add: () => {
      const ids = createImagePlaceholders(
        doc,
        [{ rect: { x: 10, y: 20, width: 200, height: 120 }, naturalWidth: 200, naturalHeight: 120, contentType: 'image/png' }],
        getSessionId(),
        Date.now()
      );
      return ids[0]!;
    }
  };
}

function snapOf(doc: Y.Doc, id: string): ImageSnap {
  const found = snapshotAll(doc).find((obj) => obj.id === id);
  if (found === undefined || found.type !== 'image') throw new Error(`image ${id} missing`);
  return found as ImageSnap;
}

function renderImage(
  doc: Y.Doc,
  id: string,
  insert: Partial<ImageInsertContextValue> = {},
  editable = true
): void {
  const value: ImageInsertContextValue = {
    getProgress: () => null,
    retry: () => undefined,
    canRetry: () => false,
    ...insert
  };
  render(
    <ImageInsertContext.Provider value={value}>
      <ImageObject
        obj={snapOf(doc, id)}
        doc={doc}
        zoom={1}
        selected={false}
        dragging={false}
        editing={false}
        editable={editable}
        onStartEdit={() => undefined}
        onEndEdit={() => undefined}
        onObjectPointerDown={() => undefined}
      />
    </ImageInsertContext.Provider>
  );
}

afterEach(() => {
  cleanup();
});

describe('image.object render states (story 12)', () => {
  test('TC-21 failed: uploader gets Upload failed with Retry and Remove, others get Image unavailable', () => {
    const { doc, add } = setup();
    const id = add();
    markImageFailed(doc, id);
    renderImage(doc, id, { canRetry: () => true });
    expect(screen.getByText('Upload failed')).toBeDefined();
    expect(screen.getByTestId('image-action-retry')).toBeDefined();
    expect(screen.getByTestId('image-action-remove')).toBeDefined();
    cleanup();

    // A different identity sees the neutral unavailable state.
    const other = new Y.Doc();
    initDoc(other);
    const otherId = createImagePlaceholders(
      other,
      [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' }],
      'someone-else',
      Date.now()
    )[0]!;
    markImageFailed(other, otherId);
    render(
      <ImageInsertContext.Provider value={{ getProgress: () => null, retry: () => undefined, canRetry: () => false }}>
        <ImageObject
          obj={snapOf(other, otherId)}
          doc={other}
          zoom={1}
          selected={false}
          dragging={false}
          editing={false}
          editable={true}
          onStartEdit={() => undefined}
          onEndEdit={() => undefined}
          onObjectPointerDown={() => undefined}
        />
      </ImageInsertContext.Provider>
    );
    expect(screen.getByText('Image unavailable')).toBeDefined();
    expect(screen.queryByText('Upload failed')).toBeNull();
  });

  test('TC-22 stale upload shows "didn\'t finish" with Remove that deletes the object', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 150, height: 100 }, naturalWidth: 150, naturalHeight: 100, contentType: 'image/png' }],
      'absent-uploader',
      Date.now() - IMAGE_UPLOAD_STALE_MS - 1000
    )[0]!;
    renderImage(doc, id);
    expect(screen.getByText("Image upload didn't finish")).toBeDefined();
    fireEvent.click(screen.getByTestId('image-action-remove'));
    expect(snapshotAll(doc).find((obj) => obj.id === id)).toBeUndefined();
  });

  test('TC-23 ready image that fails to load falls back to an unavailable box of the same size', () => {
    const { doc, add } = setup();
    const id = add();
    markImageReady(doc, id, 'board/asset');
    renderImage(doc, id);
    const img = screen.getByTestId(`image-bitmap-${id}`) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/assets/board/asset');
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeDefined();
    const root = screen.getByTestId(`image-${id}`) as HTMLElement;
    expect(root.style.width).toBe('200px');
    expect(root.style.height).toBe('120px');
  });

  test('TC-24 Retry with the file in memory re-runs the upload; without it only Remove shows', () => {
    const { doc, add } = setup();
    const id = add();
    markImageFailed(doc, id);
    const retry = vi.fn();
    renderImage(doc, id, { canRetry: () => true, retry });
    fireEvent.click(screen.getByTestId('image-action-retry'));
    expect(retry).toHaveBeenCalledWith(id);
    cleanup();

    // After a reload the File is gone: canRetry false hides Retry.
    renderImage(doc, id);
    expect(screen.queryByTestId('image-action-retry')).toBeNull();
    expect(screen.getByTestId('image-action-remove')).toBeDefined();
  });

  test('registry entry: aspect-locked, resizable, IMAGE_MIN_SIZE_WORLD floor, bbox hit test', () => {
    const spec = getObjectType('image')!;
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(true);
    expect(spec.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(false);
    const { doc, add } = setup();
    const id = add();
    const snap = snapOf(doc, id);
    expect(spec.hitTest(snap, { x: 110, y: 80 })).toBe(true);
    expect(spec.hitTest(snap, { x: 400, y: 400 })).toBe(false);
    deleteObjects(doc, [id]);
  });
});
