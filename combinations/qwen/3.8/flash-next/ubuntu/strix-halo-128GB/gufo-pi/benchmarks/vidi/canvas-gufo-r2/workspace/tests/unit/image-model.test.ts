/**
 * Unit tests for the image object model (story 12, image.model).
 * TC-03 to TC-07. A real Y.Doc and a real UndoManager tracking LOCAL_ORIGIN only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImagePlaceholderItem,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN, snapshotAll } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

function imageSnapOf(doc: Y.Doc, id: string): ImageSnap {
  const snap = snapshotAll(doc).find((o) => o.id === id);
  if (!snap) throw new Error(`image ${id} missing from snapshot`);
  return snap as ImageSnap;
}

function items(): ImagePlaceholderItem[] {
  return [
    { rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' },
    { rect: { x: 424, y: 0, width: 200, height: 200 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/jpeg' },
    { rect: { x: 648, y: 0, width: 100, height: 600 }, naturalWidth: 100, naturalHeight: 600, contentType: 'image/gif' },
  ];
}

describe('placementSize (TC-03)', () => {
  it('does not upscale an image below the placement maximum', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales a large landscape image to the placement maximum', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales a tall portrait image on its longest side', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('leaves an exactly-maximum image untouched', () => {
    expect(placementSize(800, 800)).toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD });
  });

  it('returns a zero size for nonsense dimensions', () => {
    expect(placementSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 100, height: 600 },
  ];

  it('places a top-left anchored row from the drop point with gaps', () => {
    const rects = layoutRow(sizes, { x: 100, y: 50 }, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(rects[1].x).toBe(100 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(100 + 400 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    // Tops aligned on the drop point.
    expect(rects.map((r) => r.y)).toEqual([50, 50, 50]);
  });

  it('centres the whole row on the point for picker and paste', () => {
    const start = { x: 512, y: 384 };
    const rects = layoutRow(sizes, start, 'centre');
    const rowWidth = 400 + 200 + 100 + IMAGE_LAYOUT_GAP_WORLD * 2;
    const rowHeight = 600;
    const left = start.x - rowWidth / 2;
    const top = start.y - rowHeight / 2;
    expect(rects[0].x).toBeCloseTo(left, 6);
    expect(rects[0].y).toBeCloseTo(top, 6);
    const right = rects[2].x + rects[2].width;
    expect((left + right) / 2).toBeCloseTo(start.x, 6);
    const bottom = Math.max(...rects.map((r) => r.y + r.height));
    expect((top + bottom) / 2).toBeCloseTo(start.y, 6);
  });

  it('returns nothing for an empty selection or a bad anchor point', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
    expect(layoutRow(sizes, { x: Number.NaN, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('placeholders, status updates and undo (TC-05)', () => {
  let doc: Y.Doc;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    doc.getMap('objects');
    undoManager = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
      captureTimeout: 0,
    });
  });

  afterEach(() => {
    undoManager.destroy();
    doc.destroy();
  });

  it('creates all placeholders in one update and one undo step; completion adds none', () => {
    const updates: unknown[] = [];
    const onUpdate = (_update: Uint8Array, origin: unknown) => updates.push(origin);
    doc.on('update', onUpdate);

    const ids = createImagePlaceholders(doc, items(), 'uploader-1', 1000);
    expect(ids).toHaveLength(3);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(LOCAL_ORIGIN);

    const snapshots = ids.map((id) => imageSnapOf(doc, id));
    for (const snap of snapshots) {
      expect(snap.type).toBe('image');
      expect(snap.status).toBe('uploading');
      expect(snap.assetKey).toBeNull();
      expect(snap.uploaderId).toBe('uploader-1');
      expect(snap.uploadStartedAt).toBe(1000);
    }
    // Distinct, increasing z so the row stacks predictably.
    const zs = snapshots.map((s) => s.z);
    expect(new Set(zs).size).toBe(3);

    // Completion uses UPLOAD_ORIGIN: it must not extend the undo history.
    updates.length = 0;
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]).toBe(UPLOAD_ORIGIN);
    expect(undoManager.undoStack).toHaveLength(1);

    const ready = imageSnapOf(doc, ids[0]);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');

    // One undo removes the whole add action.
    undoManager.undo();
    expect(snapshotAll(doc).filter((o) => o.type === 'image')).toHaveLength(0);

    // Redo restores the objects with their finished state.
    undoManager.redo();
    const restored = ids.map((id) => imageSnapOf(doc, id));
    expect(restored).toHaveLength(3);
    expect(restored[0].status).toBe('ready');
    expect(restored[0].assetKey).toBe('board/asset');
  });

  it('skips items with non-finite geometry and writes nothing when none survive', () => {
    const updates: Uint8Array[] = [];
    doc.on('update', (update) => updates.push(update));
    const bad: ImagePlaceholderItem[] = [
      { rect: { x: 0, y: 0, width: Number.NaN, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      { rect: { x: 0, y: 0, width: 10, height: 0 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
    ];
    expect(createImagePlaceholders(doc, bad, 'uploader-1', 1)).toEqual([]);
    expect(updates).toHaveLength(0);
  });

  it('records failure and retry through the untracked origin', () => {
    const [id] = createImagePlaceholders(doc, [items()[0]], 'uploader-1', 1000);

    expect(markImageFailed(doc, id)).toBe(true);
    expect(imageSnapOf(doc, id).status).toBe('failed');

    expect(markImageRetrying(doc, id, 5000)).toBe(true);
    const retrying = imageSnapOf(doc, id);
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(5000);

    // Still exactly one undo step: the insertion.
    expect(undoManager.undoStack).toHaveLength(1);
  });

  it('ignores status updates for unknown or non-image ids (TC-07)', () => {
    const updates: Uint8Array[] = [];
    doc.on('update', (update) => updates.push(update));
    expect(markImageReady(doc, 'missing', 'board/asset')).toBe(false);
    expect(markImageFailed(doc, 'missing')).toBe(false);
    expect(markImageRetrying(doc, 'missing', 1)).toBe(false);
    expect(updates).toHaveLength(0);

    // A deleted image id is stale too.
    const [id] = createImagePlaceholders(doc, [items()[0]], 'uploader-1', 1000);
    doc.getMap('objects').delete(id);
    updates.length = 0;
    expect(markImageReady(doc, id, 'board/asset')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const base: ImageSnap = {
    id: 'img',
    type: 'image',
    x: 0,
    y: 0,
    z: 1,
    createdAt: 0,
    width: 100,
    height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 1_000,
    uploaderId: 'u',
  };

  it('is uploading until the stale timeout, then unfinished', () => {
    expect(displayStatus(base, 1_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(base, 1_000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(base, 1_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('reports failed and ready unchanged', () => {
    expect(displayStatus({ ...base, status: 'failed' }, 1_000 + IMAGE_UPLOAD_STALE_MS + 10)).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready', assetKey: 'b/a' }, 10 ** 12)).toBe('ready');
  });
});
