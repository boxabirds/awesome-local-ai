/**
 * Unit tests for the image object model (story 12).
 * TC-03 to TC-07.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  displayStatus,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

describe('TC-03: placementSize', () => {
  it('400x300 → 400x300 (no upscale, below limit)', () => {
    const { width, height } = placementSize(400, 300);
    expect(width).toBe(400);
    expect(height).toBe(300);
  });

  it('1600x1200 → 800x600 (landscape scaled down)', () => {
    const { width, height } = placementSize(1600, 1200);
    expect(width).toBe(800);
    expect(height).toBe(600);
  });

  it('300x3200 → 75x800 (portrait scaled down)', () => {
    const { width, height } = placementSize(300, 3200);
    expect(width).toBe(75);
    expect(height).toBe(800);
  });

  it('800x800 → 800x800 (exactly at IMAGE_MAX_PLACE_SIZE_WORLD)', () => {
    const { width, height } = placementSize(800, 800);
    expect(width).toBe(800);
    expect(height).toBe(800);
  });
});

describe('TC-04: layoutRow', () => {
  const sizes = [
    { width: 100, height: 200 },
    { width: 150, height: 100 },
    { width: 80, height: 120 },
  ];

  it('top-left anchor: tops aligned at start point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const start = { x: 100, y: 200 };
    const rects = layoutRow(sizes, start, 'top-left');

    expect(rects.length).toBe(3);
    // All tops at start.y
    expect(rects[0]!.y).toBe(200);
    expect(rects[1]!.y).toBe(200);
    expect(rects[2]!.y).toBe(200);

    // First starts at start.x
    expect(rects[0]!.x).toBe(100);

    // Second starts at first.x + first.width + gap
    expect(rects[1]!.x).toBe(100 + 100 + IMAGE_LAYOUT_GAP_WORLD);

    // Third starts at second.x + second.width + gap
    expect(rects[2]!.x).toBe(100 + 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('centre anchor: row centred on start point', () => {
    const start = { x: 500, y: 400 };
    const rects = layoutRow(sizes, start, 'centre');

    expect(rects.length).toBe(3);
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 150 + IMAGE_LAYOUT_GAP_WORLD + 80;
    // Row starts at 500 - totalWidth/2
    expect(rects[0]!.x).toBeCloseTo(500 - totalWidth / 2, 1);
    // Vertically centred on the tallest
    const maxH = 200;
    expect(rects[0]!.y).toBeCloseTo(400 - maxH / 2, 1);
  });
});

describe('TC-05: createImagePlaceholders + markImageReady + undo', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    // Simulate the objects map init
    doc.getMap('objects');
  });

  it('creates 3 placeholders in one update; ready on one is not an extra undo step', () => {
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' },
      { rect: { x: 200, y: 0, width: 200, height: 150 }, naturalWidth: 200, naturalHeight: 150, contentType: 'image/jpeg' },
      { rect: { x: 500, y: 0, width: 80, height: 80 }, naturalWidth: 80, naturalHeight: 80, contentType: 'image/gif' },
    ];

    // Set up UndoManager BEFORE creating items so it can track them.
    // Track LOCAL_ORIGIN but NOT UPLOAD_ORIGIN.
    const um = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    const ids = createImagePlaceholders(doc, items, 'user1', Date.now());
    expect(ids.length).toBe(3);

    // All in the objects map
    const objects = doc.getMap('objects');
    expect(objects.size).toBe(3);

    // All have status 'uploading'
    for (const id of ids) {
      const entry = objects.get(id) as Y.Map<unknown>;
      expect(entry.get('status')).toBe('uploading');
      expect(entry.get('uploaderId')).toBe('user1');
    }

    expect(um.undoStack.length).toBe(1); // One undo step for all 3

    // Mark one as ready (uses UPLOAD_ORIGIN — not tracked)
    const ok = markImageReady(doc, ids[0]!, 'abc/def');
    expect(ok).toBe(true);
    const entry = objects.get(ids[0]!) as Y.Map<unknown>;
    expect(entry.get('status')).toBe('ready');
    expect(entry.get('assetKey')).toBe('abc/def');

    // Undo stack length is still 1 (ready update not tracked)
    expect(um.undoStack.length).toBe(1);

    // Undo removes all 3 placeholders
    um.undo();
    expect(objects.size).toBe(0);
  });
});

describe('TC-06: displayStatus boundary', () => {
  const baseSnap: ImageSnap = {
    id: 'test', type: 'image', x: 0, y: 0, z: 1, width: 100, height: 100,
    assetKey: null, contentType: 'image/png', naturalWidth: 100, naturalHeight: 100,
    status: 'uploading', uploadStartedAt: 1000, uploaderId: 'user1',
  };

  it('uploading at STALE_MS - 1 → uploading', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS - 1;
    expect(displayStatus(baseSnap, now)).toBe('uploading');
  });

  it('uploading at STALE_MS + 1 → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    expect(displayStatus(baseSnap, now)).toBe('unfinished');
  });

  it('uploading at exactly STALE_MS → unfinished', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS;
    expect(displayStatus(baseSnap, now)).toBe('unfinished');
  });

  it('failed → failed', () => {
    const snap = { ...baseSnap, status: 'failed' as const };
    expect(displayStatus(snap, Date.now())).toBe('failed');
  });

  it('ready → ready', () => {
    const snap = { ...baseSnap, status: 'ready' as const, assetKey: 'a/b' };
    expect(displayStatus(snap, Date.now())).toBe('ready');
  });
});

describe('TC-07: stale id on status updates', () => {
  it('markImageReady on deleted id returns false, no update', () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    const ok = markImageReady(doc, 'nonexistent-id', 'key/value');
    expect(ok).toBe(false);
  });

  it('markImageFailed on deleted id returns false', () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    const ok = markImageFailed(doc, 'nonexistent-id');
    expect(ok).toBe(false);
  });
});
