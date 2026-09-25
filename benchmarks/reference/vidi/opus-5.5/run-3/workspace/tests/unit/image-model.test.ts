import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, initDoc, objectSnapshot, registerModelObjectType } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders,
  displayStatus,
  isImage,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { createUndo, type UndoController } from '../../src/client/board/undo';

// The client registry makes 'image' a known type; the model tests do the same without React.
registerModelObjectType('image');

const controllers: UndoController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((c) => c.destroy());
});

function freshDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function images(doc: Y.Doc): ImageSnap[] {
  return objectSnapshot(doc).filter(isImage);
}

function countUpdates(doc: Y.Doc, fn: () => void): number {
  let n = 0;
  const on = () => n++;
  doc.on('update', on);
  try {
    fn();
  } finally {
    doc.off('update', on);
  }
  return n;
}

const item = (x: number, y: number, width: number, height: number) => ({
  rect: { x, y, width, height },
  naturalWidth: width,
  naturalHeight: height,
  contentType: 'image/png',
});

describe('image.model: placement', () => {
  it('TC-03 placementSize keeps natural size up to IMAGE_MAX_PLACE_SIZE_WORLD, scales larger images down proportionally', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({ width: 800, height: 800 });
    expect(placementSize(801, 10).width).toBe(800);
  });

  it('TC-04 layoutRow: top-left anchor starts at the point with gaps of IMAGE_LAYOUT_GAP_WORLD, tops aligned', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 120 },
      { width: 60, height: 80 },
    ];
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([20, 20, 20]);
    expect(rects[0].x).toBe(10);
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(rects[1].x + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects.map((r) => [r.width, r.height])).toEqual(sizes.map((s) => [s.width, s.height]));
  });

  it('TC-04 layoutRow: centre anchor centres the whole row on the point', () => {
    const sizes = [
      { width: 100, height: 50 },
      { width: 200, height: 120 },
    ];
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = rects[0].x;
    const right = rects[1].x + rects[1].width;
    expect(right - left).toBe(300 + IMAGE_LAYOUT_GAP_WORLD);
    expect((left + right) / 2).toBe(0);
    expect(rects[0].y).toBe(-60);
    expect(rects[1].y).toBe(-60);
    expect(layoutRow([{ width: 80, height: 40 }], { x: 100, y: 100 }, 'centre')).toEqual([
      { x: 60, y: 80, width: 80, height: 40 },
    ]);
  });
});

describe('image.model: placeholders and status', () => {
  it('TC-05 three placeholders in one update and one undo step; completion is not a step of its own', () => {
    const doc = freshDoc();
    const undo = createUndo(doc);
    controllers.push(undo);
    let ids: string[] = [];
    const updates = countUpdates(doc, () => {
      ids = createImagePlaceholders(doc, [item(0, 0, 100, 50), item(124, 0, 80, 80), item(228, 0, 40, 30)], 'leo', 1000);
    });
    expect(updates).toBe(1);
    expect(ids).toHaveLength(3);
    const placed = images(doc);
    expect(placed.map((i) => i.status)).toEqual(['uploading', 'uploading', 'uploading']);
    for (const i of placed) {
      expect(i.uploaderId).toBe('leo');
      expect(i.uploadStartedAt).toBe(1000);
      expect(i.assetKey).toBeNull();
    }

    let origin: unknown = null;
    doc.once('afterTransaction', (tr: Y.Transaction) => (origin = tr.origin));
    expect(markImageReady(doc, ids[1], 'board/asset')).toBe(true);
    expect(origin).toBe(UPLOAD_ORIGIN);
    const ready = images(doc).find((i) => i.id === ids[1])!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');
    expect(undo.canUndo()).toBe(true);

    // Undo stack length 1: one undo removes all three placeholders and leaves nothing else to undo.
    expect(undo.undo()).toBe(true);
    expect(images(doc)).toEqual([]);
    expect(undo.canUndo()).toBe(false);

    // Redo brings the insertion back, with the upload's completion (see NOTES.md story 12).
    expect(undo.redo()).toBe(true);
    const back = images(doc);
    expect(back).toHaveLength(3);
    expect(back.find((i) => i.assetKey === 'board/asset')?.status).toBe('ready');
  });

  it('placeholders are stacked above existing objects, in order', () => {
    const doc = freshDoc();
    const first = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'leo', 1);
    const next = createImagePlaceholders(doc, [item(0, 0, 10, 10), item(34, 0, 10, 10)], 'leo', 2);
    const z = new Map(images(doc).map((i) => [i.id, i.z]));
    expect(z.get(next[0])!).toBeGreaterThan(z.get(first[0])!);
    expect(z.get(next[1])!).toBeGreaterThan(z.get(next[0])!);
  });

  it('items with a non-finite or empty size are skipped; none valid → no update', () => {
    const doc = freshDoc();
    expect(countUpdates(doc, () => expect(createImagePlaceholders(doc, [item(0, 0, NaN, 10)], 'leo', 1)).toEqual([]))).toBe(0);
    const ids = createImagePlaceholders(doc, [item(0, 0, Infinity, 10), item(0, 0, 10, 10), item(0, 0, 0, 10)], 'leo', 1);
    expect(ids).toHaveLength(1);
  });

  it('TC-06 displayStatus: uploading turns unfinished after IMAGE_UPLOAD_STALE_MS; failed and ready are shown as they are', () => {
    const at = 50_000;
    const snap = (status: ImageSnap['status']) => ({ status, uploadStartedAt: at });
    expect(displayStatus(snap('uploading'), at + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(snap('uploading'), at + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus(snap('failed'), at + IMAGE_UPLOAD_STALE_MS + 1)).toBe('failed');
    expect(displayStatus(snap('ready'), at + IMAGE_UPLOAD_STALE_MS + 1)).toBe('ready');
  });

  it('markImageFailed and markImageRetrying change status with UPLOAD_ORIGIN', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'leo', 1);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(markImageFailed(doc, id)).toBe(true);
    expect(images(doc)[0].status).toBe('failed');
    expect(markImageRetrying(doc, id, 99)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 99 });
    expect(origins).toEqual([UPLOAD_ORIGIN, UPLOAD_ORIGIN]);
  });

  it('TC-07 status updates on a deleted image return false and emit no update', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 0, 10, 10)], 'leo', 1);
    deleteObjects(doc, [id]);
    const updates = countUpdates(doc, () => {
      expect(markImageReady(doc, id, 'board/asset')).toBe(false);
      expect(markImageFailed(doc, id)).toBe(false);
      expect(markImageRetrying(doc, id, 5)).toBe(false);
      expect(markImageReady(doc, 'never-existed', 'board/asset')).toBe(false);
    });
    expect(updates).toBe(0);
  });
});
