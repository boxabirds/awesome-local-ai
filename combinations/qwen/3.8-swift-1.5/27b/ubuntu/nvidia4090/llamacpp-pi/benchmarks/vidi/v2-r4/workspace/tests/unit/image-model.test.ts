/**
 * Unit tests — image object model (story 12, TC-03 to TC-07).
 *
 * Real Y.Doc with a real Y.UndoManager tracking LOCAL_ORIGIN only, so the
 * undo-step behaviour of placeholder creation vs. upload completion is
 * asserted against the real mechanism.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';

let doc: Y.Doc;
let undo: Y.UndoManager;

beforeEach(() => {
  doc = new Y.Doc();
  undo = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });
});

afterEach(() => {
  undo.destroy();
  doc.destroy();
});

describe('placementSize (TC-03)', () => {
  it('keeps natural size when below the limit (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales down landscape so the longest side is exactly the limit', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales down portrait so the longest side is exactly the limit', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('leaves an image at exactly the limit unchanged (boundary)', () => {
    expect(placementSize(IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 30 },
  ];

  it('top-left: first image starts at the point, row goes left to right with gaps, tops aligned', () => {
    const rects = layoutRow(sizes, { x: 300, y: 200 }, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 300, y: 200, width: 100, height: 50 });
    expect(rects[1].x).toBe(300 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(300 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    for (const r of rects) {
      expect(r.y).toBe(200);
    }
  });

  it('centre: the whole row is centred on the point', () => {
    const totalWidth = 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD + 60;
    const rects = layoutRow(sizes, { x: 500, y: 400 }, 'centre');
    expect(rects[0].x).toBeCloseTo(500 - totalWidth / 2);
    expect(rects[0].y).toBe(400);
    const last = rects[rects.length - 1];
    expect(last.x + last.width).toBeCloseTo(500 + totalWidth / 2);
  });
});

describe('createImagePlaceholders + status updates (TC-05)', () => {
  it('creates 3 uploading placeholders in ONE update; markImageReady is not its own undo step', () => {
    let updateCount = 0;
    doc.on('update', () => updateCount++);

    const items = [
      { rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 124, y: 0, width: 80, height: 40 }, naturalWidth: 80, naturalHeight: 40, contentType: 'image/png' },
      { rect: { x: 228, y: 0, width: 60, height: 30 }, naturalWidth: 60, naturalHeight: 30, contentType: 'image/png' },
    ];
    const now = 1_700_000_000_000;
    const ids = createImagePlaceholders(doc, items, 'uploader-1', now);

    expect(ids).toHaveLength(3);
    expect(updateCount).toBe(1); // one transaction for the whole add action

    const snaps = snapshot(doc).filter((o) => o.type === 'image') as ImageSnap[];
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('uploader-1');
      expect(s.uploadStartedAt).toBe(now);
      expect(s.assetKey).toBeNull();
    }

    // One undo step for the whole add action
    expect(undo.undoStack.length).toBe(1);

    // Upload completion uses UPLOAD_ORIGIN (untracked): no extra undo step
    const ok = markImageReady(doc, ids[0], 'boardId123456789012345678/assetId123456789012345678');
    expect(ok).toBe(true);
    expect(undo.undoStack.length).toBe(1);

    const ready = (snapshot(doc).find((o) => o.id === ids[0]) as ImageSnap);
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('boardId123456789012345678/assetId123456789012345678');

    // Undo removes all 3 placeholders in one step (yjs undo() returns the
    // popped StackItem, not a boolean)
    expect(undo.undo()).not.toBeNull();
    expect((snapshot(doc).filter((o) => o.type === 'image') as ImageSnap[]).length).toBe(0);
    expect(undo.undoStack.length).toBe(0);
  });
});

describe('displayStatus (TC-06)', () => {
  const base: ImageSnap = {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 50,
    status: 'uploading',
    uploadStartedAt: 1_000_000,
    uploaderId: 'u1',
  };

  it('uploading just before the stale timeout → uploading; just after → unfinished (boundary)', () => {
    expect(displayStatus(base, 1_000_000 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(base, 1_000_000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed stays failed; ready stays ready', () => {
    expect(displayStatus({ ...base, status: 'failed' }, 1_000_000 + IMAGE_UPLOAD_STALE_MS + 10_000)).toBe('failed');
    expect(displayStatus({ ...base, status: 'ready', assetKey: 'a/b' }, 1_000_000 + IMAGE_UPLOAD_STALE_MS + 10_000)).toBe('ready');
  });
});

describe('stale ids (TC-07)', () => {
  it('markImageReady / markImageFailed on a deleted id → false, no update', () => {
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'u1',
      1_000_000,
    );
    doc.transact(() => {
      doc.getMap('objects').delete(ids[0]);
    }, LOCAL_ORIGIN);

    let updateCount = 0;
    doc.on('update', () => updateCount++);
    expect(markImageReady(doc, ids[0], 'b/a')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(markImageRetrying(doc, ids[0], 2_000_000)).toBe(false);
    expect(updateCount).toBe(0);
  });
});

describe('markImageRetrying', () => {
  it('puts a failed placeholder back to uploading with a fresh timestamp (UPLOAD_ORIGIN)', () => {
    const ids = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'u1',
      1_000_000,
    );
    expect(markImageFailed(doc, ids[0])).toBe(true);
    expect(undo.undoStack.length).toBe(1); // failed is not an extra step

    expect(markImageRetrying(doc, ids[0], 5_000_000)).toBe(true);
    const snap = snapshot(doc).find((o) => o.id === ids[0]) as ImageSnap;
    expect(snap.status).toBe('uploading');
    expect(snap.uploadStartedAt).toBe(5_000_000);
    expect(undo.undoStack.length).toBe(1); // retry is not an extra step
    void UPLOAD_ORIGIN;
  });
});
