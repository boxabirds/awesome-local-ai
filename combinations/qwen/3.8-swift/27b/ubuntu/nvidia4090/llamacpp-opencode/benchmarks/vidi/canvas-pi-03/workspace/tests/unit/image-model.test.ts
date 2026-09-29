/**
 * Story 12: image object model (image.model unit, TC-03 to TC-07).
 *
 * Placement, row layout, placeholder creation and status transitions on a
 * REAL Y.Doc with a REAL Y.UndoManager tracking LOCAL_ORIGIN only — the
 * undo-step assertions (TC-05) are the point of the suite.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
} from 'src/shared/objects/image';
import { LOCAL_ORIGIN } from 'src/shared/board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from 'src/shared/config';
import type { Rect, Point } from 'src/shared/geometry';

function makeDoc(): { doc: Y.Doc; undo: Y.UndoManager } {
  const doc = new Y.Doc();
  const undo = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });
  return { doc, undo };
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

const ITEM = (
  rect: Rect,
  natural = { naturalWidth: 400, naturalHeight: 300 },
) => ({ rect, ...natural, contentType: 'image/png' });

describe('TC-03: placementSize (image.placement_size)', () => {
  it('never upscales: 400x300 stays 400x300', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales down: 1600x1200 → 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('portrait: 300x3200 → 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('boundary: 800x800 stays 800x800 (longest side = IMAGE_MAX_PLACE_SIZE_WORLD)', () => {
    expect(placementSize(800, 800)).toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: IMAGE_MAX_PLACE_SIZE_WORLD });
  });
});

describe('TC-04: layoutRow (image.drop / image.pick / image.paste)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 30 },
  ];

  it('top-left anchor: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const start: Point = { x: 10, y: 20 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(rects[1].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1].y).toBe(20);
    expect(rects[2].x).toBe(10 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].y).toBe(20);
  });

  it('centre anchor: the row is centred on the point', () => {
    const centre: Point = { x: 500, y: 400 };
    const rects = layoutRow(sizes, centre, 'centre');
    const totalWidth = 100 + 80 + 60 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const maxHeight = 50;
    expect(rects[0].x).toBeCloseTo(centre.x - totalWidth / 2, 5);
    expect(rects[0].x + totalWidth).toBeCloseTo(centre.x + totalWidth / 2, 5);
    expect(rects[0].y).toBeCloseTo(centre.y - maxHeight / 2, 5);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i].x).toBeCloseTo(rects[i - 1].x + rects[i - 1].width + IMAGE_LAYOUT_GAP_WORLD, 5);
      expect(rects[i].y).toBeCloseTo(rects[0].y, 5);
    }
  });
});

describe('TC-05: createImagePlaceholders + markImageReady (one undo step)', () => {
  let doc: Y.Doc;
  let undo: Y.UndoManager;

  beforeEach(() => {
    ({ doc, undo } = makeDoc());
  });

  it('creates 3 uploading placeholders in one update; ready is not its own step; undo removes all 3', async () => {
    // Yjs emits 'update' on a microtask, so count after a macrotask tick.
    const settle = () => new Promise((r) => setTimeout(r, 0));
    let updates = 0;
    const onUpdate = () => {
      updates += 1;
    };
    doc.on('update', onUpdate);

    const items = [
      ITEM({ x: 0, y: 0, width: 100, height: 50 }),
      ITEM({ x: 124, y: 0, width: 80, height: 40 }),
      ITEM({ x: 228, y: 0, width: 60, height: 30 }),
    ];
    const now = 1_700_000_000_000;
    const ids = createImagePlaceholders(doc, items, 'uploader-1', now);

    await settle();
    doc.off('update', onUpdate);
    expect(updates).toBe(1); // one LOCAL_ORIGIN transaction → one update
    expect(ids).toHaveLength(3);

    const objects = objectsOf(doc);
    for (const id of ids) {
      const obj = objects.get(id);
      expect(obj).toBeInstanceOf(Y.Map);
      expect(obj!.get('type')).toBe('image');
      expect(obj!.get('status')).toBe('uploading');
      expect(obj!.get('uploaderId')).toBe('uploader-1');
      expect(obj!.get('uploadStartedAt')).toBe(now);
      expect(obj!.get('assetKey')).toBeNull();
    }

    // Upload completion (UPLOAD_ORIGIN) must NOT be a separate undo step.
    expect(markImageReady(doc, ids[0], `${ids[0]}/asset`)).toBe(true);
    await settle();
    expect(undo.undoStack.length).toBe(1);
    const ready = objects.get(ids[0])!;
    expect(ready.get('status')).toBe('ready');
    expect(ready.get('assetKey')).toBe(`${ids[0]}/asset`);

    // One undo removes ALL three placeholders at once.
    undo.undo();
    for (const id of ids) expect(objects.get(id)).toBeUndefined();
  });

  it('skips items with non-finite sizes and uses increasing z', () => {
    const items = [
      ITEM({ x: 0, y: 0, width: 10, height: 10 }),
      { rect: { x: NaN, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      ITEM({ x: 50, y: 0, width: 10, height: 10 }),
    ];
    const ids = createImagePlaceholders(doc, items, 'u', 1);
    expect(ids).toHaveLength(2);
    const objects = objectsOf(doc);
    const zs = ids.map((id) => Number(objects.get(id)!.get('z')));
    expect(zs[1]).toBeGreaterThan(zs[0]);
  });
});

describe('TC-06: displayStatus (image.unfinished boundary)', () => {
  const base = {
    id: 'i',
    type: 'image' as const,
    x: 0,
    y: 0,
    z: 1,
    width: 10,
    height: 10,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 10,
    naturalHeight: 10,
    uploaderId: 'u',
  };

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = { ...base, status: 'uploading' as const, uploadStartedAt: 0 };
    expect(displayStatus(img, IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = { ...base, status: 'uploading' as const, uploadStartedAt: 0 };
    expect(displayStatus(img, IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed; ready → ready', () => {
    expect(
      displayStatus({ ...base, status: 'failed', uploadStartedAt: 0 }, IMAGE_UPLOAD_STALE_MS + 1),
    ).toBe('failed');
    expect(
      displayStatus({ ...base, status: 'ready', uploadStartedAt: 0 }, IMAGE_UPLOAD_STALE_MS + 1),
    ).toBe('ready');
  });
});

describe('TC-07: status updates on a deleted id (error path)', () => {
  it('markImageReady / markImageFailed / markImageRetrying return false and write nothing', async () => {
    const { doc } = makeDoc();
    const ids = createImagePlaceholders(
      doc,
      [ITEM({ x: 0, y: 0, width: 10, height: 10 })],
      'u',
      1,
    );
    const objects = objectsOf(doc);
    objects.delete(ids[0]);

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(markImageReady(doc, ids[0], 'k')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(markImageRetrying(doc, ids[0], 2)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(updates).toBe(0);
  });

  it('markImageRetrying flips a failed object back to uploading with a fresh timestamp', () => {
    const { doc } = makeDoc();
    const [id] = createImagePlaceholders(doc, [ITEM({ x: 0, y: 0, width: 10, height: 10 })], 'u', 1);
    expect(markImageFailed(doc, id)).toBe(true);
    const obj = objectsOf(doc).get(id)!;
    expect(obj.get('status')).toBe('failed');
    expect(markImageRetrying(doc, id, 42)).toBe(true);
    expect(obj.get('status')).toBe('uploading');
    expect(obj.get('uploadStartedAt')).toBe(42);
  });
});
