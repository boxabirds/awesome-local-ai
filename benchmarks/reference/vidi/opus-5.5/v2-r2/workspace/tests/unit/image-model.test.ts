// Story 12 — image.model: TC-03 to TC-07 on a real Y.Doc with a real Y.UndoManager
// that tracks LOCAL_ORIGIN only (as the app's undo controller does).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, deleteObjects, initDoc, objectsMap, objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  type ImageSnap,
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  isImage,
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

const images = (doc: Y.Doc) => objectsSnapshot(doc).filter(isImage) as ImageSnap[];
const item = (x: number, width: number, height: number) => ({
  rect: { x, y: 50, width, height },
  naturalWidth: width,
  naturalHeight: height,
  contentType: 'image/png',
});

describe('placementSize (TC-03)', () => {
  it.each([
    [400, 300, 400, 300],
    [1600, 1200, 800, 600],
    [300, 3200, 75, 800],
    [800, 800, 800, 800],
    [801, 400, 800, 400 * (800 / 801)],
    [1, 1, 1, 1],
  ])('%s×%s → %s×%s', (w, h, ew, eh) => {
    const size = placementSize(w, h);
    expect(size.width).toBeCloseTo(ew, 9);
    expect(size.height).toBeCloseTo(eh, 9);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 200, height: 150 },
    { width: 80, height: 80 },
  ];

  it('top-left: first image at the point, tops aligned, IMAGE_LAYOUT_GAP_WORLD between images', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([20, 20, 20]);
    expect(rects[0]!.x).toBe(10);
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x - (rects[1]!.x + rects[1]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects.map((r) => [r.width, r.height])).toEqual(sizes.map((s) => [s.width, s.height]));
  });

  it('centre: the row is centred on the point', () => {
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'centre');
    const left = rects[0]!.x;
    const right = rects[2]!.x + rects[2]!.width;
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((left + right) / 2).toBe(500);
    expect((top + bottom) / 2).toBe(300);
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });

  it('a single image centred on the point', () => {
    expect(layoutRow([{ width: 40, height: 20 }], { x: 0, y: 0 }, 'centre')).toEqual([{ x: -20, y: -10, width: 40, height: 20 }]);
  });
});

describe('placeholders and status (TC-05)', () => {
  it('creates 3 uploading placeholders in one update; ready is not its own undo step', () => {
    const doc = newDoc();
    const manager = new Y.UndoManager(objectsMap(doc), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    let updates = 0;
    doc.on('update', () => updates++);
    const ids = createImagePlaceholders(doc, [item(0, 100, 50), item(124, 200, 100), item(348, 60, 60)], 'uploader-1', 1234);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    const created = images(doc);
    expect(created.map((i) => i.id).sort()).toEqual([...ids].sort());
    for (const img of created) {
      expect(img).toMatchObject({ status: 'uploading', uploaderId: 'uploader-1', uploadStartedAt: 1234, assetKey: null, contentType: 'image/png' });
    }
    // z increases in item order, above everything else.
    const zs = ids.map((id) => created.find((i) => i.id === id)!.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));

    let origin: unknown = null;
    doc.once('afterTransaction', (tr: Y.Transaction) => (origin = tr.origin));
    expect(markImageReady(doc, ids[0]!, 'board/asset')).toBe(true);
    expect(origin).toBe(UPLOAD_ORIGIN);
    expect(images(doc).find((i) => i.id === ids[0])).toMatchObject({ status: 'ready', assetKey: 'board/asset' });
    expect(manager.undoStack).toHaveLength(1);

    manager.undo();
    expect(images(doc)).toHaveLength(0);
    // Redo brings the insertion back, including the untracked completion.
    manager.redo();
    const redone = images(doc);
    expect(redone).toHaveLength(3);
    expect(redone.find((i) => i.assetKey === 'board/asset')?.status).toBe('ready');
    manager.destroy();
  });

  it("with the app's undo controller: one step, undone in one press", () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    undo.boundary();
    const ids = createImagePlaceholders(doc, [item(0, 100, 50), item(124, 100, 50)], 'u', 1);
    undo.boundary();
    markImageReady(doc, ids[0]!, 'k/1');
    markImageFailed(doc, ids[1]!);
    markImageRetrying(doc, ids[1]!, 2);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(images(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });

  it('skips items with non-finite or empty sizes', () => {
    const doc = newDoc();
    const ids = createImagePlaceholders(
      doc,
      [item(0, Number.NaN, 10), item(0, 0, 10), { ...item(0, 10, 10), naturalWidth: Number.POSITIVE_INFINITY }, item(0, 10, 10)],
      'u',
      1,
    );
    expect(ids).toHaveLength(1);
    expect(createImagePlaceholders(doc, [], 'u', 1)).toEqual([]);
  });

  it('failed and retrying update status with UPLOAD_ORIGIN', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 10, 10)], 'u', 1);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(markImageFailed(doc, id!)).toBe(true);
    expect(images(doc)[0]!.status).toBe('failed');
    expect(markImageRetrying(doc, id!, 99)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: 99 });
    expect(origins).toEqual([UPLOAD_ORIGIN, UPLOAD_ORIGIN]);
  });
});

describe('displayStatus (TC-06)', () => {
  const start = 1_000_000;
  it.each([
    ['uploading', IMAGE_UPLOAD_STALE_MS - 1, 'uploading'],
    ['uploading', IMAGE_UPLOAD_STALE_MS, 'uploading'],
    ['uploading', IMAGE_UPLOAD_STALE_MS + 1, 'unfinished'],
    ['failed', IMAGE_UPLOAD_STALE_MS + 1, 'failed'],
    ['ready', IMAGE_UPLOAD_STALE_MS + 1, 'ready'],
    ['ready', 0, 'ready'],
  ] as const)('%s after %s ms → %s', (status, elapsed, expected) => {
    expect(displayStatus({ status, uploadStartedAt: start }, start + elapsed)).toBe(expected);
  });
});

describe('stale ids (TC-07)', () => {
  it('status updates on a deleted image return false and write nothing', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 10, 10)], 'u', 1);
    deleteObjects(doc, [id!]);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id!, 'a/b')).toBe(false);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(markImageRetrying(doc, id!, 5)).toBe(false);
    expect(markImageReady(doc, 'never-existed', 'a/b')).toBe(false);
    expect(updates).toBe(0);
    expect(images(doc)).toHaveLength(0);
  });
});
