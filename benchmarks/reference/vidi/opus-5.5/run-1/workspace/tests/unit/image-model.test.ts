/** image.model (story 12) on a real Y.Doc and a real Y.UndoManager: TC-03 to TC-07. */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { newBoardId } from '../../src/shared/board-id';
import { initDoc, LOCAL_ORIGIN, objectSnapshot } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { assetKeyFor } from '../../src/shared/image-format';
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
  type PlaceholderItem,
} from '../../src/shared/objects/image';

const UPLOADER = 'g_leo';
const NOW = 1_700_000_000_000;
const HALF = 2;
const KEY = assetKeyFor(newBoardId(), newBoardId());

function images(doc: Y.Doc): ImageSnap[] {
  return objectSnapshot(doc).filter(isImage);
}

function items(sizes: { width: number; height: number }[]): PlaceholderItem[] {
  const rects = layoutRow(sizes, { x: 100, y: 50 }, 'top-left');
  return rects.map((rect, i) => ({
    rect,
    naturalWidth: sizes[i]!.width,
    naturalHeight: sizes[i]!.height,
    contentType: 'image/png',
  }));
}

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

describe('TC-03 placementSize', () => {
  it('keeps small images at natural size and scales large ones to IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({ width: 800, height: 800 });
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD + 1, 1)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD / (IMAGE_MAX_PLACE_SIZE_WORLD + 1),
    });
  });
});

describe('TC-04 layoutRow', () => {
  const sizes = [
    { width: 400, height: 300 },
    { width: 200, height: 500 },
    { width: 100, height: 100 },
  ];

  it('top-left: first image at the point, left to right with the gap, tops aligned', () => {
    const rects = layoutRow(sizes, { x: 10, y: 20 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([20, 20, 20]);
    expect(rects[0]!.x).toBe(10);
    expect(rects[1]!.x).toBe(rects[0]!.x + rects[0]!.width + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x).toBe(rects[1]!.x + rects[1]!.width + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects.map((r) => [r.width, r.height])).toEqual(sizes.map((s) => [s.width, s.height]));
  });

  it('centre: the row as a whole is centred on the point', () => {
    const at = { x: 1000, y: -40 };
    const rects = layoutRow(sizes, at, 'centre');
    const left = rects[0]!.x;
    const right = rects[2]!.x + rects[2]!.width;
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((left + right) / HALF).toBeCloseTo(at.x);
    expect((top + bottom) / HALF).toBeCloseTo(at.y);
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    const single = layoutRow([{ width: 80, height: 60 }], at, 'centre');
    expect(single).toEqual([{ x: at.x - 40, y: at.y - 30, width: 80, height: 60 }]);
  });
});

describe('TC-05 placeholders and completion', () => {
  it('3 placeholders in one update and one undo step; completion is not a step of its own', () => {
    const doc = newDoc();
    const manager = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const ids = createImagePlaceholders(doc, items([{ width: 400, height: 300 }, { width: 200, height: 100 }, { width: 50, height: 50 }]), UPLOADER, NOW);
    expect(ids).toHaveLength(3);
    expect(updates).toBe(1);
    const created = images(doc);
    expect(created.map((i) => i.id).sort()).toEqual([...ids].sort());
    for (const img of created) {
      expect(img).toMatchObject({ status: 'uploading', assetKey: null, uploaderId: UPLOADER, uploadStartedAt: NOW });
    }
    expect(manager.undoStack).toHaveLength(1);

    // Well after the add (no merging into its step): completion still adds no step.
    manager.stopCapturing();
    expect(markImageReady(doc, ids[1]!, KEY)).toBe(true);
    expect(images(doc).find((i) => i.id === ids[1])).toMatchObject({ status: 'ready', assetKey: KEY });
    expect(manager.undoStack).toHaveLength(1);

    manager.undo();
    expect(images(doc)).toHaveLength(0);
    expect(manager.undoStack).toHaveLength(0);
  });

  it('stacks placeholders above existing objects in item order', () => {
    const doc = newDoc();
    const first = createImagePlaceholders(doc, items([{ width: 10, height: 10 }]), UPLOADER, NOW);
    const next = createImagePlaceholders(doc, items([{ width: 10, height: 10 }, { width: 20, height: 20 }]), UPLOADER, NOW);
    const z = new Map(images(doc).map((i) => [i.id, i.z]));
    expect(z.get(next[0]!)!).toBeGreaterThan(z.get(first[0]!)!);
    expect(z.get(next[1]!)!).toBeGreaterThan(z.get(next[0]!)!);
  });

  it("with the app's undo controller: one step, undo removes all, redo brings them back ready", () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    undo.boundary();
    const ids = createImagePlaceholders(doc, items([{ width: 40, height: 30 }, { width: 40, height: 30 }]), UPLOADER, NOW);
    undo.boundary();
    for (const id of ids) markImageReady(doc, id, KEY);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(images(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    expect(undo.redo()).toBe(true);
    const back = images(doc);
    expect(back).toHaveLength(2);
    // Upload completion was not its own step; redo restores the objects as they were last seen.
    for (const img of back) expect(img).toMatchObject({ status: 'ready', assetKey: KEY });
  });

  it('skips items with non-finite or non-positive sizes; none valid → no transaction', () => {
    const doc = newDoc();
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    const bad: PlaceholderItem[] = [
      { rect: { x: 0, y: 0, width: Number.NaN, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      { rect: { x: 0, y: 0, width: 0, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
    ];
    expect(createImagePlaceholders(doc, bad, UPLOADER, NOW)).toEqual([]);
    expect(updates).toBe(0);
    const ok = items([{ width: 10, height: 10 }]);
    expect(createImagePlaceholders(doc, [...bad, ...ok], UPLOADER, NOW)).toHaveLength(1);
  });

  it('status updates use UPLOAD_ORIGIN; retry sets uploading with a new start time', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, items([{ width: 10, height: 10 }]), UPLOADER, NOW);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(markImageFailed(doc, id!)).toBe(true);
    expect(images(doc)[0]!.status).toBe('failed');
    expect(markImageRetrying(doc, id!, NOW + 5)).toBe(true);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: NOW + 5 });
    expect(origins).toEqual([UPLOAD_ORIGIN, UPLOAD_ORIGIN]);
    // Only failed images can be retried; malformed keys are refused.
    expect(markImageRetrying(doc, id!, NOW)).toBe(false);
    expect(markImageReady(doc, id!, '../x')).toBe(false);
  });
});

describe('TC-06 displayStatus', () => {
  it('uploading turns unfinished only after IMAGE_UPLOAD_STALE_MS; failed and ready stay', () => {
    const start = NOW;
    expect(displayStatus({ status: 'uploading', uploadStartedAt: start }, start + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus({ status: 'uploading', uploadStartedAt: start }, start + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    expect(displayStatus({ status: 'failed', uploadStartedAt: start }, start + IMAGE_UPLOAD_STALE_MS * HALF)).toBe('failed');
    expect(displayStatus({ status: 'ready', uploadStartedAt: start }, start + IMAGE_UPLOAD_STALE_MS * HALF)).toBe('ready');
  });
});

describe('TC-07 stale ids', () => {
  it('markImageReady / markImageFailed on a deleted id → false, no update', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, items([{ width: 10, height: 10 }]), UPLOADER, NOW);
    doc.transact(() => doc.getMap('objects').delete(id!), LOCAL_ORIGIN);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(markImageReady(doc, id!, KEY)).toBe(false);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(markImageRetrying(doc, id!, NOW)).toBe(false);
    expect(updates).toBe(0);
  });
});
