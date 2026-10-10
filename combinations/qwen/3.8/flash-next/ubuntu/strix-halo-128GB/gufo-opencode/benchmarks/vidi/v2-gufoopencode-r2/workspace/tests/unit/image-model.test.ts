// TC-03 to TC-07: the image object model — placement scaling, row layout,
// placeholder creation as one LOCAL_ORIGIN undo step, untracked
// ready/failed transitions, and derived display status around
// IMAGE_UPLOAD_STALE_MS.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN, markTypeKnown, objectSnapshots } from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

// The client registry calls markTypeKnown('image'); unit tests read the doc
// without importing the registry, so register the type here.
markTypeKnown('image');

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function imageSnap(doc: Y.Doc, id: string): ImageSnap {
  const found = objectSnapshots(doc).find((s) => s.id === id);
  if (!found || found.type !== 'image') throw new Error(`image ${id} missing from snapshots`);
  return found as ImageSnap;
}

function item(over: Partial<{ width: number; height: number; x: number; y: number; naturalWidth: number; naturalHeight: number }>) {
  return {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    ...over,
  };
}

describe('placementSize (TC-03)', () => {
  it('keeps sizes at or below the limit and scales down proportionally above it', () => {
    const cases: [[number, number], [number, number]][] = [
      [[400, 300], [400, 300]],
      [[1600, 1200], [800, 600]],
      [[300, 3200], [75, 800]],
      [[800, 800], [800, 800]],
    ];
    for (const [[nw, nh], [w, h]] of cases) {
      expect(placementSize(nw, nh)).toEqual({ width: w, height: h });
    }
  });
});

describe('layoutRow (TC-04)', () => {
  it('lays sizes out in a row: gap-separated x, aligned tops at the point', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 150 },
      { width: 50, height: 400 },
    ];
    const point = { x: 10, y: 20 };
    const positions = layoutRow(sizes, point);
    expect(positions).toEqual([
      { x: 10, y: 20 },
      { x: 10 + 100 + IMAGE_LAYOUT_GAP_WORLD, y: 20 },
      { x: 10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD, y: 20 },
    ]);
  });
});

describe('placeholders and upload transitions (TC-05)', () => {
  it('creates 3 uploading objects in one undo step; ready transition is untracked', () => {
    const doc = freshDoc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
      captureTimeout: 500,
    });

    let updates = 0;
    const origins: unknown[] = [];
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      updates++;
      origins.push(origin);
    });
    const ids = createImagePlaceholders(
      doc,
      [
        { ...item({}), x: 0, y: 0 },
        { ...item({ width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 }), x: 424, y: 0 },
        { ...item({}), x: 848, y: 0 },
      ],
      'user-uploader',
      1000,
    );
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1); // one transaction
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(undo.undoStack.length).toBe(1);
    updates = 0;
    origins.length = 0;

    for (const id of ids) {
      const snap = imageSnap(doc, id);
      expect(snap.status).toBe('uploading');
      expect(snap.assetKey).toBeNull();
      expect(snap.uploadStartedAt).toBe(1000);
      expect(snap.uploaderId).toBe('user-uploader');
    }

    const ok = markImageReady(doc, ids[1], 'abc/def', 'image/jpeg');
    expect(ok).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([UPLOAD_ORIGIN]); // untracked by the UndoManager
    expect(undo.undoStack.length).toBe(1); // still one step
    const ready = imageSnap(doc, ids[1]);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('abc/def');
    expect(ready.contentType).toBe('image/jpeg');

    expect(markImageFailed(doc, ids[0])).toBe(true);
    expect(imageSnap(doc, ids[0]).status).toBe('failed');

    // Undo removes the placeholders and their untracked status writes with
    // them: a single step covers the whole add.
    undo.undo();
    expect(objectsMap(doc).size).toBe(0);
    undo.redo();
    expect(objectsMap(doc).size).toBe(3);
    undo.destroy();
  });
});

describe('displayStatus (TC-06)', () => {
  it('flips uploading to unfinished exactly past IMAGE_UPLOAD_STALE_MS', () => {
    const t = 1_700_000_000_000;
    expect(displayStatus({ status: 'uploading', uploadStartedAt: t }, t + IMAGE_UPLOAD_STALE_MS - 1)).toBe(
      'uploading',
    );
    expect(displayStatus({ status: 'uploading', uploadStartedAt: t }, t + IMAGE_UPLOAD_STALE_MS + 1)).toBe(
      'unfinished',
    );
    expect(displayStatus({ status: 'failed', uploadStartedAt: t }, t + IMAGE_UPLOAD_STALE_MS + 1)).toBe('failed');
    expect(displayStatus({ status: 'ready', uploadStartedAt: t }, t + IMAGE_UPLOAD_STALE_MS + 1)).toBe('ready');
  });
});

describe('markImageReady on a deleted id (TC-07)', () => {
  it('returns false without a document update', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item({})], 'user-a', 1);
    objectsMap(doc).delete(id);

    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, 'abc/def', 'image/png')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2)).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('markImageRetrying', () => {
  it('moves failed back to uploading with a fresh uploadStartedAt via UPLOAD_ORIGIN', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item({})], 'user-a', 1);
    markImageFailed(doc, id);
    expect(markImageRetrying(doc, id, 5000)).toBe(true);
    const snap = imageSnap(doc, id);
    expect(snap.status).toBe('uploading');
    expect(snap.uploadStartedAt).toBe(5000);
  });
});
