import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc, LOCAL_ORIGIN, snapshotAll } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS
} from '../../src/shared/config';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap
} from '../../src/shared/objects/image';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function countUpdates(doc: Y.Doc): () => number {
  let n = 0;
  const handler = (): void => {
    n += 1;
  };
  doc.on('update', handler);
  return () => {
    doc.off('update', handler);
    return n;
  };
}

function imageOf(doc: Y.Doc, id: string): ImageSnap {
  const found = snapshotAll(doc).find((o) => o.id === id);
  if (found === undefined) throw new Error(`object ${id} missing`);
  return found as ImageSnap;
}

describe('TC-03 placementSize', () => {
  test('keeps natural size below the cap and never upscales', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  test('scales the longest side to IMAGE_MAX_PLACE_SIZE_WORLD proportionally', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(Math.max(placementSize(12345, 4321).width, placementSize(12345, 4321).height)).toBe(
      IMAGE_MAX_PLACE_SIZE_WORLD
    );
  });
});

describe('TC-04 layoutRow', () => {
  const sizes = [
    { width: 100, height: 80 },
    { width: 60, height: 120 },
    { width: 40, height: 50 }
  ];
  const point = { x: 500, y: 300 };

  test('top-left anchor aligns tops at the point with gap-sized columns', () => {
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 500, y: 300, width: 100, height: 80 });
    expect(rects[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(300);
    expect(rects[2].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 60 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(300);
    expect(rects.every((r) => r.y === point.y)).toBe(true);
  });

  test('centre anchor centres the whole row on the point', () => {
    const rects = layoutRow(sizes, point, 'centre');
    const totalWidth = 100 + 60 + 40 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const tallest = 120;
    expect(rects[0].x).toBeCloseTo(point.x - totalWidth / 2, 6);
    expect(rects[0].y).toBeCloseTo(point.y - tallest / 2, 6);
    expect(rects[2].x + rects[2].width).toBeCloseTo(point.x + totalWidth / 2, 6);
    expect(rects.every((r) => r.y === rects[0].y)).toBe(true);
  });
});

describe('TC-05 createImagePlaceholders is one undo step; completion is not', () => {
  test('3 placeholders in one update; ready via UPLOAD_ORIGIN keeps the undo stack at 1', () => {
    const doc = makeDoc();
    const undoManager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN])
    });
    const done = countUpdates(doc);
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
        { rect: { x: 124, y: 0, width: 60, height: 60 }, naturalWidth: 60, naturalHeight: 60, contentType: 'image/jpeg' },
        { rect: { x: 208, y: 0, width: 40, height: 30 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/webp' }
      ],
      'leo',
      1234
    );
    expect(ids).toHaveLength(3);
    expect(done()).toBe(1);
    for (const id of ids) {
      const snap = imageOf(doc, id);
      expect(snap.status).toBe('uploading');
      expect(snap.uploaderId).toBe('leo');
      expect(snap.uploadStartedAt).toBe(1234);
      expect(snap.assetKey).toBeNull();
    }

    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    const ready = imageOf(doc, ids[0]);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');
    expect(undoManager.undoStack.length).toBe(1);

    undoManager.undo();
    expect(snapshotAll(doc).filter((o) => o.type === 'image')).toHaveLength(0);
  });

  test('markImageRetrying resets status and timestamp without growing the undo stack', () => {
    const doc = makeDoc();
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'leo',
      1000
    );
    expect(markImageFailed(doc, ids[0])).toBe(true);
    expect(markImageRetrying(doc, ids[0], 2000)).toBe(true);
    const snap = imageOf(doc, ids[0]);
    expect(snap.status).toBe('uploading');
    expect(snap.uploadStartedAt).toBe(2000);
    expect(markImageRetrying(doc, 'missing', 3000)).toBe(false);
  });
});

describe('TC-06 displayStatus', () => {
  function img(partial: Partial<ImageSnap>): ImageSnap {
    return {
      id: 'i1',
      type: 'image',
      x: 0,
      y: 0,
      z: 1,
      createdAt: 0,
      width: 10,
      height: 10,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 10,
      naturalHeight: 10,
      status: 'uploading',
      uploadStartedAt: 1000,
      uploaderId: 'leo',
      ...partial
    };
  }

  test('uploading turns unfinished only after IMAGE_UPLOAD_STALE_MS', () => {
    const uploading = img({});
    expect(displayStatus(uploading, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(uploading, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  test('failed and ready never become unfinished', () => {
    expect(displayStatus(img({ status: 'failed' }), 10_000_000)).toBe('failed');
    expect(displayStatus(img({ status: 'ready', assetKey: 'b/a' }), 10_000_000)).toBe('ready');
  });
});

describe('TC-07 status updates on a deleted id are no-ops', () => {
  test('markImageReady / markImageFailed return false and emit no update', () => {
    const doc = makeDoc();
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'leo',
      1000
    );
    expect(deleteObjects(doc, [ids[0]])).toBe(1);
    const done = countUpdates(doc);
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(done()).toBe(0);
  });

  test('uploads are tagged with UPLOAD_ORIGIN, not LOCAL_ORIGIN', () => {
    const doc = makeDoc();
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'leo',
      1000
    );
    let seenLocal = 0;
    let seenUpload = 0;
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) seenLocal += 1;
      if (origin === UPLOAD_ORIGIN) seenUpload += 1;
    });
    markImageReady(doc, ids[0], 'board/asset');
    expect(seenUpload).toBe(1);
    expect(seenLocal).toBe(0);
  });
});
