// Story 12 (image.model) unit tests: TC-03 to TC-07. Pure placement,
// layout and status logic on a REAL Y.Doc with a real Y.UndoManager
// tracking LOCAL_ORIGIN only (the story 8 wiring), so the undo-step
// assertions are the production behaviour.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createImagePlaceholders,
  displayStatus,
  ensureImageType,
  imageSnapshot,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN, objectsMap } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  ensureImageType();
  return doc;
}

function snapshot(doc: Y.Doc, id: string): ImageSnap {
  const snap = imageSnapshot(doc, id);
  if (snap === null) throw new Error(`no snapshot for ${id}`);
  return snap;
}

describe('image.model: placementSize (TC-03)', () => {
  it('smaller-than-max images keep their natural size (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('landscape 1600x1200 scales to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('portrait 300x3200 scales to 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('exactly IMAGE_MAX_PLACE_SIZE_WORLD stays put (boundary)', () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('non-finite or non-positive sizes never produce a positive size', () => {
    for (const [w, h] of [
      [NaN, 100],
      [100, Infinity],
      [0, 100],
      [-5, 100],
    ]) {
      const s = placementSize(w, h);
      expect(s.width > 0 && s.height > 0).toBe(false);
    }
  });
});

describe('image.model: layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 60 },
    { width: 40, height: 40 },
  ];

  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const row = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(row).toHaveLength(3);
    expect(row[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(row[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(row[1].y).toBe(20);
    expect(row[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    expect(row[2].y).toBe(20);
  });

  it('centre: the row is centred on the point (horizontally and vertically)', () => {
    const total = 100 + 80 + 40 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const row = layoutRow(sizes, { x: 1000, y: 500 }, 'centre');
    expect(row[0].x).toBeCloseTo(1000 - total / 2);
    expect(row[2].x + row[2].width).toBeCloseTo(1000 + total / 2);
    // Every image is vertically centred on the point.
    for (const r of row) {
      expect(r.y + r.height / 2).toBeCloseTo(500);
    }
  });

  it('a single size is centred exactly on the point', () => {
    const row = layoutRow([{ width: 100, height: 50 }], { x: 10, y: 20 }, 'centre');
    expect(row[0]).toEqual({ x: -40, y: -5, width: 100, height: 50 });
  });
});

describe('image.model: placeholders and status updates', () => {
  const items = [
    { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 1440, naturalHeight: 900, contentType: 'image/png' },
    { rect: { x: 124, y: 0, width: 80, height: 60 }, naturalWidth: 800, naturalHeight: 1200, contentType: 'image/jpeg' },
    { rect: { x: 228, y: 0, width: 40, height: 40 }, naturalWidth: 640, naturalHeight: 480, contentType: 'image/png' },
  ];

  it('TC-05: three placeholders land in ONE update and ONE undo step; ready is not a step', () => {
    const doc = newDoc();
    const undo = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const now = 1_700_000_000_000;

    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const ids = createImagePlaceholders(doc, items, 'uploader-1', now);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      const snap = snapshot(doc, id);
      expect(snap.status).toBe('uploading');
      expect(snap.uploaderId).toBe('uploader-1');
      expect(snap.uploadStartedAt).toBe(now);
      expect(snap.assetKey).toBeNull();
    }
    // All three in a single transaction/update…
    expect(updateCount).toBe(1);
    // …and exactly one undo step for the whole add action.
    expect(undo.undoStack.length).toBe(1);

    // Upload completion (UPLOAD_ORIGIN) never becomes its own undo step.
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    expect(snapshot(doc, ids[0]).status).toBe('ready');
    expect(snapshot(doc, ids[0]).assetKey).toBe('board/asset');
    expect(undo.undoStack.length).toBe(1);

    // One undo removes ALL three placeholders.
    expect(undo.undo() !== null).toBe(true);
    for (const id of ids) {
      expect(objectsMap(doc).get(id)).toBeUndefined();
    }
  });

  it('TC-06: displayStatus derives unfinished exactly at the stale boundary', () => {
    const doc = newDoc();
    const now = 1_700_000_000_000;
    const [id] = createImagePlaceholders(doc, [items[0]], 'me', now);
    const snap = snapshot(doc, id);

    expect(displayStatus(snap, now + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(snap, now + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');

    expect(markImageFailed(doc, id)).toBe(true);
    expect(displayStatus(snapshot(doc, id), now + 10 * IMAGE_UPLOAD_STALE_MS)).toBe('failed');

    expect(markImageRetrying(doc, id, now + 5 * IMAGE_UPLOAD_STALE_MS)).toBe(true);
    expect(markImageReady(doc, id, 'b/a')).toBe(true);
    expect(displayStatus(snapshot(doc, id), now + 10 * IMAGE_UPLOAD_STALE_MS)).toBe('ready');
  });

  it('TC-07: status updates on a deleted id return false and make no change', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [items[0]], 'me', 1);
    objectsMap(doc).delete(id);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, 'b/a')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2)).toBe(false);
    // No transaction happened: no doc updates, and the id stays gone.
    expect(updates).toBe(0);
    expect(objectsMap(doc).get(id)).toBeUndefined();
  });

  it('createImagePlaceholders skips items with non-finite sizes', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(
      doc,
      [
        items[0],
        { rect: { x: NaN, y: 0, width: 10, height: 10 }, naturalWidth: NaN, naturalHeight: 10, contentType: 'image/png' },
        { rect: { x: 5, y: 5, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: Infinity, contentType: 'image/png' },
      ],
      'me',
      1,
    );
    expect(ids).toHaveLength(1);
  });

  it('z increases across a batch and the natural size is stored for later layout', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(doc, items, 'me', 1);
    const z = ids.map((id) => Number(snapshot(doc, id).z));
    expect(z[1]).toBeGreaterThan(z[0]);
    expect(z[2]).toBeGreaterThan(z[1]);
    expect(snapshot(doc, ids[0]).naturalWidth).toBe(1440);
  });

  it('UPLOAD_ORIGIN is a distinct symbol, not LOCAL_ORIGIN', () => {
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});

// IMAGE_MAX_BYTES is imported by TC-12 (integration); referenced here so the
// boundary constant is part of the model test surface.
void IMAGE_MAX_BYTES;
void IMAGE_MAX_PLACE_SIZE_WORLD;
