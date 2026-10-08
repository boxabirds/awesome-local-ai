/**
 * ImageObject component tests (story 12, task 8).
 *
 * Test cases:
 * - image.state_uploader: uploading state with progress (uploader sees bar)
 * - image.state_viewer: "Uploading…" for non-uploader
 * - image.state_failed: red border, "Upload failed", Retry + Remove
 * - image.state_retryable: retry button present when canRetry is true
 * - image.state_unretryable: retry button absent, remove only
 * - image.state_unfinished: "Image upload didn't finish" + Remove
 * - image.state_unavailable: grey box, broken-image icon, "Image unavailable"
 * - image.state_ready: renders <img> with asset key URL
 * - image.state_ready_load_error: on error, shows unavailable state
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { ImageInsertContext, type ImageInsertContextValue } from '../../src/client/images/ImageContext';
import type { ObjectProps } from '../../src/client/objects/registry';
import type { ImageSnap } from '../../src/shared/objects/image';
import { initDoc } from '../../src/shared/board-model';

/** Create a minimal ImageSnap for tests. */
function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img_test1234567890',
    type: 'image',
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 800,
    naturalHeight: 600,
    status: 'uploading',
    uploadStartedAt: 1000000,
    uploaderId: 'client-uploader',
    ...overrides,
  } as ImageSnap;
}

/** Create a real Y.Doc with the image entry so imageSnapshot() can read it. */
function makeDoc(image: ImageSnap): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects');
  const entry = new Y.Map();
  entry.set('type', 'image');
  entry.set('x', image.x);
  entry.set('y', image.y);
  entry.set('width', image.width);
  entry.set('height', image.height);
  entry.set('z', image.z);
  entry.set('assetKey', image.assetKey);
  entry.set('contentType', image.contentType);
  entry.set('naturalWidth', image.naturalWidth);
  entry.set('naturalHeight', image.naturalHeight);
  entry.set('status', image.status);
  entry.set('uploadStartedAt', image.uploadStartedAt);
  entry.set('uploaderId', image.uploaderId);
  entry.set('createdAt', 0);
  objects.set(image.id, entry);
  return doc;
}

/** Standard ObjectProps for tests. */
function makeProps(image: ImageSnap): ObjectProps {
  return {
    doc: makeDoc(image),
    obj: image as never,
    selected: false,
    editingId: null,
    onPointerDown: () => {},
    onEdit: () => {},
    onEndEdit: () => {},
    onTextBoundary: () => {},
    onTextUndo: () => {},
    onBoundary: () => {},
    inert: false,
    camera: { x: 0, y: 0, zoom: 1 } as never,
    objects: [],
  };
}

/** Wrap the ImageObject in a context provider. */
function renderImage(
  image: ImageSnap,
  ctxOverrides: Partial<ImageInsertContextValue> = {},
) {
  const ctx: ImageInsertContextValue = {
    uploaderId: 'client-uploader',
    progress: new Map(),
    canRetry: () => false,
    retry: () => {},
    remove: () => {},
    now: 1000500, // 500ms after uploadStartedAt (within the 30s window)
    ...ctxOverrides,
  };

  return render(
    <ImageInsertContext.Provider value={ctx}>
      <ImageObject {...makeProps(image)} />
    </ImageInsertContext.Provider>,
  );
}

describe('ImageObject', () => {
  it('image.state_uploader: uploading state with progress (uploader)', () => {
    const image = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: 1000000,
      uploaderId: 'client-uploader',
    });
    renderImage(image, {
      progress: new Map([['img_test1234567890', 0.65]]),
    });

    expect(screen.getByTestId('image-uploading')).toBeTruthy();
    expect(screen.getByTestId('image-progress')).toBeTruthy();
    expect(screen.getByTestId('image-progress-text').textContent).toBe('65%');
  });

  it('image.state_viewer: "Uploading…" for non-uploader', () => {
    const image = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: 1000000,
      uploaderId: 'somebody-else',
    });
    renderImage(image);

    expect(screen.getByTestId('image-uploading')).toBeTruthy();
    expect(screen.getByTestId('image-uploading-text').textContent).toBe('Uploading…');
  });

  it('image.state_failed: red border, "Upload failed", Retry + Remove (uploader)', () => {
    const image = makeImageSnap({
      status: 'failed',
      uploadStartedAt: 1000000,
      uploaderId: 'client-uploader',
    });
    renderImage(image, {
      canRetry: () => true,
    });

    expect(screen.getByTestId('image-failed')).toBeTruthy();
    expect(screen.getByTestId('image-failed-text').textContent).toBe('Upload failed');
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('image.state_retryable: retry button present when canRetry is true', () => {
    const image = makeImageSnap({
      status: 'failed',
      uploadStartedAt: 1000000,
      uploaderId: 'client-uploader',
    });
    renderImage(image, {
      canRetry: () => true,
    });

    expect(screen.getByTestId('image-retry')).toBeTruthy();
  });

  it('image.state_unretryable: retry button absent, remove only', () => {
    const image = makeImageSnap({
      status: 'failed',
      uploadStartedAt: 1000000,
      uploaderId: 'client-uploader',
    });
    renderImage(image, {
      canRetry: () => false,
    });

    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('image.state_unfinished: shows "Image upload didn\'t finish" + Remove', () => {
    // IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000 = 300000
    // now=1000500, uploadStartedAt=600000 → diff=400500 > 300000
    const image = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: 600000,
      uploaderId: 'client-uploader',
    });
    renderImage(image, {
      now: 1000500,
    });

    expect(screen.getByTestId('image-unfinished')).toBeTruthy();
    expect(screen.getByTestId('image-unfinished-text').textContent).toBe(
      'Image upload didn\'t finish',
    );
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('image.state_unavailable: non-uploader sees failed as unavailable', () => {
    const image = makeImageSnap({
      status: 'failed',
      uploadStartedAt: 1000000,
      uploaderId: 'somebody-else',
    });
    renderImage(image);

    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });

  it('image.state_ready: renders <img> with asset key URL', () => {
    const image = makeImageSnap({
      status: 'ready',
      uploadStartedAt: 1000000,
      assetKey: 'board12345678901234/img_test1234567890',
      uploaderId: 'client-uploader',
    });
    renderImage(image);

    const ready = screen.getByTestId('image-ready');
    const img = ready.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(
      '/api/assets/board12345678901234/img_test1234567890',
    );
  });

  it('image.state_ready_load_error: on error, shows unavailable state', () => {
    const image = makeImageSnap({
      status: 'ready',
      uploadStartedAt: 1000000,
      assetKey: 'board12345678901234/img_test1234567890',
      uploaderId: 'client-uploader',
    });
    const { container } = renderImage(image);

    // Initially ready
    expect(screen.getByTestId('image-ready')).toBeTruthy();

    // Trigger the img's onError
    const img = container.querySelector('img')!;
    act(() => {
      fireEvent.error(img);
    });

    // Now should show unavailable
    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });
});
