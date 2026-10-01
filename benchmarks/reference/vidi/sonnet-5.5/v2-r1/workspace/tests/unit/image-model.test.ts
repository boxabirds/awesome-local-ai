import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { LOCAL_ORIGIN, deleteObjects, initDoc, snapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../src/shared/objects/image';
import type { ImageSnap } from '../../src/shared/objects/image';

const item = (x: number, w = 100, h = 50) => ({
  rect: { x, y: 10, width: w, height: h },
  naturalWidth: w,
  naturalHeight: h,
  contentType: 'image/png',
});
const images = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'image') as ImageSnap[];

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  const undo = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 });
  return { doc, undo };
}

describe('image model', () => {
  it('TC-03: placement size never upscales and keeps proportions', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(801, 801)).toEqual({ width: 800, height: 800 });
  });

  it('TC-04: row layout', () => {
    const sizes = [{ width: 100, height: 50 }, { width: 200, height: 80 }, { width: 50, height: 50 }];
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([20, 20, 20]);
    expect(rects[0].x).toBe(10);
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(rects[1].x + 200 + IMAGE_LAYOUT_GAP_WORLD);
    const centred = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = centred[0].x;
    const right = centred[2].x + centred[2].width;
    expect(left + right).toBeCloseTo(0);
    expect(centred[1].y).toBe(-40);
  });

  it('TC-05: placeholders are one update and one undo step; completion is not a step', () => {
    const { doc, undo } = newDoc();
    let updates = 0;
    doc.on('update', () => updates++);
    const ids = createImagePlaceholders(doc, [item(0), item(150), item(300)], 'u1', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    expect(images(doc).map((i) => [i.status, i.uploaderId, i.uploadStartedAt])).toEqual([
      ['uploading', 'u1', 1000],
      ['uploading', 'u1', 1000],
      ['uploading', 'u1', 1000],
    ]);
    expect(markImageReady(doc, ids[0], 'b/a')).toBe(true);
    expect(images(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: 'b/a' });
    expect(undo.undoStack).toHaveLength(1);
    undo.undo();
    expect(images(doc)).toHaveLength(0);
    undo.redo();
    expect(images(doc)).toHaveLength(3);
    expect(images(doc).find((i) => i.id === ids[0])?.status).toBe('ready');
  });

  it('TC-06: display status flips to unfinished after the stale timeout', () => {
    const base = { status: 'uploading' as const, uploadStartedAt: 1000 };
    expect(displayStatus(base, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(base, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ ...base, status: 'failed' }, 1000 + IMAGE_UPLOAD_STALE_MS * 2)).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready' }, 1000 + IMAGE_UPLOAD_STALE_MS * 2)).toBe('ready');
  });

  it('TC-07: status updates on a deleted id do nothing', () => {
    const { doc } = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0)], 'u1', 1);
    deleteObjects(doc, [id]);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, 'x/y')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2)).toBe(false);
    expect(updates).toBe(0);
  });

  it('failed then retrying restarts the clock; non-finite sizes are skipped', () => {
    const { doc } = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0), { ...item(0), naturalWidth: NaN }], 'u1', 1);
    expect(images(doc)).toHaveLength(1);
    markImageFailed(doc, id);
    expect(images(doc)[0].status).toBe('failed');
    markImageRetrying(doc, id, 99);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 99 });
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});
