import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
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
import { createUndo } from '../../src/client/board/undo';

const item = (x: number, w = 100, h = 50) => ({ rect: { x, y: 10, width: w, height: h }, naturalWidth: w, naturalHeight: h, contentType: 'image/png' });
const images = (doc: Y.Doc) => snapshot(doc).filter((o): o is ImageSnap => o.type === 'image');

describe('placementSize', () => {
  it('TC-03: keeps small images, scales large ones so the longest side is 800', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });
});

describe('layoutRow', () => {
  const sizes = [{ width: 100, height: 50 }, { width: 200, height: 80 }, { width: 60, height: 60 }];
  it('TC-04: top-left starts at the point with tops aligned and a gap between images', () => {
    const r = layoutRow(sizes, { x: 500, y: 300 }, 'top-left');
    expect(r.map((q) => q.y)).toEqual([300, 300, 300]);
    expect(r[0].x).toBe(500);
    expect(r[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(r[2].x).toBe(r[1].x + 200 + IMAGE_LAYOUT_GAP_WORLD);
  });
  it('TC-04: centre centres the whole row on the point', () => {
    const r = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = r[0].x;
    const right = r[2].x + r[2].width;
    expect((left + right) / 2).toBeCloseTo(0);
    expect(r[1].x - (r[0].x + r[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });
});

describe('image placeholders and status', () => {
  it('TC-05: three placeholders in one update, completion is not its own undo step', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    let updates = 0;
    doc.on('update', () => updates++);
    const ids = createImagePlaceholders(doc, [item(0), item(150), item(300)], 'g_me', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    expect(images(doc).every((i) => i.status === 'uploading' && i.uploaderId === 'g_me' && i.uploadStartedAt === 1000 && i.assetKey === null)).toBe(true);
    expect(markImageReady(doc, ids[1], 'a/b')).toBe(true);
    expect(images(doc).find((i) => i.id === ids[1])).toMatchObject({ status: 'ready', assetKey: 'a/b' });
    expect(undo.canUndo()).toBe(true);
    expect((doc.getMap('objects') as Y.Map<unknown>).size).toBe(3);
    undo.undo();
    expect(images(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('retry and failure transitions', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, [item(0)], 'g_me', 1);
    expect(markImageFailed(doc, id)).toBe(true);
    expect(images(doc)[0].status).toBe('failed');
    expect(markImageRetrying(doc, id, 99)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 99 });
  });

  it('non-finite sizes are skipped', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(doc, [{ ...item(0), rect: { x: 0, y: 0, width: NaN, height: 5 } }, item(10)], 'g_me', 1);
    expect(ids).toHaveLength(1);
  });

  it('TC-06: uploading turns unfinished after IMAGE_UPLOAD_STALE_MS', () => {
    const base = { uploadStartedAt: 1000 };
    expect(displayStatus({ ...base, status: 'uploading' }, 1000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus({ ...base, status: 'uploading' }, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ ...base, status: 'failed' }, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready' }, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('ready');
  });

  it('TC-07: status updates on a deleted id return false and write nothing', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, [item(0)], 'g_me', 1);
    doc.transact(() => (doc.getMap('objects') as Y.Map<unknown>).delete(id), LOCAL_ORIGIN);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, 'a/b')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 5)).toBe(false);
    expect(updates).toBe(0);
  });
});
