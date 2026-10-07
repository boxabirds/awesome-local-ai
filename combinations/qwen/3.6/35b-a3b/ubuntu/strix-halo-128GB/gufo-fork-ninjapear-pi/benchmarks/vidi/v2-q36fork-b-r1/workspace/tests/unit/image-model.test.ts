/**
 * Story 12 — Unit tests for image object model (TC-03 to TC-07).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  UPLOAD_ORIGIN,
} from '@/shared/objects/image';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';

describe('placementSize (TC-03)', () => {
  it('400x300 stays 400x300 (no upscale)', () => {
    const s = placementSize(400, 300);
    expect(s).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 scales to 800x600', () => {
    const s = placementSize(1600, 1200);
    expect(s).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 scales portrait to 75x800', () => {
    const s = placementSize(300, 3200);
    expect(s).toEqual({ width: 75, height: 800 });
  });

  it('800x800 at boundary stays 800x800', () => {
    const s = placementSize(800, 800);
    expect(s).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('top-left anchors first item at point, gaps between items', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 150, height: 120 },
      { width: 80, height: 60 },
    ];
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'top-left');
    expect(rects).toHaveLength(3);
    // First at drop point
    expect(rects[0].x).toBe(500);
    expect(rects[0].y).toBe(300);
    // Second separated by gap
    expect(rects[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(300);
    // Third after second gap
    expect(rects[2].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(300);
  });

  it('centre anchors row centre on point', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 150, height: 120 },
    ];
    // Total width = 100 + 24 + 150 = 274
    // Centre of row = start + 137
    // So start = point - 137
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'centre');
    expect(rects).toHaveLength(2);
    expect(rects[0].x).toBe(500 - 137); // 500 - (274/2)
    expect(rects[0].y).toBe(300);
    expect(rects[1].x).toBe(500 - 137 + 100 + IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('createImagePlaceholders (TC-05)', () => {
  function setup() {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);
    return doc;
  }

  it('creates 3 objects with uploading status in one update event', () => {
    const doc = setup();
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 200, naturalHeight: 160, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 150, height: 120 }, naturalWidth: 300, naturalHeight: 240, contentType: 'image/jpeg' },
      { rect: { x: 322, y: 0, width: 80, height: 60 }, naturalWidth: 80, naturalHeight: 60, contentType: 'image/gif' },
    ];

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const ids = createImagePlaceholders(doc, items, 'user-1', Date.now());
    expect(ids).toHaveLength(3);

    // Verify all have uploading status
    const objects = doc.getMap('objects') as Y.Map<any>;
    for (const id of ids) {
      const inner = objects.get(id);
      expect(inner.get('status')).toBe('uploading');
      expect(inner.get('uploaderId')).toBe('user-1');
      expect(inner.get('assetKey')).toBe(null);
    }

    // Only one update triggered (single transaction)
    expect(updateCount).toBe(1);
  });

  it('markImageReady sets assetKey and status to ready', () => {
    const doc = setup();
    const items = [{ rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 200, naturalHeight: 160, contentType: 'image/png' }];
    const ids = createImagePlaceholders(doc, items, 'user-1', Date.now());
    expect(ids).toHaveLength(1);

    // Mark ready
    const result = markImageReady(doc, ids[0], 'abc123/def456');
    expect(result).toBe(true);

    const objects = doc.getMap('objects') as Y.Map<any>;
    const inner = objects.get(ids[0]);
    expect(inner.get('assetKey')).toBe('abc123/def456');
    expect(inner.get('status')).toBe('ready');
  });

  it('marks failed and retried correctly', () => {
    const doc = setup();
    const items = [{ rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 200, naturalHeight: 160, contentType: 'image/png' }];
    const ids = createImagePlaceholders(doc, items, 'user-1', Date.now());

    markImageFailed(doc, ids[0]);
    let inner = (doc.getMap('objects') as Y.Map<any>).get(ids[0]);
    expect(inner.get('status')).toBe('failed');

    markImageRetrying(doc, ids[0], Date.now() + 1000);
    inner = (doc.getMap('objects') as Y.Map<any>).get(ids[0]);
    expect(inner.get('status')).toBe('uploading');
  });
});

describe('displayStatus (TC-06)', () => {
  function makeImg(status: 'uploading' | 'ready' | 'failed', uploadStartedAt: number) {
    return {
      id: 'test',
      type: 'image' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      assetKey: status === 'ready' ? 'abc/def' : null,
      contentType: 'image/png',
      naturalWidth: 200,
      naturalHeight: 160,
      status,
      uploadStartedAt,
      uploaderId: 'user-1',
      z: 1,
    };
  }

  const now = Date.now();

  it('uploading returns uploading when within stale timeout', () => {
    const img = makeImg('uploading', now - (IMAGE_UPLOAD_STALE_MS - 1));
    expect(displayStatus(img, now)).toBe('uploading');
  });

  it('uploading returns unfinished when past stale timeout', () => {
    const img = makeImg('uploading', now - (IMAGE_UPLOAD_STALE_MS + 1));
    expect(displayStatus(img, now)).toBe('unfinished');
  });

  it('failed returns failed', () => {
    const img = makeImg('failed', now - 10000);
    expect(displayStatus(img, now)).toBe('failed');
  });

  it('ready returns ready', () => {
    const img = makeImg('ready', now - 10000);
    expect(displayStatus(img, now)).toBe('ready');
  });
});

describe('markImageReady/Failed on deleted id (TC-07)', () => {
  it('returns false for non-existent id', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);

    expect(markImageReady(doc, 'nonexistent-id', 'key')).toBe(false);
    expect(markImageFailed(doc, 'nonexistent-id')).toBe(false);
    expect(markImageRetrying(doc, 'nonexistent-id', Date.now())).toBe(false);
  });

  it('no update written for non-existent id', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('meta').set('schemaVersion', 1);
    }, LOCAL_ORIGIN);

    let updated = false;
    doc.on('update', () => { updated = true; });

    markImageReady(doc, 'nonexistent-id', 'key');
    expect(updated).toBe(false);
  });
});
