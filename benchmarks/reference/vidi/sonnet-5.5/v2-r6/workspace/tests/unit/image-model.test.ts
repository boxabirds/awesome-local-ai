import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { LOCAL_ORIGIN, initDoc, snapshot, type ImageSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders, displayStatus, layoutRow, markImageFailed, markImageReady, markImageRetrying,
  placementSize, UPLOAD_ORIGIN,
} from '../../src/shared/objects/image';
import { deleteObjects } from '../../src/shared/board-model';

const images = (doc: Y.Doc): ImageSnapshot[] => snapshot(doc).filter((o): o is ImageSnapshot => o.type === 'image');
const item = (x: number, w = 100, h = 50) => ({ rect: { x, y: 0, width: w, height: h }, naturalWidth: w, naturalHeight: h, contentType: 'image/png' });

describe('placementSize', () => {
  it('TC-03: never upscales, scales the longest side to 800, keeps proportions', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow', () => {
  const sizes = [{ width: 100, height: 50 }, { width: 200, height: 80 }, { width: 50, height: 50 }];
  it('TC-04: top-left starts at the point with gaps and aligned tops', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.x)).toEqual([10, 10 + 100 + IMAGE_LAYOUT_GAP_WORLD, 10 + 100 + 200 + 2 * IMAGE_LAYOUT_GAP_WORLD]);
    expect(rects.every((r) => r.y === 20)).toBe(true);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });
  it('TC-04: centre centres the whole row on the point', () => {
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = rects[0].x;
    const right = rects[2].x + rects[2].width;
    expect(left + right).toBeCloseTo(0);
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect(top + bottom).toBeCloseTo(0);
  });
});

describe('placeholders', () => {
  function setup() {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]), captureTimeout: 0 });
    return { doc, undo };
  }

  it('TC-05: three placeholders in one update; completion is not an undo step; undo removes all', () => {
    const { doc, undo } = setup();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const ids = createImagePlaceholders(doc, [item(0), item(124), item(248)], 'u1', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    const all = images(doc);
    expect(all.map((i) => i.status)).toEqual(['uploading', 'uploading', 'uploading']);
    expect(all.every((i) => i.uploaderId === 'u1' && i.uploadStartedAt === 1000 && i.assetKey === null)).toBe(true);
    expect(new Set(all.map((i) => i.z)).size).toBe(3);

    expect(markImageReady(doc, ids[0], 'b/a')).toBe(true);
    expect(images(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: 'b/a' });
    expect(undo.undoStack).toHaveLength(1);
    undo.undo();
    expect(images(doc)).toHaveLength(0);
  });

  it('TC-05: failed and retrying update status without extra undo steps', () => {
    const { doc, undo } = setup();
    const [id] = createImagePlaceholders(doc, [item(0)], 'u1', 1000);
    expect(markImageFailed(doc, id)).toBe(true);
    expect(images(doc)[0].status).toBe('failed');
    expect(markImageRetrying(doc, id, 5000)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 5000 });
    expect(undo.undoStack).toHaveLength(1);
  });

  it('skips items with non-finite sizes', () => {
    const { doc } = setup();
    const ids = createImagePlaceholders(doc, [item(0), { ...item(10), naturalWidth: NaN }], 'u1', 1);
    expect(ids).toHaveLength(1);
    expect(images(doc)).toHaveLength(1);
  });

  it('TC-07: status updates on a deleted id return false and write nothing', () => {
    const { doc } = setup();
    const [id] = createImagePlaceholders(doc, [item(0)], 'u1', 1);
    deleteObjects(doc, [id]);
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    expect(markImageReady(doc, id, 'b/a')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2)).toBe(false);
    expect(updates).toBe(0);
  });

  it('uses an origin that is not LOCAL_ORIGIN', () => {
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});

describe('displayStatus', () => {
  const base: ImageSnapshot = {
    id: 'x', type: 'image', x: 0, y: 0, width: 1, height: 1, assetKey: null, contentType: 'image/png',
    naturalWidth: 1, naturalHeight: 1, status: 'uploading', uploadStartedAt: 1000, uploaderId: 'u', z: 1, createdAt: 1000,
  };
  it('TC-06: uploading turns unfinished only after IMAGE_UPLOAD_STALE_MS', () => {
    expect(displayStatus(base, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(base, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ ...base, status: 'failed' }, 1e12)).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready', assetKey: 'k' }, 1e12)).toBe('ready');
  });
});
