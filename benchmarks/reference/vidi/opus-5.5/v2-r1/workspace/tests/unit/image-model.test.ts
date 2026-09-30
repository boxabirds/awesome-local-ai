// image.model (TC-03 to TC-07): placement size, row layout, placeholders and upload status on a
// real Y.Doc with the real undo history (which tracks LOCAL_ORIGIN only).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { deleteObjects, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  type ImageSnap,
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../src/shared/objects/image';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const imagesOf = (doc: Y.Doc) => objectsSnapshot(doc).filter((o): o is ImageSnap => o.type === 'image');
const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function items(n: number) {
  const sizes = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 100, height: 500 },
  ].slice(0, n);
  return layoutRow(sizes, { x: 10, y: 20 }, 'top-left').map((rect) => ({
    rect,
    naturalWidth: rect.width,
    naturalHeight: rect.height,
    contentType: 'image/png',
  }));
}

describe('image.model placementSize', () => {
  it('TC-03 natural size, scaled down so the longest side is at most 800', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(801, 400)).toEqual({ width: 800, height: (400 * 800) / 801 });
  });
});

describe('image.model layoutRow', () => {
  const sizes = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 100, height: 500 },
  ];

  it('TC-04 top-left: first corner at the point, tops aligned, IMAGE_LAYOUT_GAP_WORLD apart', () => {
    const rects = layoutRow(sizes, { x: 50, y: 70 }, 'top-left');
    expect(rects[0]).toEqual({ x: 50, y: 70, width: 400, height: 300 });
    expect(rects.map((r) => r.y)).toEqual([70, 70, 70]);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x - (rects[1].x + rects[1].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });

  it('TC-04 centre: the row is centred on the point', () => {
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = rects[0].x;
    const right = rects[2].x + rects[2].width;
    expect((left + right) / 2).toBeCloseTo(0);
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((top + bottom) / 2).toBeCloseTo(0);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(layoutRow([], { x: 0, y: 0 }, 'centre')).toEqual([]);
  });
});

describe('image.model placeholders and status', () => {
  it('TC-05 three placeholders in one update; ready is not its own undo step; undo removes all', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    let updates = 0;
    doc.on('update', () => updates++);
    const ids = createImagePlaceholders(doc, items(3), 'g_leo', 1000);
    expect(updates).toBe(1);
    expect(ids).toHaveLength(3);
    const created = imagesOf(doc);
    expect(created.map((i) => i.id).sort()).toEqual([...ids].sort());
    for (const img of created) {
      expect(img).toMatchObject({ status: 'uploading', uploaderId: 'g_leo', uploadStartedAt: 1000, assetKey: null });
    }
    // Stacking follows the row, on top of everything.
    expect(imagesOf(doc).map((i) => i.id)).toEqual(ids);

    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(markImageReady(doc, ids[0], KEY)).toBe(true);
    expect(origins).toEqual([UPLOAD_ORIGIN]);
    expect(imagesOf(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: KEY });

    // Negative: completion never becomes its own undo step.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(imagesOf(doc)).toEqual([]);
    expect(undo.canUndo()).toBe(false);

    // Redo brings the placeholders back, with the upload's final state.
    expect(undo.redo()).toBe(true);
    expect(imagesOf(doc)).toHaveLength(3);
    expect(imagesOf(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: KEY });
    undo.destroy();
  });

  it('TC-05 the undo stack holds exactly one item after create + ready', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const ids = createImagePlaceholders(doc, items(3), 'g_leo', 1000);
    undo.boundary();
    markImageReady(doc, ids[1], KEY);
    markImageFailed(doc, ids[2]);
    // One undo empties the history.
    undo.undo();
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('TC-06 displayStatus: uploading turns unfinished after IMAGE_UPLOAD_STALE_MS', () => {
    const t0 = 5000;
    const uploading = { status: 'uploading' as const, uploadStartedAt: t0 };
    expect(displayStatus(uploading, t0 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(uploading, t0 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(uploading, t0 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ status: 'failed', uploadStartedAt: t0 }, t0 + 10 * IMAGE_UPLOAD_STALE_MS)).toBe('failed');
    expect(displayStatus({ status: 'ready', uploadStartedAt: t0 }, t0 + 10 * IMAGE_UPLOAD_STALE_MS)).toBe('ready');
  });

  it('TC-06 failed then retrying restarts the clock', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, items(1), 'g_leo', 1000);
    expect(markImageFailed(doc, id)).toBe(true);
    expect(imagesOf(doc)[0].status).toBe('failed');
    expect(markImageRetrying(doc, id, 9000)).toBe(true);
    expect(imagesOf(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 9000 });
    markImageReady(doc, id, KEY);
    // A ready image is never marked failed or retrying.
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 10_000)).toBe(false);
    expect(imagesOf(doc)[0].status).toBe('ready');
  });

  it('TC-07 status updates on a deleted id return false and write nothing', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, items(1), 'g_leo', 1000);
    deleteObjects(doc, [id]);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, KEY)).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2000)).toBe(false);
    expect(markImageReady(doc, 'never-existed', KEY)).toBe(false);
    expect(updates).toBe(0);
  });

  it('non-finite sizes are skipped', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: NaN, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
        { rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      ],
      'g_leo',
      1,
    );
    expect(ids).toHaveLength(1);
    expect(imagesOf(doc)).toHaveLength(1);
  });
});
