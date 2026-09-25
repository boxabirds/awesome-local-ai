/**
 * Story 12 · task 2 — image object model tests (TC-03 … TC-07).
 *
 * Pure-ish model work over a real `Y.Doc` and a real `Y.UndoManager` that
 * tracks only `LOCAL_ORIGIN`, because the two invariants the story rests on are
 * about the model, not the pixels:
 *
 *  - placement and layout are deterministic (TC-03, TC-04);
 *  - an add is ONE undo step and a completed upload is NOT a second one
 *    (TC-05) — the whole reason status changes use `UPLOAD_ORIGIN`.
 *
 * The stale / boundary cases (TC-06 the unfinished clock, TC-07 a deleted id)
 * pin the exact milliseconds and the no-op behaviour.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN, snapshot } from '../../src/shared/board-model';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Build an ImageSnap stand-in for the display-status tests. */
function img(over: Partial<ImageSnap>): ImageSnap {
  return {
    id: 'x',
    type: 'image',
    x: 0,
    y: 0,
    z: 1,
    width: 100,
    height: 100,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 0,
    uploaderId: 'u',
    ...over,
  };
}

describe('placementSize (TC-03)', () => {
  it('sizes to natural pixels and scales only down, portrait or landscape', () => {
    // No upscale: a 400×300 screenshot keeps its size.
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    // A landscape 1600×1200 photo scales its long (width) side to 800 …
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    // … and a tall 300×3200 scales its long (height) side to 800.
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    // Exactly at the limit: unchanged.
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(IMAGE_MAX_PLACE_SIZE_WORLD).toBe(800);
  });

  it('returns a zero box for a non-finite or empty size', () => {
    expect(placementSize(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(placementSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  it('places a top-left anchored row left to right with the named gap', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 120 },
      { width: 50, height: 50 },
    ];
    const start = { x: 500, y: 300 };
    const rects = layoutRow(sizes, start, 'top-left');
    // Tops aligned at the point.
    expect(rects.map((r) => r.y)).toEqual([300, 300, 300]);
    // Gaps of exactly IMAGE_LAYOUT_GAP_WORLD between the right edge of one and
    // the left edge of the next.
    expect(rects[0].x).toBe(500);
    expect(rects[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[1]).toMatchObject({ width: 200, height: 120 });
  });

  it('centres the whole row on the point for the centre anchor', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 200, height: 120 },
      { width: 50, height: 50 },
    ];
    const point = { x: 400, y: 400 };
    const rects = layoutRow(sizes, point, 'centre');
    const left = rects[0].x;
    const right = rects[2].x + rects[2].width;
    // Centred: the row's midpoint is the point, for both x and y.
    expect((left + right) / 2).toBeCloseTo(400, 6);
    const tallest = 120;
    expect(rects[0].y + tallest / 2).toBeCloseTo(400, 6);
  });
});

describe('createImagePlaceholders and status transitions (TC-05)', () => {
  it('writes 3 placeholders in ONE update, and completion is not its own undo step', () => {
    const doc = freshDoc();
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const updates: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => updates.push(origin));

    // Installed BEFORE the change, and tracking only LOCAL_ORIGIN.
    const undo = new Y.UndoManager(objects, {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });

    const rects = layoutRow(
      [
        { width: 200, height: 200 },
        { width: 300, height: 200 },
        { width: 100, height: 100 },
      ],
      { x: 0, y: 0 },
      'top-left',
    );
    const items = rects.map((rect) => ({
      rect,
      naturalWidth: Math.round(rect.width),
      naturalHeight: Math.round(rect.height),
      contentType: 'image/png',
    }));

    const ids = createImagePlaceholders(doc, items, 'leo', 1000);
    expect(ids).toHaveLength(3);

    // One transaction → one update event, under LOCAL_ORIGIN.
    expect(updates).toEqual([LOCAL_ORIGIN]);

    // All three exist as uploading placeholders carrying the uploader and clock.
    const snap = snapshot(doc);
    expect(snap).toHaveLength(3);
    for (const entry of snap) {
      expect(entry.type).toBe('image');
      expect(entry.status).toBe('uploading');
      expect(entry.assetKey).toBeNull();
      expect(entry.uploaderId).toBe('leo');
      expect(entry.uploadStartedAt).toBe(1000);
    }

    // The add is one undo step.
    expect(undo.undoStack.length).toBe(1);

    // Completing an upload writes under UPLOAD_ORIGIN …
    const before = updates.length;
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(true);
    const ready = snapshot(doc).find((e) => e.id === ids[0])!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');
    // … and does NOT add another undo step (the negative this story calls out).
    expect(undo.undoStack.length).toBe(1);
    expect(updates.length).toBe(before + 1); // there WAS a change, just untracked
    expect(updates[updates.length - 1]).toBe(UPLOAD_ORIGIN);

    // One undo removes the whole add, including the one that already became
    // ready. (`undo()` returns the undone StackItem, so just check it happened
    // and every object went away.)
    expect(undo.undo()).toBeTruthy();
    expect(snapshot(doc)).toHaveLength(0);
    undo.destroy();
  });
});

describe('displayStatus (TC-06)', () => {
  it('flips to unfinished just past the stale timeout, boundary included', () => {
    const now = 1_000_000;
    // One millisecond shy of stale: still uploading.
    expect(
      displayStatus(img({ status: 'uploading', uploadStartedAt: now - (IMAGE_UPLOAD_STALE_MS - 1) }), now),
    ).toBe('uploading');
    // Exactly at the boundary it is NOT yet unfinished (strictly greater than).
    expect(
      displayStatus(img({ status: 'uploading', uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS }), now),
    ).toBe('uploading');
    // One millisecond past: unfinished.
    expect(
      displayStatus(img({ status: 'uploading', uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1 }), now),
    ).toBe('unfinished');
    // The other states are returned unchanged.
    expect(displayStatus(img({ status: 'failed' }), now)).toBe('failed');
    expect(displayStatus(img({ status: 'ready' }), now)).toBe('ready');
  });
});

describe('status updates on a deleted id (TC-07)', () => {
  it('are a no-op for a stale id (no change, false)', () => {
    const doc = freshDoc();
    let changes = 0;
    doc.on('update', () => changes++);
    // The ids do not exist at all.
    expect(markImageReady(doc, 'missing', 'board/asset')).toBe(false);
    expect(markImageFailed(doc, 'missing')).toBe(false);
    expect(markImageRetrying(doc, 'missing', 5)).toBe(false);
    expect(changes).toBe(0);

    // And once deleted, a once-valid id is refused the same way.
    const ids = createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 0, y: 0, width: 100, height: 100 },
          naturalWidth: 100,
          naturalHeight: 100,
          contentType: 'image/png',
        },
      ],
      'leo',
      0,
    );
    doc.getMap<Y.Map<unknown>>('objects').delete(ids[0]);
    const before = changes;
    expect(markImageReady(doc, ids[0], 'board/asset')).toBe(false);
    expect(markImageFailed(doc, ids[0])).toBe(false);
    expect(changes).toBe(before);
  });
});