import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { snapshotObjects } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders, displayStatus, layoutRow, markImageFailed, markImageReady, markImageRetrying,
  placementSize, type ImageSnap,
} from '../../src/shared/objects/image';
import { newBoardDoc } from './helpers/peer';

const images = (doc: Y.Doc) => snapshotObjects(doc).filter((o): o is ImageSnap => o.type === 'image');
const item = (x: number, w = 100, h = 50) => ({
  rect: { x, y: 10, width: w, height: h }, naturalWidth: w, naturalHeight: h, contentType: 'image/png',
});

describe('placementSize', () => {
  it('TC-03 never enlarges and scales the longest side down to 800', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow', () => {
  const sizes = [{ width: 100, height: 50 }, { width: 200, height: 80 }, { width: 50, height: 50 }];
  it('TC-04 top-left: tops at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([20, 20, 20]);
    expect(rects[0].x).toBe(10);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x - (rects[1].x + rects[1].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });
  it('TC-04 centre: the whole row is centred on the point', () => {
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = rects[0].x;
    const right = rects[2].x + rects[2].width;
    expect(left + right).toBeCloseTo(0);
    expect(rects[1].y + rects[1].height / 2).toBeCloseTo(0); // tallest is centred vertically
  });
});

describe('image placeholders and status', () => {
  it('TC-05 one update and one undo step for three placeholders; completion is not a step', () => {
    const doc = newBoardDoc();
    const undo = createUndo(doc);
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const ids = createImagePlaceholders(doc, [item(0), item(150), item(300)], 'g_1', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    expect(images(doc).map((i) => [i.status, i.uploaderId, i.uploadStartedAt, i.assetKey])).toEqual(
      Array(3).fill(['uploading', 'g_1', 1000, null]),
    );
    expect(markImageReady(doc, ids[0], 'b/a')).toBe(true);
    expect(images(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: 'b/a' });
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(images(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false); // exactly one step
    undo.redo();
    expect(images(doc)).toHaveLength(3);
  });

  it('skips items with non-finite sizes', () => {
    const doc = newBoardDoc();
    expect(createImagePlaceholders(doc, [item(0, NaN)], 'g', 0)).toEqual([]);
    expect(images(doc)).toHaveLength(0);
  });

  it('retry resets the status and start time', () => {
    const doc = newBoardDoc();
    const [id] = createImagePlaceholders(doc, [item(0)], 'g', 1);
    expect(markImageFailed(doc, id)).toBe(true);
    expect(images(doc)[0].status).toBe('failed');
    expect(markImageRetrying(doc, id, 77)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 77 });
  });

  it('TC-06 displayStatus flips to unfinished just after IMAGE_UPLOAD_STALE_MS', () => {
    const up = { status: 'uploading', uploadStartedAt: 0 } as const;
    expect(displayStatus(up, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(up, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ status: 'failed', uploadStartedAt: 0 }, IMAGE_UPLOAD_STALE_MS * 2)).toBe('failed');
    expect(displayStatus({ status: 'ready', uploadStartedAt: 0 }, IMAGE_UPLOAD_STALE_MS * 2)).toBe('ready');
  });

  it('TC-07 status updates on a deleted id return false and write nothing', () => {
    const doc = newBoardDoc();
    const [id] = createImagePlaceholders(doc, [item(0)], 'g', 1);
    doc.getMap('objects').delete(id);
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    expect(markImageReady(doc, id, 'a/b')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 5)).toBe(false);
    expect(updates).toBe(0);
  });
});
