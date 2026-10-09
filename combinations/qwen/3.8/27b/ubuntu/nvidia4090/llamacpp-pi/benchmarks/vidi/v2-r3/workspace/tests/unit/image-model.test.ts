/**
 * Story 12 unit tests for the image object model (TC-03 to TC-07).
 *
 * Real Y.Docs throughout. TC-05 also proves the undo integration: the
 * placeholder creation is one tracked (LOCAL_ORIGIN) transaction and the
 * ready/failed settles (UPLOAD_ORIGIN, untracked) add no undo steps, so
 * "add three images" is exactly one undo step.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createSticky, initDoc, LOCAL_ORIGIN, registerKnownObjectType, snapshot } from '../../src/shared/board-model';

// The client registry also registers 'image'; unit tests need it known here.
registerKnownObjectType('image');

const imageItems = (doc: Y.Doc): Y.Map<unknown>[] =>
  [...doc.getMap('objects').values()]
    .filter((v): v is Y.Map<unknown> => v instanceof Y.Map && v.get('type') === 'image')
    .map((v) => v as Y.Map<unknown>);

const images = (doc: Y.Doc): ImageSnap[] =>
  snapshot(doc).filter((o): o is ImageSnap => o.type === 'image');

describe('placementSize (TC-03)', () => {
  it('keeps small images at their natural size', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    // Exactly at the limit: no scaling.
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  it('scales down proportionally when the longest side exceeds the limit', () => {
    // 1600x1200 → longest 1600 → factor 0.5
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    // Tall image: 300x3200 → factor 800/3200 = 0.25
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    // Portrait slightly over: 700x900 → factor 800/900
    const r = placementSize(700, 900);
    expect(r.height).toBeCloseTo(800, 10);
    expect(r.width).toBeCloseTo((700 * 800) / 900, 10);
  });

  it('rejects non-finite / non-positive sizes', () => {
    expect(placementSize(NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(100, Infinity)).toEqual({ width: 0, height: 0 });
    expect(placementSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(-5, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 60 },
    { width: 60, height: 40 },
  ];

  it('top-left anchor: tops aligned at the point, 24-unit gaps left to right', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects).toEqual([
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 134, y: 20, width: 80, height: 60 }, // 10 + 100 + 24
      { x: 238, y: 20, width: 60, height: 40 }, // 134 + 80 + 24
    ]);
  });

  it('centre anchor: the whole row is centred on the point', () => {
    // total width = 100 + 80 + 60 + 2 * 24 = 288; tallest = 60
    const rects = layoutRow(sizes, { x: 100, y: 100 }, 'centre');
    expect(rects[0].x).toBe(100 - 288 / 2);
    expect(rects[0].y).toBe(100 - 60 / 2);
    expect(rects[1].x).toBe(rects[0].x + 100 + 24);
    expect(rects[2].x).toBe(rects[1].x + 80 + 24);
    expect(rects[2].x + 60).toBeCloseTo(100 + 288 / 2, 10);
    // Tops aligned within the row.
    expect(rects.every((r) => r.y === rects[0].y)).toBe(true);
  });

  it('a single size lands on the point (top-left) or is centred (centre)', () => {
    expect(layoutRow([{ width: 120, height: 90 }], { x: 5, y: 7 }, 'top-left')).toEqual([
      { x: 5, y: 7, width: 120, height: 90 },
    ]);
    expect(layoutRow([{ width: 120, height: 90 }], { x: 500, y: 300 }, 'centre')).toEqual([
      { x: 440, y: 255, width: 120, height: 90 },
    ]);
  });
});

describe('placeholders + undo integration (TC-05)', () => {
  it('creates three uploading placeholders in one tracked transaction — one undo step; settle adds none', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // captureTimeout 0: every tracked transaction is its own step.
    const um = new Y.UndoManager(doc, {
      captureTimeout: 0,
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });

    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 60 }, naturalWidth: 80, naturalHeight: 60, contentType: 'image/png' },
      { rect: { x: 228, y: 0, width: 60, height: 40 }, naturalWidth: 60, naturalHeight: 40, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, 'uploader-a', 1000);
    doc.off('update', onUpdate);

    expect(ids).toHaveLength(3);
    expect(updates).toBe(1); // one transaction → one doc update event
    const snaps = images(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) expect(s.status).toBe('uploading');

    expect(um.undoStack.length).toBe(1);
    // The ready settle is untracked: it must not grow the undo stack.
    expect(markImageReady(doc, ids[0], 'aaaa/bbbb')).toBe(true);
    expect(um.undoStack.length).toBe(1);
    const ready = images(doc).find((s) => s.id === ids[0]);
    expect(ready?.assetKey).toBe('aaaa/bbbb');
    expect(ready?.status).toBe('ready');
    expect(markImageFailed(doc, ids[1])).toBe(true);
    expect(um.undoStack.length).toBe(1);

    // One undo removes the whole add action.
    um.undo();
    expect(images(doc)).toHaveLength(0);
    expect(um.redoStack.length).toBe(1);
    um.redo();
    expect(images(doc)).toHaveLength(3);
  });

  it('skips invalid items; all invalid means no transaction', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: NaN, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
        { rect: { x: 0, y: 0, width: -1, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
        { rect: { x: 5, y: 5, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      ],
      'uploader-a',
      1,
    );
    doc.off('update', onUpdate);
    expect(ids).toHaveLength(1);
    expect(updates).toBe(1);

    const doc2 = new Y.Doc();
    initDoc(doc2);
    let updates2 = 0;
    const onUpdate2 = () => {
      updates2 += 1;
    };
    doc2.on('update', onUpdate2);
    const ids2 = createImagePlaceholders(
      doc2,
      [{ rect: { x: 0, y: 0, width: 0, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'uploader-a',
      1,
    );
    doc2.off('update', onUpdate2);
    expect(ids2).toEqual([]);
    expect(updates2).toBe(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const base = {
    type: 'image',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 10,
    naturalHeight: 10,
    uploadStartedAt: 0,
    uploaderId: 'u',
  } as ImageSnap;

  it('uploading within the staleness window stays uploading', () => {
    expect(displayStatus({ ...base, status: 'uploading' }, IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus({ ...base, status: 'uploading' }, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading beyond the staleness window is unfinished', () => {
    expect(displayStatus({ ...base, status: 'uploading' }, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ ...base, status: 'uploading' }, Date.now())).toBe('unfinished');
  });

  it('failed and ready are never unfinished', () => {
    expect(displayStatus({ ...base, status: 'failed', uploadStartedAt: 0 }, Date.now())).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready', uploadStartedAt: 0, assetKey: 'a/b' }, Date.now())).toBe(
      'ready',
    );
  });
});

describe('settle guards (TC-07)', () => {
  it('markImageReady on a deleted image is a no-op: false, no doc update', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'u',
      1,
    );
    const id = ids[0];
    doc.transact(() => {
      doc.getMap('objects').delete(id);
    });
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);
    expect(markImageReady(doc, id, 'aaaa/bbbb')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2)).toBe(false);
    doc.off('update', onUpdate);
    expect(updates).toBe(0);
    expect(imageItems(doc)).toHaveLength(0);
  });

  it('markImageReady ignores empty keys and non-image ids', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'u',
      1,
    )[0];
    const stickyId = createSticky(doc, { x: 0, y: 0 });
    expect(markImageReady(doc, id, '')).toBe(false);
    expect(markImageReady(doc, stickyId, 'aaaa/bbbb')).toBe(false);
  });
});
