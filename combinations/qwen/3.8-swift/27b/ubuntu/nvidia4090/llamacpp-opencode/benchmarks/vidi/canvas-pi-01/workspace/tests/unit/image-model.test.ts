// image.model (spec: image.model, TC-03 to TC-07).
//
// Pure placement/layout/status logic on a real Y.Doc with a real
// Y.UndoManager tracking LOCAL_ORIGIN only — so the single-undo-step rule
// (placeholder creation = one step, upload completion = no step) is asserted
// against the actual manager.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image';

const NOW = 1_700_000_000_000;

/** A snapshot-shaped image object (displayStatus input). */
function snap(partial: Partial<ImageSnap> & { status: ImageSnap['status'] }): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 50,
    uploadStartedAt: NOW,
    uploaderId: 'u1',
    z: 1,
    createdAt: NOW,
    ...partial,
  };
}

describe('placementSize (TC-03)', () => {
  it('keeps small images at their natural size (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales landscape images down to the 800 bound', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales portrait images down, width first', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('exactly-800 side stays 800 (IMAGE_MAX_PLACE_SIZE_WORLD boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 30 },
  ];
  const point = { x: 200, y: 100 };

  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 200, y: 100, width: 100, height: 50 });
    expect(rects[1]!.x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(100);
    expect(rects[2]!.x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.y).toBe(100);
  });

  it('centre: the whole row is centred on the point', () => {
    const rects = layoutRow(sizes, point, 'centre');
    const total = 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD + 60;
    expect(rects[0]!.x).toBeCloseTo(point.x - total / 2);
    expect(rects[0]!.y).toBe(point.y);
    const rightEdge = rects[2]!.x + rects[2]!.width;
    expect(rightEdge).toBeCloseTo(point.x + total / 2);
  });
});

describe('createImagePlaceholders + status updates (TC-05, TC-07)', () => {
  it('creates N placeholders in one update; ready is not its own undo step (TC-05)', () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 40 }, naturalWidth: 80, naturalHeight: 40, contentType: 'image/jpeg' },
      { rect: { x: 228, y: 0, width: 60, height: 30 }, naturalWidth: 60, naturalHeight: 30, contentType: 'image/gif' },
    ];

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    const ids = createImagePlaceholders(doc, items, 'uploader-1', NOW);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1); // one update event for the whole add action

    const objects = doc.getMap('objects');
    for (const id of ids) {
      const o = objects.get(id) as Y.Map<unknown>;
      expect(o.get('type')).toBe('image');
      expect(o.get('status')).toBe('uploading');
      expect(o.get('assetKey')).toBeNull();
      expect(o.get('uploaderId')).toBe('uploader-1');
      expect(o.get('uploadStartedAt')).toBe(NOW);
    }
    // One undo step for the whole action.
    expect(undo.undoStack.length).toBe(1);

    // Upload completion (UPLOAD_ORIGIN) must not grow the undo stack.
    expect(markImageReady(doc, ids[0]!, 'board/asset')).toBe(true);
    expect(undo.undoStack.length).toBe(1);
    const ready = objects.get(ids[0]!) as Y.Map<unknown>;
    expect(ready.get('status')).toBe('ready');
    expect(ready.get('assetKey')).toBe('board/asset');
    // The other two are untouched.
    expect((objects.get(ids[1]!) as Y.Map<unknown>).get('status')).toBe('uploading');

    // Undoing removes all three placeholders in one step.
    undo.undo();
    expect(objects.size).toBe(0);
    expect(undo.undoStack.length).toBe(0);
  });

  it('skips items with non-finite sizes and creates nothing for an empty batch', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: NaN, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
        { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 0, naturalHeight: 50, contentType: 'image/png' },
      ],
      'u',
      NOW,
    );
    expect(ids).toEqual([]);
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('markImageReady/markImageFailed on a deleted id return false with no update (TC-07)', () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(markImageReady(doc, 'missing', 'k')).toBe(false);
    expect(markImageFailed(doc, 'missing')).toBe(false);
    expect(markImageRetrying(doc, 'missing', NOW)).toBe(false);
    expect(updates).toBe(0);
  });

  it('markImageFailed then markImageRetrying drive the failed→uploading cycle', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'u',
      NOW,
    );
    const o = doc.getMap('objects').get(id!) as Y.Map<unknown>;
    expect(markImageFailed(doc, id!)).toBe(true);
    expect(o.get('status')).toBe('failed');
    expect(o.get('uploadStartedAt')).toBe(NOW); // unchanged
    expect(markImageRetrying(doc, id!, NOW + 999)).toBe(true);
    expect(o.get('status')).toBe('uploading');
    expect(o.get('uploadStartedAt')).toBe(NOW + 999); // restarted clock
    expect(markImageReady(doc, id!, 'b/a')).toBe(true);
    expect(o.get('status')).toBe('ready');
  });
});

describe('displayStatus (TC-06)', () => {
  it('uploading younger than the stale timeout stays uploading (boundary − 1 ms)', () => {
    expect(displayStatus(snap({ status: 'uploading' }), NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe(
      'uploading',
    );
  });

  it('uploading older than the stale timeout becomes unfinished (boundary + 1 ms)', () => {
    expect(displayStatus(snap({ status: 'uploading' }), NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe(
      'unfinished',
    );
  });

  it('exactly at the timeout still uploads (strictly greater)', () => {
    expect(displayStatus(snap({ status: 'uploading' }), NOW + IMAGE_UPLOAD_STALE_MS)).toBe(
      'uploading',
    );
  });

  it('failed and ready are passed through', () => {
    expect(displayStatus(snap({ status: 'failed' }), NOW + IMAGE_UPLOAD_STALE_MS * 2)).toBe('failed');
    expect(displayStatus(snap({ status: 'ready', assetKey: 'b/a' }), NOW)).toBe('ready');
  });
});

describe('UPLOAD_ORIGIN hygiene', () => {
  it('is a distinct symbol from LOCAL_ORIGIN', () => {
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});
