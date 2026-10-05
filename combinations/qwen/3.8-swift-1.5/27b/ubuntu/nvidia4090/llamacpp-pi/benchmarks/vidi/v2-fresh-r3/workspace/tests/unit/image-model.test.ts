import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  UPLOAD_ORIGIN,
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  displayStatus,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { snapshotObjects, deleteObjects, LOCAL_ORIGIN } from '../../src/shared/board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

/** All image snaps in the doc, in render order. */
function images(doc: Y.Doc): ImageSnap[] {
  return snapshotObjects(doc).filter((o) => o.type === 'image') as ImageSnap[];
}

const NOW = 1_700_000_000_000;

describe('TC-03: placementSize — natural size, longest side capped, never enlarged', () => {
  it('400x300 → 400x300 (below the cap: unchanged)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('1600x1200 → 800x600 (landscape scaled down)', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('300x3200 → 75x800 (portrait scaled down)', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('800x800 → 800x800 (exactly at IMAGE_MAX_PLACE_SIZE_WORLD)', () => {
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
  });
});

describe('TC-04: layoutRow — left to right with gaps, anchored top-left or centred', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 60 },
    { width: 120, height: 40 },
  ];

  it('top-left: first image top-left at the point, tops aligned, gap IMAGE_LAYOUT_GAP_WORLD', () => {
    const start = { x: 1000, y: 2000 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 1000, y: 2000, width: 100, height: 50 });
    expect(rects[1].x).toBe(1000 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(1000 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    for (const r of rects) expect(r.y).toBe(2000);
    expect(rects[1]).toEqual({ x: rects[1].x, y: 2000, width: 80, height: 60 });
    expect(rects[2]).toEqual({ x: rects[2].x, y: 2000, width: 120, height: 40 });
  });

  it('centre: the whole row is centred on the point', () => {
    const start = { x: 500, y: 400 };
    const totalWidth = 100 + 80 + 120 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const maxH = 60;
    const rects = layoutRow(sizes, start, 'centre');
    expect(rects[0].x).toBeCloseTo(500 - totalWidth / 2, 6);
    expect(rects[0].x + totalWidth).toBeCloseTo(500 + totalWidth / 2, 6);
    expect(rects[0].y).toBeCloseTo(400 - maxH / 2, 6);
  });
});

describe('TC-05: createImagePlaceholders + markImageReady — one undo step, untracked completion', () => {
  let doc: Y.Doc;
  let undo: Y.UndoManager;

  beforeEach(() => {
    doc = new Y.Doc();
    undo = new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
  });

  const item = (rect: Rect, naturalWidth: number, naturalHeight: number) => ({
    rect,
    naturalWidth,
    naturalHeight,
    contentType: 'image/png',
  });

  it('3 items → 3 uploading placeholders in one doc update', () => {
    let updates = 0;
    doc.on('update', () => updates++);

    const ids = createImagePlaceholders(
      doc,
      [
        item({ x: 0, y: 0, width: 100, height: 50 }, 100, 50),
        item({ x: 124, y: 0, width: 80, height: 60 }, 80, 60),
        item({ x: 228, y: 0, width: 120, height: 40 }, 120, 40),
      ],
      'leo',
      NOW,
    );

    expect(updates).toBe(1);
    expect(ids).toHaveLength(3);
    const snaps = images(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('leo');
      expect(s.uploadStartedAt).toBe(NOW);
      expect(s.assetKey).toBeNull();
    }
    // Row layout preserved.
    expect(snaps[0].x).toBe(0);
    expect(snaps[1].x).toBe(100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(snaps[2].x).toBe(100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('markImageReady (UPLOAD_ORIGIN) sets assetKey without a new undo step; undo removes all 3', () => {
    const ids = createImagePlaceholders(
      doc,
      [
        item({ x: 0, y: 0, width: 100, height: 50 }, 100, 50),
        item({ x: 124, y: 0, width: 80, height: 60 }, 80, 60),
        item({ x: 228, y: 0, width: 120, height: 40 }, 120, 40),
      ],
      'leo',
      NOW,
    );

    // One undo step for the whole add action.
    expect(undo.undoStack.length).toBe(1);

    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    const ready = images(doc)[0];
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');

    // Completion is NOT its own undo step.
    expect(undo.undoStack.length).toBe(1);

    // Undo removes all three placeholders in one step.
    // (yjs 13.6: undo() returns the popped StackItem, or null when the stack is empty.)
    expect(undo.undo()).not.toBeNull();
    expect(images(doc)).toHaveLength(0);
    expect(undo.undoStack.length).toBe(0);
  });

  it('items with non-finite sizes are skipped', () => {
    const ids = createImagePlaceholders(
      doc,
      [
        item({ x: 0, y: 0, width: NaN, height: 50 }, 100, 50),
        item({ x: 0, y: 0, width: 100, height: 50 }, 100, 50),
      ],
      'leo',
      NOW,
    );
    expect(ids).toHaveLength(1);
    expect(images(doc)).toHaveLength(1);
  });
});

describe('TC-06: displayStatus — stale boundary, failed, ready', () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(() => {
    doc = new Y.Doc();
    id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'leo',
      NOW,
    )[0];
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS - 1 → uploading', () => {
    const img = images(doc)[0];
    expect(displayStatus(img, NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading at IMAGE_UPLOAD_STALE_MS + 1 → unfinished', () => {
    const img = images(doc)[0];
    expect(displayStatus(img, NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed → failed', () => {
    expect(markImageFailed(doc, id)).toBe(true);
    expect(displayStatus(images(doc)[0], NOW + IMAGE_UPLOAD_STALE_MS + 1000)).toBe('failed');
  });

  it('ready → ready (even long after start)', () => {
    expect(markImageReady(doc, id, 'board/asset')).toBe(true);
    expect(displayStatus(images(doc)[0], NOW + IMAGE_UPLOAD_STALE_MS + 1000)).toBe('ready');
  });
});

describe('TC-07: status updates on a deleted id → false, no update', () => {
  it('markImageReady / markImageFailed / markImageRetrying on a stale id', () => {
    const doc = new Y.Doc();
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'leo',
      NOW,
    )[0];
    expect(deleteObjects(doc, [id])).toBe(1);

    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, id, 'board/asset')).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, NOW)).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('markImageRetrying (support for Retry)', () => {
  it('failed → uploading with a fresh uploadStartedAt', () => {
    const doc = new Y.Doc();
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
      'leo',
      NOW,
    )[0];
    expect(markImageFailed(doc, id)).toBe(true);
    const later = NOW + 60_000;
    expect(markImageRetrying(doc, id, later)).toBe(true);
    const img = images(doc)[0];
    expect(img.status).toBe('uploading');
    expect(img.uploadStartedAt).toBe(later);
    expect(displayStatus(img, later + 1)).toBe('uploading');
  });
});

/** UPLOAD_ORIGIN is a symbol distinct from LOCAL_ORIGIN (untracked by undo). */
describe('UPLOAD_ORIGIN', () => {
  it('is a unique symbol, not LOCAL_ORIGIN', () => {
    expect(typeof UPLOAD_ORIGIN).toBe('symbol');
    expect(UPLOAD_ORIGIN).not.toBe(LOCAL_ORIGIN);
  });
});
