import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  initDoc,
  deleteObjects,
  LOCAL_ORIGIN,
  OBJECTS_MAP,
} from '../../src/shared/board-model';
import {
  abandonImagePlaceholders,
  createImagePlaceholders,
  displayStatus,
  imageSnapshots,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from '../../src/shared/objects/image';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Size } from '../../src/shared/objects/image';
import type { Point } from '../../src/shared/geometry';

/**
 * Story 12 — the image object itself (image.model).
 *
 * Size, layout, the one-transaction insert, and what an upload does to the undo
 * history: all of it is decided here on a real `Y.Doc` with a real `Y.UndoManager`,
 * because the interesting property — an add is one step and finishing its upload is
 * not a second one — is a property of the document, not of any widget.
 */

const NOW = 1_700_000_000_000;

/** A document, and a way to count how many updates one call produces. */
function fixture(): { doc: Y.Doc; updatesWhile: (body: () => void) => number } {
  const doc = new Y.Doc();
  initDoc(doc);
  let seen = 0;
  doc.on('update', () => {
    seen += 1;
  });
  return {
    doc,
    updatesWhile(body: () => void): number {
      seen = 0;
      body();
      return seen;
    },
  };
}

/** Three images as they would be after a drop of three files. */
function threeItems() {
  const sizes: Size[] = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 100, height: 400 },
  ];
  const rects = layoutRow(sizes, { x: 1000, y: 500 }, 'top-left');
  return rects.map((rect, i) => ({
    rect,
    naturalWidth: sizes[i]!.width,
    naturalHeight: sizes[i]!.height,
    contentType: 'image/png',
  }));
}

describe('placementSize (image.placement_size)', () => {
  // TC-03: never enlarged, scaled down together, longest side exactly at the limit.
  it('TC-03 keeps small images natural, scales big ones in proportion', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 }); // portrait
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 }); // exactly at the limit
  });

  it('puts the longest side on IMAGE_MAX_PLACE_SIZE_WORLD and nothing past it', () => {
    for (const [w, h] of [
      [799, 100],
      [800, 100],
      [801, 100],
      [4032, 3024],
      [1, 100_000],
    ] as const) {
      const size = placementSize(w, h);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
      if (Math.max(w, h) > IMAGE_MAX_PLACE_SIZE_WORLD) {
        expect(Math.max(size.width, size.height)).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
        // both sides move by the same factor, so the picture keeps its shape
        expect(size.width / size.height).toBeCloseTo(w / h, 10);
      }
    }
  });

  it('refuses to invent a size out of nonsense', () => {
    for (const [w, h] of [[0, 10], [10, 0], [-5, 10], [NaN, 10], [Infinity, 10]] as const) {
      expect(placementSize(w, h)).toEqual({ width: 0, height: 0 });
    }
  });
});

describe('layoutRow (image.drop, image.pick)', () => {
  // TC-04: left to right, tops aligned, exactly the named gap between neighbours.
  it('TC-04 lays a row from the top-left point with IMAGE_LAYOUT_GAP_WORLD between', () => {
    const sizes: Size[] = [
      { width: 400, height: 300 },
      { width: 200, height: 200 },
      { width: 100, height: 400 },
    ];
    const start: Point = { x: 1000, y: 500 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects.map((r) => r.width)).toEqual([400, 200, 100]);
    expect(rects.map((r) => r.y)).toEqual([500, 500, 500]); // tops aligned at the point
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 400, height: 300 });
    expect(rects[1]!.x).toBe(1000 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x).toBe(1000 + 400 + IMAGE_LAYOUT_GAP_WORLD + 200 + IMAGE_LAYOUT_GAP_WORLD);
  });

  it('centres the whole row on the point when the anchor is "centre"', () => {
    const sizes: Size[] = [
      { width: 400, height: 300 },
      { width: 200, height: 100 },
    ];
    const start: Point = { x: 0, y: 0 };
    const rects = layoutRow(sizes, start, 'centre');
    const rowWidth = 400 + IMAGE_LAYOUT_GAP_WORLD + 200;
    const rowHeight = Math.max(300, 100);
    expect(rects[0]!.x + rowWidth / 2).toBeCloseTo(0, 6); // row centred horizontally
    expect(rects[0]!.y + rowHeight / 2).toBeCloseTo(0, 6); // and vertically
    expect(rects[1]!.x).toBe(rects[0]!.x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    // A single image lands with its own centre on the point.
    const [one] = layoutRow([{ width: 400, height: 300 }], start, 'centre');
    expect(one).toEqual({ x: -200, y: -150, width: 400, height: 300 });
  });

  it('places nothing when the sizes are not sizes', () => {
    expect(layoutRow([], { x: 0, y: 0 }, 'top-left')).toEqual([]);
    for (const bad of [{ width: NaN, height: 10 }, { width: 10, height: -1 }]) {
      const rects = layoutRow([bad], { x: 0, y: 0 }, 'top-left');
      expect(rects.some((r) => !Number.isFinite(r.x) || !Number.isFinite(r.y))).toBe(false);
    }
  });
});

describe('createImagePlaceholders and the status updates (image.uploading, undo.steps)', () => {
  // TC-05: one add is one update, one undo step, and finishing an upload is neither.
  it('TC-05 inserts three placeholders in one update and keeps the undo stack at one step', () => {
    const { doc, updatesWhile } = fixture();
    const undo = new Y.UndoManager(doc.getMap(OBJECTS_MAP), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    const ids: string[] = [];
    const updates = updatesWhile(() => ids.push(...createImagePlaceholders(doc, threeItems(), 'leo', NOW)));
    expect(updates).toBe(1); // the whole add is a single transaction
    expect(ids).toHaveLength(3);

    const created = imageSnapshots(doc);
    expect(created).toHaveLength(3);
    const first = created.find((img) => img.id === ids[0])!;
    expect(first).toMatchObject({
      type: 'image',
      status: 'uploading',
      uploaderId: 'leo',
      uploadStartedAt: NOW,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 400,
      naturalHeight: 300,
      x: 1000,
      y: 500,
      width: 400,
      height: 300,
    });

    // The upload finishing changes the object but is not the uploader's doing to undo.
    expect(undo.undoStack.length).toBe(1);
    const second = created.find((img) => img.id === ids[1])!;
    expect(updatesWhile(() => markImageReady(doc, second.id, 'board/asset'))).toBe(1);
    expect(imageSnapshots(doc).find((img) => img.id === second.id)).toMatchObject({
      status: 'ready',
      assetKey: 'board/asset',
    });
    expect(undo.undoStack.length).toBe(1); // not a step of its own

    // One undo removes the whole add, ready object included, in one step.
    expect(undo.undo()).toBeTruthy();
    expect(imageSnapshots(doc)).toHaveLength(0);
    expect(undo.undoStack).toHaveLength(0);
    expect(undo.undo()).toBeFalsy(); // nothing left to take back

    // Redo puts the add back. What it comes back *as* is the interesting part of
    // story 8's rule: the untracked upload update is part of the same objects, so the
    // image that had finished is redone as the image it is, not as a placeholder.
    expect(undo.redo()).toBeTruthy();
    const redone = imageSnapshots(doc);
    expect(redone).toHaveLength(3);
    expect(redone.find((img) => img.id === second.id)?.status).toBe('ready');
    expect(redone.filter((img) => img.status === 'uploading')).toHaveLength(2);
  });

  it('gives each placeholder a rising z, and starts above everything already there', () => {
    const { doc } = fixture();
    createImagePlaceholders(doc, threeItems(), 'leo', NOW);
    const first = imageSnapshots(doc).map((img) => img.z);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    const last = imageSnapshots(doc).at(-1)!;
    expect(last.z).toBe(Math.max(...first) + 1);
  });

  it('writes nothing at all for an item without a usable rect', () => {
    const { doc, updatesWhile } = fixture();
    const junk = [
      { rect: { x: 0, y: 0, width: NaN, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
      { rect: { x: NaN, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' },
    ];
    expect(createImagePlaceholders(doc, junk, 'leo', NOW)).toEqual([]);
    expect(updatesWhile(() => createImagePlaceholders(doc, junk, 'leo', NOW))).toBe(0);
    expect(imageSnapshots(doc)).toHaveLength(0);
    // An empty add is not an undo step either.
    expect(createImagePlaceholders(doc, [], 'leo', NOW)).toEqual([]);
  });

  // TC-07: an id that is gone is gone; the update does not happen.
  it('TC-07 refuses to update an image that has been deleted', () => {
    const { doc, updatesWhile } = fixture();
    const [id] = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    expect(deleteObjects(doc, [id])).toBe(1);

    expect(updatesWhile(() => markImageReady(doc, id, 'board/asset'))).toBe(0);
    expect(updatesWhile(() => markImageFailed(doc, id))).toBe(0);
    expect(updatesWhile(() => markImageRetrying(doc, id, NOW))).toBe(0);
    expect(imageSnapshots(doc)).toHaveLength(0);
  });

  it('marks a retry as uploading again, with a fresh clock stamp', () => {
    const { doc } = fixture();
    const [id] = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    markImageFailed(doc, id);
    expect(snapshotOf(doc, id)).toMatchObject({ status: 'failed' });
    expect(markImageRetrying(doc, id, NOW + 5_000)).toBe(true);
    expect(snapshotOf(doc, id)).toMatchObject({ status: 'uploading', uploadStartedAt: NOW + 5_000 });
  });

  it('writes status updates with an origin the UndoManager does not track', () => {
    const { doc } = fixture();
    const [id] = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    markImageReady(doc, id, 'board/asset');
    expect(origins).toEqual([UPLOAD_ORIGIN]);
    expect(origins).not.toContain(LOCAL_ORIGIN);
  });

  /* Storage answered 415/413: the file is not addable, so the placeholder the add
     created is taken back (PRD image.types, image.size_limit) — and that clean-up is not
     an undo step of its own, because nobody did anything to undo. */
  it('takes back a placeholder storage refused, without a step in the history', () => {
    const { doc, updatesWhile } = fixture();
    // Asked for before the add, because a history only knows about what happens after
    // it starts listening — which is exactly what a real board's does.
    const undo = new Y.UndoManager(doc.getMap(OBJECTS_MAP), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    const ids = createImagePlaceholders(doc, threeItems(), 'leo', NOW);

    const abandoned = abandonImagePlaceholders(doc, [ids[0], 'not-there']);
    expect(abandoned).toBe(1);
    const left = imageSnapshots(doc);
    expect(left).toHaveLength(2);
    expect(left.map((img) => img.id)).toEqual([ids[1], ids[2]]);

    // It went out untracked, like every other upload bookkeeping …
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
    abandonImagePlaceholders(doc, []);
    expect(updatesWhile(() => abandonImagePlaceholders(doc, [ids[1]]))).toBe(1);
    expect(origins[origins.length - 1]).toBe(UPLOAD_ORIGIN);

    // … and the one add is still the one step: undoing it takes the rest away too.
    expect(undo.undoStack.length).toBe(1);
    undo.undo();
    expect(imageSnapshots(doc)).toHaveLength(0);
  });

  it('leaves alone an id that is not an image, and says it did nothing', () => {
    const { doc, updatesWhile } = fixture();
    const sticky = createSticky(doc, { x: 0, y: 0 });
    const ids = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    expect(abandonImagePlaceholders(doc, [sticky!, 'nope', ids[0]])).toBe(1);
    expect(imageSnapshots(doc)).toHaveLength(0);
    // The sticky that happened to share the call is still there, untouched.
    expect(snapshotOfSticky(doc, sticky!)).toBeTruthy();
    // A call with nothing to delete writes nothing at all.
    expect(updatesWhile(() => abandonImagePlaceholders(doc, ['nope']))).toBe(0);
  });
});

describe('displayStatus (image.unfinished)', () => {
  // TC-06: the stale boundary, ±1 ms.
  it('TC-06 turns "uploading" into "unfinished" only past IMAGE_UPLOAD_STALE_MS', () => {
    const { doc } = fixture();
    const [id] = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    const uploading = snapshotOf(doc, id);
    expect(displayStatus(uploading, NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(uploading, NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // exactly on the boundary is the same answer as one millisecond before it
    expect(displayStatus(uploading, NOW + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');

    markImageFailed(doc, id);
    const failed = snapshotOf(doc, id);
    expect(displayStatus(failed, NOW + IMAGE_UPLOAD_STALE_MS + 10_000)).toBe('failed');

    markImageRetrying(doc, id, NOW);
    markImageReady(doc, id, 'board/asset');
    const ready = snapshotOf(doc, id);
    expect(ready.status).toBe('ready');
    expect(displayStatus(ready, NOW + IMAGE_UPLOAD_STALE_MS * 10)).toBe('ready');
  });

  it('falls back to "uploading" for a status it does not recognise', () => {
    const { doc } = fixture();
    const [id] = createImagePlaceholders(doc, threeItems().slice(0, 1), 'leo', NOW);
    const raw = snapshotOf(doc, id);
    expect(displayStatus({ ...raw, status: 'nonsense' as never }, NOW)).toBe('uploading'); // read as intended
    expect(displayStatus({ ...raw, uploadStartedAt: NaN }, NOW + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
  });
});

/** Just enough of a note to prove the abandon call kept its hands off it. */
function snapshotOfSticky(doc: Y.Doc, id: string): unknown {
  const m = doc.getMap(OBJECTS_MAP).get(id);
  return m instanceof Y.Map && m.get('type') === 'sticky' ? m : undefined;
}

function snapshotOf(doc: Y.Doc, id: string): ImageSnap {
  const found = imageSnapshots(doc).find((img) => img.id === id);
  if (!found) throw new Error(`${id} is not on the board`);
  return found;
}
