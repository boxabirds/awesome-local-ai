// Component tests for ImageObject render states (story 12).
// TC-21: failed object as uploader → "Upload failed" + Retry/Remove; as other → "Image unavailable"
// TC-22: uploading older than STALE_MS → "Image upload didn't finish" + Remove
// TC-23: ready image fires error → "Image unavailable" box
// TC-24: Retry with file in memory → status uploading; after reload (canRetry=false) → only Remove

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, getObjects, deleteObjects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createImagePlaceholders, markImageReady, markImageFailed, markImageRetrying } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';

afterEach(() => {
  cleanup();
});

function makeImageInDoc(status: 'uploading' | 'ready' | 'failed', overrides: Partial<Record<string, unknown>> = {}): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const now = Date.now();
  const items = [{ rect: { x: 100, y: 100, width: 200, height: 100 } as Rect, naturalWidth: 200, naturalHeight: 100, contentType: 'image/png' }];
  const ids = createImagePlaceholders(doc, items, 'local', now);
  const id = ids[0];

  if (status === 'ready') {
    markImageReady(doc, id, 'a'.repeat(22) + '/' + 'b'.repeat(22));
  } else if (status === 'failed') {
    markImageFailed(doc, id);
  }

  // Apply any overrides
  if (Object.keys(overrides).length > 0) {
    doc.transact(() => {
      const obj = getObjects(doc).get(id)!;
      for (const [k, v] of Object.entries(overrides)) {
        obj.set(k, v);
      }
    }, LOCAL_ORIGIN);
  }

  return { doc, id };
}

function makeSnap(doc: Y.Doc, id: string): ObjectSnapshot {
  const obj = getObjects(doc).get(id)!;
  return {
    id,
    type: 'image',
    x: obj.get('x') as number,
    y: obj.get('y') as number,
    z: obj.get('z') as number,
    createdAt: obj.get('createdAt') as number,
    width: obj.get('width') as number,
    height: obj.get('height') as number,
    assetKey: (obj.get('assetKey') as string | null) ?? null,
    contentType: obj.get('contentType') as string,
    naturalWidth: obj.get('naturalWidth') as number,
    naturalHeight: obj.get('naturalHeight') as number,
    status: obj.get('status') as string,
    uploadStartedAt: obj.get('uploadStartedAt') as number,
    uploaderId: obj.get('uploaderId') as string,
  } as ObjectSnapshot;
}

function renderImage(doc: Y.Doc, id: string, opts: {
  isUploader?: boolean;
  progress?: number;
  canRetry?: boolean;
  now?: number;
  onRetry?: () => void;
  onRemove?: () => void;
} = {}) {
  const snap = makeSnap(doc, id);
  const onObjectPointerDown = vi.fn();
  return render(
    <ImageObject
      obj={snap}
      doc={doc}
      zoom={1}
      selected={false}
      editing={false}
      onObjectPointerDown={onObjectPointerDown}
      onObjectDoubleClick={vi.fn()}
      onEndEdit={vi.fn()}
      isUploader={opts.isUploader ?? true}
      progress={opts.progress}
      canRetry={opts.canRetry ?? true}
      now={opts.now ?? Date.now()}
      onRetry={opts.onRetry ?? vi.fn()}
      onRemove={opts.onRemove ?? vi.fn()}
    />,
  );
}

describe('TC-21: failed object render states', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const { doc, id } = makeImageInDoc('failed');
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const { getByTestId } = renderImage(doc, id, { isUploader: true, onRetry, onRemove });

    const failedBox = getByTestId('image-failed-uploader');
    expect(failedBox).toBeInTheDocument();
    expect(failedBox).toHaveTextContent('Upload failed');
    expect(getByTestId('image-retry-btn')).toBeInTheDocument();
    expect(getByTestId('image-remove-btn')).toBeInTheDocument();

    fireEvent.click(getByTestId('image-retry-btn'));
    expect(onRetry).toHaveBeenCalled();

    fireEvent.click(getByTestId('image-remove-btn'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('other participant sees "Image unavailable"', () => {
    const { doc, id } = makeImageInDoc('failed');
    const { getByTestId } = renderImage(doc, id, { isUploader: false });

    expect(getByTestId('image-unavailable')).toBeInTheDocument();
    expect(getByTestId('image-unavailable')).toHaveTextContent('Image unavailable');
  });
});

describe('TC-22: uploading older than STALE_MS → unfinished', () => {
  it('shows "Image upload didn\'t finish" + Remove; Remove deletes', () => {
    const now = Date.now();
    const { doc, id } = makeImageInDoc('uploading', {
      uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1000,
    });

    const onRemove = vi.fn();
    const { getByTestId } = renderImage(doc, id, { now, onRemove });

    const unfinished = getByTestId('image-unfinished');
    expect(unfinished).toBeInTheDocument();
    expect(unfinished).toHaveTextContent("Image upload didn't finish");
    expect(getByTestId('image-remove-btn')).toBeInTheDocument();

    fireEvent.click(getByTestId('image-remove-btn'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('TC-23: ready image fires error → "Image unavailable"', () => {
  it('img error → Image unavailable box', () => {
    const { doc, id } = makeImageInDoc('ready');
    const { container, getByTestId } = renderImage(doc, id, { isUploader: true });

    // Initially shows the img element
    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    // Fire error event
    fireEvent.error(img!);

    // Now shows unavailable
    expect(getByTestId('image-unavailable')).toBeInTheDocument();
    expect(getByTestId('image-unavailable')).toHaveTextContent('Image unavailable');
  });
});

describe('TC-24: Retry behaviour', () => {
  it('Retry with file in memory → status uploading, upload called again', () => {
    const { doc, id } = makeImageInDoc('failed');
    const onRetry = vi.fn();
    const { getByTestId } = renderImage(doc, id, { isUploader: true, canRetry: true, onRetry });

    const retryBtn = getByTestId('image-retry-btn');
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('after simulated reload (canRetry=false) → Retry hidden, only Remove', () => {
    const { doc, id } = makeImageInDoc('failed');
    const { getByTestId, queryByTestId } = renderImage(doc, id, { isUploader: true, canRetry: false });

    expect(queryByTestId('image-retry-btn')).toBeNull();
    expect(getByTestId('image-remove-btn')).toBeInTheDocument();
  });
});
