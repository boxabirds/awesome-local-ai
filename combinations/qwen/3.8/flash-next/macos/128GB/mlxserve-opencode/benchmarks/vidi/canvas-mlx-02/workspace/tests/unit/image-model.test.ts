// The image model: placement size, row layout, and the placeholder lifecycle with
// its undo isolation (TC-05 to TC-10). These are pure Y.Doc tests - no upload, no
// browser - because everything that makes an image behave like the other board
// objects lives here.
//
// The one subtlety these tests exist to pin down: placeholders are created under
// LOCAL_ORIGIN (one undo step), while the ready/failed/retrying writes go out under
// UPLOAD_ORIGIN, which the story 8 UndoManager does not track. A "3 images, one
// Ctrl+Z" that also removes an image whose upload already finished is only true
// because of that split - and TC-05 proves it against a real UndoManager.
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { deleteObjects, LOCAL_ORIGIN, objectsSnapshot } from '../../src/shared/board-model.ts';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config.ts';
import {
  createImagePlaceholders,
  displayStatus,
  isImageSnapshot,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image.ts';

function docWithImages() {
  const doc = new Y.Doc();
  return doc;
}

/** The image snapshot for an id, read back through the real board reader. */
function readImage(doc: Y.Doc, id: string): ImageSnap {
  const found = objectsSnapshot(doc).find((o) => o.id === id);
  if (!found || !isImageSnapshot(found)) throw new Error(`no image ${id}`);
  return found;
}

describe('placementSize (TC-06)', () => {
  it('caps the longest side at the placement maximum, keeping the aspect', () => {
    // A 4000x3000 photo becomes 800x600 - the same 4:3, half the pixels per side.
    expect(placementSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    // A tall image is capped on its height and stays tall.
    expect(placementSize(1000, 4000)).toEqual({ width: 200, height: 800 });
  });

  it('never upscales a small image (TC-06)', () => {
    // 50x40 stays 50x40; a 4x4 stays 4x4. Upscaling a thumbnail to 800 would blur it.
    expect(placementSize(50, 40)).toEqual({ width: 50, height: 40 });
    expect(placementSize(4, 4)).toEqual({ width: 4, height: 4 });
  });

  it('refuses to place a box from non-finite or zero dimensions', () => {
    expect(placementSize(0, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(100, -1)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-10)', () => {
  it('lays two boxes left to right with a gap and aligned tops from a top-left anchor', () => {
    const sizes = [{ width: 300, height: 100 }, { width: 100, height: 300 }];
    const rects = layoutRow(sizes, { x: 1000, y: 2000 }, 'top-left');
    expect(rects[0]).toEqual({ x: 1000, y: 2000, width: 300, height: 100 });
    // The second starts after the first plus the gap; its top is level with the first.
    expect(rects[1]!.x).toBe(1000 + 300 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]!.y).toBe(2000);
    expect(rects[1]!.x).toBeGreaterThan(rects[0]!.x + rects[0]!.width);
  });

  it('hangs the whole row on the point for a centre anchor (TC-10)', () => {
    const a = { width: 100, height: 100 };
    const b = { width: 100, height: 100 };
    const centre = { x: 0, y: 0 };
    const rects = layoutRow([a, b], centre, 'centre');
    expect(rects.length).toBe(2);
    // The midpoint of the whole row's bounding box is the point itself.
    const minX = Math.min(rects[0]!.x, rects[1]!.x);
    const maxX = Math.max(rects[0]!.x + 100, rects[1]!.x + 100);
    const minY = Math.min(rects[0]!.y, rects[1]!.y);
    const maxY = Math.max(rects[0]!.y + 100, rects[1]!.y + 100);
    expect((minX + maxX) / 2).toBeCloseTo(0, 6);
    expect((minY + maxY) / 2).toBeCloseTo(0, 6);
  });

  it('returns nothing for an empty or all-invalid list', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
    expect(layoutRow([{ width: 0, height: 10 }] as never, { x: 0, y: 0 }, 'top-left')).toEqual([]);
  });
});

describe('image placeholder lifecycle', () => {
  it('adds three images in ONE undo step that removes all three (TC-05)', () => {
    const doc = docWithImages();
    const objects = doc.getMap('objects');
    // The story 8 manager, before any change, tracking only LOCAL_ORIGIN.
    const um = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });

    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
        { rect: { x: 200, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' },
        { rect: { x: 400, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/jpeg' },
      ],
      'tab-1',
      1000,
    );
    expect(ids.length).toBe(3);
    expect(objects.size).toBe(3);
    expect(um.undoStack.length).toBe(1);

    // One upload finishes BEFORE the person hits Ctrl+Z. Because that write is under
    // UPLOAD_ORIGIN it is invisible to the manager - the step is still just one.
    markImageReady(doc, ids[0]!, 'abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB');
    expect(readImage(doc, ids[0]!).status).toBe('ready');
    expect(um.undoStack.length).toBe(1);

    um.undo();
    expect(objects.size).toBe(0); // all three placeholders gone, ready one included
    um.destroy();
  });

  it('walks uploading -> ready -> failed -> retrying with a fresh clock (TC-07, TC-09)', () => {
    const doc = docWithImages();
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' }],
      'tab-1',
      5000,
    )!;

    let img = readImage(doc, id);
    expect(img.status).toBe('uploading');
    expect(img.uploadStartedAt).toBe(5000);
    expect(img.uploaderId).toBe('tab-1');
    expect(img.assetKey).toBeNull();
    expect(displayStatus(img, 5000)).toBe('uploading');

    // ready attaches the key.
    markImageReady(doc, id, 'board/asset');
    img = readImage(doc, id);
    expect(img.status).toBe('ready');
    expect(img.assetKey).toBe('board/asset');
    expect(displayStatus(img, 999999)).toBe('ready');

    // failed keeps the object (image.upload_failure) and shows failed to everyone.
    markImageFailed(doc, id);
    img = readImage(doc, id);
    expect(img.status).toBe('failed');
    expect(displayStatus(img, 999999)).toBe('failed');

    // a retry clears the key and restamps the clock so the stale sweep starts over.
    markImageRetrying(doc, id, 20000);
    img = readImage(doc, id);
    expect(img.status).toBe('uploading');
    expect(img.assetKey).toBeNull();
    expect(img.uploadStartedAt).toBe(20000);
    // freshly retrying, it is not "unfinished" even long after the original started.
    expect(displayStatus(img, 20000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
  });

  it('refuses a status write for a missing object and opens no transaction (TC-07)', () => {
    const doc = docWithImages();
    let updates = 0;
    doc.on('update', () => updates++);
    expect(markImageReady(doc, 'no-such-id', 'k')).toBe(false);
    expect(markImageFailed(doc, 'no-such-id')).toBe(false);
    expect(markImageRetrying(doc, 'no-such-id', 1)).toBe(false);
    expect(updates).toBe(0);
  });

  it('shows unfinished once an upload has sat past the stale span (TC-08)', () => {
    const base = { status: 'uploading' as const, uploadStartedAt: 1000 };
    const snap = { uploadStartedAt: 1000 } as ImageSnap;
    void base;
    // exactly at the stale span it is still "uploading"; one ms over, unfinished.
    expect(displayStatus(snap, 1000 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(snap, 1000 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('deletes a placeholder as its own undo step and restores it as uploading (TC-07)', () => {
    const doc = docWithImages();
    const objects = doc.getMap('objects');
    const um = new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' }],
      'tab-1',
      10,
    )!;
    um.undoStack.length = 0; // forget the create step; look only at the delete

    expect(deleteObjects(doc, [id])).toBe(1);
    expect(objects.size).toBe(0);
    um.undo(); // undoing the delete brings the placeholder back, still uploading
    const restored = readImage(doc, id);
    expect(restored.status).toBe('uploading');
    um.destroy();
  });
});
