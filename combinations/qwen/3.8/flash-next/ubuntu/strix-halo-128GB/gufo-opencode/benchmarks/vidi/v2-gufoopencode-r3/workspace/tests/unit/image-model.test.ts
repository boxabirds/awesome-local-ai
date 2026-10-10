import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  initDoc
} from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  collectImageSnapshots,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  placementSize,
  type ImageSnap
} from '../../src/shared/objects/image';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function trackUpdates(doc: Y.Doc): { count(): number; stop(): void } {
  let updates = 0;
  const listener = () => {
    updates += 1;
  };
  doc.on('update', listener);
  return {
    count: () => updates,
    stop: () => doc.off('update', listener)
  };
}

function snap(overrides: Partial<ImageSnap>): ImageSnap {
  return {
    id: 'img',
    type: 'image',
    x: 0,
    y: 0,
    z: 1,
    width: 100,
    height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'u1',
    ...overrides
  };
}

const items = (sizes: [number, number][]) =>
  sizes.map(([w, h], i) => ({
    rect: { x: i * 1000, y: 0, width: w, height: h },
    naturalWidth: w,
    naturalHeight: h,
    contentType: 'image/png'
  }));

// TC-03: placement size keeps natural pixels, scales down only.
describe('placementSize (TC-03)', () => {
  test('below, at and above IMAGE_MAX_PLACE_SIZE_WORLD, landscape and portrait', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(801, 400).width).toBeCloseTo(800);
  });
});

// TC-04: rows are left to right with fixed gaps; anchors position the row.
describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 200, height: 80 },
    { width: 50, height: 20 }
  ];
  const totalWidth = 100 + 200 + 50 + 2 * IMAGE_LAYOUT_GAP_WORLD;

  test('top-left anchor: first top-left at the point, tops aligned, gaps', () => {
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 500, y: 300, width: 100, height: 50 });
    expect(rects[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(rects[1].x + 200 + IMAGE_LAYOUT_GAP_WORLD);
    for (const r of rects) expect(r.y).toBe(300);
  });

  test('centre anchor: the whole row centred on the point', () => {
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    expect(rects[0].x).toBe(-totalWidth / 2);
    const last = rects[2];
    expect(last.x + last.width).toBe(totalWidth / 2);
    const tallest = 80;
    expect(rects[0].y).toBe(-tallest / 2);
  });

  test('empty input → no rects', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

// TC-05: one undo step for the whole add; upload status is untracked.
describe('createImagePlaceholders + markImageReady (TC-05)', () => {
  test('3 placeholders in one update, ready without a second undo step', () => {
    const doc = newDoc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN])
    });
    const tracker = trackUpdates(doc);
    const ids = createImagePlaceholders(doc, items([[100, 50], [200, 80], [50, 20]]), 'u1', 1234);
    expect(ids).toHaveLength(3);
    expect(tracker.count()).toBe(1); // whole add is one update / one undo step

    const snaps = collectImageSnapshots(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.type).toBe('image');
      expect(s.status).toBe('uploading');
      expect(s.assetKey).toBeNull();
      expect(s.uploadStartedAt).toBe(1234);
      expect(s.uploaderId).toBe('u1');
    }
    expect(undo.undoStack.length).toBe(1);

    const ready = markImageReady(doc, ids[1], 'boardid/assetid');
    expect(ready).toBe(true);
    const after = collectImageSnapshots(doc).find((s) => s.id === ids[1]);
    expect(after?.status).toBe('ready');
    expect(after?.assetKey).toBe('boardid/assetid');
    // The untracked status update never adds an undo step.
    expect(undo.undoStack.length).toBe(1);

    expect(undo.undo()).not.toBeNull();
    expect(objectsOf(doc).size).toBe(0);

    // Confirmed during implementation: undo removes the id mapping, redo
    // replays it; the Y.Map itself was never cleared, so the untracked
    // ready marking survives and redo restores the final ready state.
    expect(undo.redo()).not.toBeNull();
    const redone = collectImageSnapshots(doc);
    expect(redone).toHaveLength(3);
    expect(redone.find((s) => s.id === ids[1])?.status).toBe('ready');
    expect(redone.find((s) => s.id === ids[1])?.assetKey).toBe('boardid/assetid');
    tracker.stop();
    undo.destroy();
  });
});

// TC-06: unfinished appears strictly after IMAGE_UPLOAD_STALE_MS.
describe('displayStatus (TC-06)', () => {
  test('uploading at stale−1, unfinished at stale+1, failed, ready', () => {
    const t = snap({ status: 'uploading', uploadStartedAt: 1000 });
    expect(displayStatus(t, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(t, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus(snap({ status: 'failed' }), 9_999_999)).toBe('failed');
    expect(displayStatus(snap({ status: 'ready' }), 9_999_999)).toBe('ready');
  });
});

// TC-07: status writes on stale ids are false and emit no update.
describe('stale ids (TC-07)', () => {
  test('ready/failed/retrying on a deleted or wrong-type id → false, no update', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(doc, items([[100, 50]]), 'u1', 1);
    deleteObjects(doc, ids);
    const sticky = createSticky(doc, { x: 0, y: 0 });

    const tracker = trackUpdates(doc);
    expect(markImageReady(doc, ids[0], 'a/b')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(markImageReady(doc, 'missing-id', 'a/b')).toBe(false);
    expect(markImageFailed(doc, sticky)).toBe(false);
    expect(tracker.count()).toBe(0);
    tracker.stop();
  });
});
