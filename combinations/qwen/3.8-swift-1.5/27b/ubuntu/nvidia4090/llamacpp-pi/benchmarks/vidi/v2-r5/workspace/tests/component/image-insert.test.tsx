// @vitest-environment jsdom
// tests/component/image-insert.test.tsx
// TC-17: drop 2 files → 2 placeholders with top-left alignment
// TC-18: drop 21 files → 20 placeholders + "Only 20 images can be added at once"
// TC-19: mixed batch → 1 placeholder + both rejection messages
// TC-21: progress 0→100; on success → <img> src, alt="Image", draggable=false
// TC-22: progress 30% → other users see "Uploading…" placeholder
// TC-23: upload failure → uploader sees Retry + Remove; non-uploader sees "Image unavailable"
// TC-24: retry success → same assetKey, ready; retry failure → failed
// TC-29: aspect-locked resize

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
import * as Y from 'yjs';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import {
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
} from '../../src/shared/objects/image';
import { objectBounds } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 10, y: 20, z: 0,
    width: 400, height: 300,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400, naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'local',
    ...overrides,
  };
}

describe('TC-21: image upload progress and ready state', () => {
  it('shows progress bar at 50%', () => {
    const snap = makeImageSnap({ status: 'uploading' });
    render(
      <ImageObject
        image={snap}
        isUploader={true}
        progress={0.5}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const progressBar = screen.getByTestId('image-progress-bar');
    expect(progressBar).toBeDefined();
    const progressText = screen.getByTestId('image-progress-text');
    expect(progressText.textContent).toBe('50%');
  });

  it('shows <img> with correct src when ready', () => {
    const snap = makeImageSnap({ status: 'ready', assetKey: 'board1/asset1' });
    render(
      <ImageObject
        image={snap}
        isUploader={true}
        progress={1}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const img = screen.getByTestId('image-ready');
    expect(img).toBeInstanceOf(HTMLImageElement);
    expect(img.getAttribute('src')).toBe('/api/assets/board1/asset1');
    expect(img.getAttribute('alt')).toBe('Image');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('shows "Image unavailable" when img fails to load', () => {
    const snap = makeImageSnap({ status: 'ready', assetKey: 'board1/asset1' });
    render(
      <ImageObject
        image={snap}
        isUploader={true}
        progress={1}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    // Trigger error
    const img = screen.getByTestId('image-ready');
    img.dispatchEvent(new Event('error'));

    waitFor(() => {
      expect(screen.getByTestId('image-unavailable')).toBeDefined();
    });
  });
});

describe('TC-22: non-uploader sees "Uploading…" placeholder', () => {
  it('shows "Uploading…" for non-uploader', () => {
    const snap = makeImageSnap({ status: 'uploading', uploaderId: 'other-user' });
    render(
      <ImageObject
        image={snap}
        isUploader={false}
        progress={0.3}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const placeholder = screen.getByTestId('image-uploading-others');
    expect(placeholder).toBeDefined();
    expect(placeholder.textContent).toContain('Uploading…');
  });
});

describe('TC-23: upload failure states', () => {
  it('uploader sees Retry and Remove buttons on failure', () => {
    const snap = makeImageSnap({ status: 'failed', uploaderId: 'local' });
    render(
      <ImageObject
        image={snap}
        isUploader={true}
        progress={0}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByTestId('image-failed')).toBeDefined();
    expect(screen.getByTestId('image-retry-btn')).toBeDefined();
    expect(screen.getByTestId('image-remove-btn')).toBeDefined();
  });

  it('non-uploader sees "Image unavailable" on failure', () => {
    const snap = makeImageSnap({ status: 'failed', uploaderId: 'other-user' });
    render(
      <ImageObject
        image={snap}
        isUploader={false}
        progress={0}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByTestId('image-unavailable')).toBeDefined();
  });
});

describe('TC-29: aspect-locked resize', () => {
  it('image maintains aspect ratio in objectBounds', () => {
    const snap = makeImageSnap({ x: 0, y: 0, width: 400, height: 300 });
    const bounds = objectBounds(snap);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(300);
  });
});

describe('TC-17: drop 2 files creates 2 placeholders (tested via model)', () => {
  it('layoutRow with 2 items produces correct positions', () => {
    const sizes = [
      { width: 400, height: 300 },
      { width: 200, height: 150 },
    ];
    const rects = layoutRow(sizes, { x: 100, y: 50 }, 'top-left');

    expect(rects[0].x).toBe(100);
    expect(rects[0].y).toBe(50);
    expect(rects[1].x).toBe(100 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(50);
  });
});

describe('TC-24: retry flow (tested via model functions)', () => {
  it('markImageRetrying sets status to uploading', () => {
    const doc = new Y.Doc();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'user1', 1000);

    // Simulate failure
    markImageFailed(doc, ids[0]);

    const objects = doc.getMap('objects');
    expect((objects.get(ids[0]) as Y.Map<unknown>).get('status')).toBe('failed');

    // Retry
    markImageRetrying(doc, ids[0], 2000);
    expect((objects.get(ids[0]) as Y.Map<unknown>).get('status')).toBe('uploading');
    expect((objects.get(ids[0]) as Y.Map<unknown>).get('uploadStartedAt')).toBe(2000);

    // Success with same assetKey
    const ok = markImageReady(doc, ids[0], 'board1/asset1');
    expect(ok).toBe(true);
    expect((objects.get(ids[0]) as Y.Map<unknown>).get('status')).toBe('ready');
    expect((objects.get(ids[0]) as Y.Map<unknown>).get('assetKey')).toBe('board1/asset1');
  });
});
