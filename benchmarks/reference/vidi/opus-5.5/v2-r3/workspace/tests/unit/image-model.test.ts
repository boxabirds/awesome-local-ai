// Story 12 — image.model on a real Y.Doc and a real Y.UndoManager (TC-03 → TC-07).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, createSticky, deleteObjects, getObjectsMap, initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
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

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function images(doc: Y.Doc): ImageSnap[] {
  return objectsSnapshot(doc).filter(isImage);
}

function origins(doc: Y.Doc, fn: () => void): unknown[] {
  const out: unknown[] = [];
  const handler = (_u: Uint8Array, origin: unknown) => out.push(origin);
  doc.on('update', handler);
  try {
    fn();
  } finally {
    doc.off('update', handler);
  }
  return out;
}

const KEY = `${newBoardId()}/${newBoardId()}`;
const item = (x: number, w: number, h: number) => ({
  rect: { x, y: 10, width: w, height: h },
  naturalWidth: w,
  naturalHeight: h,
  contentType: 'image/png',
});

describe('placementSize (TC-03)', () => {
  it.each([
    [400, 300, 400, 300], // never enlarged
    [1600, 1200, 800, 600],
    [300, 3200, 75, 800], // portrait
    [800, 800, 800, 800], // exactly at the limit
    [801, 400, 800, 400 * (800 / 801)],
  ])('%ix%i → %ix%i', (w, h, ew, eh) => {
    const s = placementSize(w, h);
    expect(s.width).toBeCloseTo(ew, 9);
    expect(s.height).toBeCloseTo(eh, 9);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 200, height: 150 },
    { width: 80, height: 80 },
  ];

  it('top-left: first image at the point, tops aligned, IMAGE_LAYOUT_GAP_WORLD gaps', () => {
    const rects = layoutRow(sizes, { x: 500, y: -40 }, 'top-left');
    expect(rects.map((r) => r.y)).toEqual([-40, -40, -40]);
    expect(rects[0].x).toBe(500);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x - (rects[1].x + rects[1].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
    expect(rects.map((r) => [r.width, r.height])).toEqual(sizes.map((s) => [s.width, s.height]));
  });

  it('centre: the row is centred on the point', () => {
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const left = rects[0].x;
    const right = rects[2].x + rects[2].width;
    expect((left + right) / 2).toBeCloseTo(0, 9);
    const top = Math.min(...rects.map((r) => r.y));
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((top + bottom) / 2).toBeCloseTo(0, 9);
    expect(rects[1].x - (rects[0].x + rects[0].width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });

  it('no sizes → no rects', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'centre')).toEqual([]);
  });
});

describe('createImagePlaceholders and status updates (TC-05)', () => {
  it('3 placeholders in one update; ready on one is not its own undo step; undo removes all 3', () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const undo = createUndo(doc);
    let ids: string[] = [];
    const created = origins(doc, () => {
      ids = createImagePlaceholders(doc, [item(0, 100, 50), item(124, 200, 150), item(348, 80, 80)], 'c_me', 1234);
    });
    expect(created).toEqual([LOCAL_ORIGIN]);
    expect(ids).toHaveLength(3);
    const imgs = images(doc);
    expect(imgs.map((i) => i.status)).toEqual(['uploading', 'uploading', 'uploading']);
    for (const i of imgs) {
      expect(i.uploaderId).toBe('c_me');
      expect(i.uploadStartedAt).toBe(1234);
      expect(i.assetKey).toBeNull();
    }
    // Stacked above existing objects, in item order.
    expect(imgs.map((i) => i.id)).toEqual(ids);
    expect(Math.min(...imgs.map((i) => i.z))).toBeGreaterThan(objectsSnapshot(doc).find((o) => o.type === 'sticky')!.z);

    const readyOrigins = origins(doc, () => expect(markImageReady(doc, ids[1], KEY)).toBe(true));
    expect(readyOrigins).toEqual([UPLOAD_ORIGIN]);
    const ready = images(doc).find((i) => i.id === ids[1])!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe(KEY);
    expect(markImageFailed(doc, ids[2])).toBe(true);
    expect(images(doc).find((i) => i.id === ids[2])!.status).toBe('failed');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(images(doc)).toEqual([]);
    expect(objectsSnapshot(doc)).toHaveLength(1); // the note stays
    expect(undo.canUndo()).toBe(false); // exactly one step

    // Redo brings the placeholders back, including the untracked completion.
    expect(undo.redo()).toBe(true);
    const back = images(doc);
    expect(back).toHaveLength(3);
    expect(back.find((i) => i.assetKey === KEY)?.status).toBe('ready');
    undo.destroy();
  });

  it('retrying sets uploading with a new start time (UPLOAD_ORIGIN)', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 10, 10)], 'c_me', 1);
    markImageFailed(doc, id);
    expect(origins(doc, () => expect(markImageRetrying(doc, id, 99)).toBe(true))).toEqual([UPLOAD_ORIGIN]);
    const img = images(doc)[0];
    expect(img.status).toBe('uploading');
    expect(img.uploadStartedAt).toBe(99);
  });

  it('non-finite or empty sizes are skipped; nothing valid → no transaction', () => {
    const doc = newDoc();
    const bad = { ...item(0, 10, 10), rect: { x: NaN, y: 0, width: 10, height: 10 } };
    const empty = { ...item(0, 10, 10), naturalWidth: 0 };
    expect(origins(doc, () => expect(createImagePlaceholders(doc, [bad, empty], 'c', 1)).toEqual([]))).toEqual([]);
    expect(createImagePlaceholders(doc, [bad, item(0, 10, 10)], 'c', 1)).toHaveLength(1);
  });

  it('an invalid asset key is refused', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 10, 10)], 'c', 1);
    expect(markImageReady(doc, id, '../etc/passwd')).toBe(false);
    expect(images(doc)[0].status).toBe('uploading');
  });
});

describe('displayStatus (TC-06)', () => {
  const at = (status: ImageSnap['status']) => ({ status, uploadStartedAt: 1_000_000 });
  it('uploading turns unfinished only after IMAGE_UPLOAD_STALE_MS', () => {
    expect(displayStatus(at('uploading'), 1_000_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(at('uploading'), 1_000_000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(at('uploading'), 1_000_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });
  it('failed and ready never go stale', () => {
    const later = 1_000_000 + IMAGE_UPLOAD_STALE_MS * 10;
    expect(displayStatus(at('failed'), later)).toBe('failed');
    expect(displayStatus(at('ready'), later)).toBe('ready');
  });
});

describe('stale ids (TC-07)', () => {
  it('markImageReady / markImageFailed / markImageRetrying on a deleted id → false, no update', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 10, 10)], 'c', 1);
    deleteObjects(doc, [id]);
    const out = origins(doc, () => {
      expect(markImageReady(doc, id, KEY)).toBe(false);
      expect(markImageFailed(doc, id)).toBe(false);
      expect(markImageRetrying(doc, id, 5)).toBe(false);
    });
    expect(out).toEqual([]);
    expect(getObjectsMap(doc).has(id)).toBe(false);
  });

  it('a non-image object is never marked', () => {
    const doc = newDoc();
    const note = createSticky(doc, { x: 0, y: 0 });
    expect(markImageReady(doc, note, KEY)).toBe(false);
    expect(markImageFailed(doc, note)).toBe(false);
  });
});
