// The image's part of the document (`image.model`, TC-03 to TC-07).
//
// These are pure document logic against a real `Y.Doc`: no DOM, no React, no browser,
// and the Durable Object could read the same shape — it imports the same module, which
// is why `src/shared` is kept DOM-free. The three things under test are the three that
// a reader cannot get from the type alone: placement size (only ever shrink, TC-03),
// row layout (aligned tops, gap exactly IMAGE_LAYOUT_GAP_WORLD, TC-04), and above all
// that an insertion is one undo step and an upload finishing is not (TC-05) — which is
// the reason `markImageReady` is written under `UPLOAD_ORIGIN` and not `LOCAL_ORIGIN`.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Image object model" — Tests.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  readImageSnapshot,
  type ImagePlaceholder,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';

/** Three placeholders of distinct sizes, laid out and ready to insert. */
const threePlaceholders = (): ImagePlaceholder[] => [
  { rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' },
  { rect: { x: 424, y: 0, width: 200, height: 200 }, naturalWidth: 200, naturalHeight: 200, contentType: 'image/jpeg' },
  { rect: { x: 648, y: 0, width: 100, height: 600 }, naturalWidth: 100, naturalHeight: 600, contentType: 'image/webp' },
];

const countUndoSteps = (undo: UndoController): number => {
  let steps = 0;
  while (undo.undo()) steps += 1;
  while (undo.redo()) {
    /* restore what we counted, so the doc is back as it was */
  }
  return steps;
};

describe('placementSize (image.placement_size, TC-03)', () => {
  // TC-03: the exact worked examples, including never enlarging a small image.
  it('caps the longest side and never enlarges', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    // Already inside the limit, so left exactly as it is: no blowing up to fill.
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
  });

  // The longest side never exceeds IMAGE_MAX_PLACE_SIZE_WORLD, whatever came in.
  it('keeps proportions and holds the limit', () => {
    for (const [w, h] of [[4032, 3024], [1, 100000], [9000, 9000]] as const) {
      const box = placementSize(w, h);
      expect(box).not.toBeNull();
      expect(Math.max(box!.width, box!.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
    }
  });

  // A nonsense natural size is a null, which the caller skips: no box to draw.
  it('has no box for a non-finite natural size', () => {
    expect(placementSize(NaN, 100)).toBeNull();
    expect(placementSize(100, Infinity)).toBeNull();
  });
});

describe('layoutRow (image.drop, image.paste, TC-04)', () => {
  const sizes = [
    { width: 400, height: 300 },
    { width: 200, height: 200 },
    { width: 100, height: 600 },
  ];
  const point = { x: 1000, y: 500 };

  // TC-04 (drop / top-left): the first image's top-left is the point; the rest advance
  // by their own width plus the gap; the tops are all on the line.
  it('runs a top-left row from the point with the exact gap', () => {
    const rects = layoutRow(sizes, point, 'top-left');
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 400, height: 300 });
    expect(rects[1]!.x).toBe(1000 + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x).toBe(rects[1]!.x + 200 + IMAGE_LAYOUT_GAP_WORLD);
    // TC-04: tops aligned at the point.
    expect(rects.map((rect) => rect.y)).toEqual([500, 500, 500]);
  });

  // TC-04 (paste / centre): the whole row is centred on the point, tops still aligned.
  it('centres a row on the point', () => {
    const rects = layoutRow(sizes, point, 'centre');
    const rowWidth = 400 + 200 + 100 + IMAGE_LAYOUT_GAP_WORLD * 2;
    const rowHeight = 600;
    expect(rects[0]!.x).toBe(point.x - rowWidth / 2);
    // The middle of the row lands on the point.
    const right = rects[2]!.x + rects[2]!.width;
    expect((rects[0]!.x + right) / 2).toBe(point.x);
    expect(rects.map((rect) => rect.y)).toEqual(Array(3).fill(point.y - rowHeight / 2));
    // Still exactly IMAGE_LAYOUT_GAP_WORLD between neighbours.
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBe(IMAGE_LAYOUT_GAP_WORLD);
  });

  // A size that is not finite is skipped and the row closes up without it.
  it('skips a non-finite size', () => {
    const rects = layoutRow([{ width: 100, height: 100 }, { width: NaN, height: 5 }], point, 'top-left');
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 1000, y: 500, width: 100, height: 100 });
  });
});

describe('createImagePlaceholders / undo (image.uploading, undo.history, TC-05)', () => {
  // TC-05: a batch insert is one undo step.
  it('is one undo step and one undo removes the whole batch', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const ids = createImagePlaceholders(doc, threePlaceholders(), 'me', 1000);

    expect(ids).toHaveLength(3);
    expect(countUndoSteps(undo)).toBe(1);
    // Every placeholder is present, `uploading`, at its final size, with no key yet.
    for (const id of ids) {
      const image = readImageSnapshot(doc, id)!;
      expect(image.status).toBe('uploading');
      expect(image.assetKey).toBeNull();
    }

    undo.undo();
    expect(snapshotObjects(doc).filter((object) => object.type === 'image')).toHaveLength(0);
  });

  // TC-05 (the important one): finishing an upload is *not* a separate undo step.
  it('leaves an upload completion out of the history, and one undo still removes all three', () => {
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    const ids = createImagePlaceholders(doc, threePlaceholders(), 'me', 1000);
    const before = countUndoSteps(undo);
    expect(before).toBe(1);

    // The network answers for one of them; this must not add a history step.
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, ids[0]!, key)).toBe(true);
    expect(countUndoSteps(undo)).toBe(1);

    // One undo takes all three back, the one whose upload finished included.
    undo.undo();
    expect(snapshotObjects(doc).filter((object) => object.type === 'image')).toHaveLength(0);
    expect(readImageSnapshot(doc, ids[0]!)).toBeNull();
  });

  // z climbs once per created object, so a row lands in a draw order without ties.
  it('gives each placeholder its own increasing z', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(doc, threePlaceholders(), 'me', 1000);
    const zs = ids.map((id) => readImageSnapshot(doc, id)!.z);
    expect(new Set(zs).size).toBe(3);
    const sorted = [...zs].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1]! - sorted[0]!).toBe(2);
  });

  // An item with no finite rectangle is skipped and gets no id back.
  it('skips an item whose rectangle is not finite', () => {
    const doc = new Y.Doc();
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: NaN, y: 0, width: 5, height: 5 }, naturalWidth: 5, naturalHeight: 5, contentType: 'image/png' },
        { rect: { x: 0, y: 0, width: 5, height: 5 }, naturalWidth: 5, naturalHeight: 5, contentType: 'image/png' },
      ],
      'me',
      1000,
    );
    expect(ids).toHaveLength(1);
    expect(snapshotObjects(doc).filter((object) => object.type === 'image')).toHaveLength(1);
  });

  // The batch rides in one `LOCAL_ORIGIN` transaction, so a remote reader who undoes
  // nothing keeps all of them; the write's origin is local on purpose.
  it('writes under the undoable local origin', () => {
    const doc = new Y.Doc();
    const before = doc.getMap('objects').size;
    createImagePlaceholders(doc, threePlaceholders(), 'me', 1000);
    expect(doc.getMap('objects').size).toBe(before + 3);
    // LOCAL_ORIGIN is what the undo manager tracks; a placeholder is undoable.
    const undo = createUndo(doc);
    const ids = createImagePlaceholders(doc, [threePlaceholders()[0]!], 'me', 1000);
    undo.undo();
    expect(readImageSnapshot(doc, ids[0]!)).toBeNull();
  });
});

describe('displayStatus (image.unfinished, TC-06)', () => {
  const uploading = { status: 'uploading' as const, uploadStartedAt: 1_000_000 };
  const snap = (over: Partial<ReturnType<typeof base>> = {}) => base(over);
  function base(over: Record<string, unknown> = {}) {
    const doc = new Y.Doc();
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'me',
      uploading.uploadStartedAt,
    )[0]!;
    for (const [key, value] of Object.entries(over)) {
      (doc.getMap('objects').get(id) as Y.Map<unknown>).set(key, value);
    }
    return readImageSnapshot(doc, id)!;
  }

  // TC-06: exactly STALE_MS is still uploading; one millisecond past it is unfinished.
  it('turns an abandoned upload unfinished one millisecond past the threshold', () => {
    const start = uploading.uploadStartedAt;
    const image = snap();
    expect(image.uploadStartedAt).toBe(start);
    expect(displayStatus(image, start + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image, start + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  // A finished state is final: staleness only ever applies to `uploading`.
  it('never turns a ready or failed image unfinished', () => {
    const doc = new Y.Doc();
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'me',
      0,
    )[0]!;
    markImageReady(doc, id, assetKeyFor(newBoardId(), newBoardId()));
    const ready = readImageSnapshot(doc, id)!;
    expect(ready.status).toBe('ready');
    // A thousand years later, still `ready` — it is the asset that outlives the clock.
    expect(displayStatus(ready, IMAGE_UPLOAD_STALE_MS * 1000)).toBe('ready');
  });
});

describe('markImageReady / markImageFailed / markImageRetrying (image.failed, TC-07)', () => {
  const fresh = (): { doc: Y.Doc; id: string } => {
    const doc = new Y.Doc();
    const id = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 10, height: 10 }, naturalWidth: 10, naturalHeight: 10, contentType: 'image/png' }],
      'me',
      1000,
    )[0]!;
    return { doc, id };
  };

  // TC-07 (the core): a gone id answers false and no transaction is written.
  it('does nothing for an id that is gone', () => {
    const { doc, id } = fresh();
    // Take the image away out from under the upload in flight.
    doc.transact(() => doc.getMap('objects').delete(id), LOCAL_ORIGIN);

    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, id, key)).toBe(false);
    expect(markImageFailed(doc, id)).toBe(false);
    expect(markImageRetrying(doc, id, 2000)).toBe(false);
    // The transaction count did not move: nothing was written for a gone object.
    let transactions = 0;
    doc.on('afterTransaction', () => {
      transactions += 1;
    });
    expect(markImageReady(doc, id, key)).toBe(false);
    expect(transactions).toBe(0);
  });

  // A live image is updated by each of the three, and the read reflects it.
  it('updates a live image and reads back', () => {
    const { doc, id } = fresh();
    const key = assetKeyFor(newBoardId(), newBoardId());
    expect(markImageReady(doc, id, key)).toBe(true);
    expect(readImageSnapshot(doc, id)!.status).toBe('ready');
    expect(readImageSnapshot(doc, id)!.assetKey).toBe(key);

    // A Retry takes it back to uploading with a fresh start time.
    expect(markImageRetrying(doc, id, 2000)).toBe(true);
    const retrying = readImageSnapshot(doc, id)!;
    expect(retrying.status).toBe('uploading');
    expect(retrying.uploadStartedAt).toBe(2000);

    expect(markImageFailed(doc, id)).toBe(true);
    expect(readImageSnapshot(doc, id)!.status).toBe('failed');
  });

  // An id that never was an image (or belongs to another kind) is not an image.
  it('refuses an id that is not an image', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('sticky-1', new Y.Map([['type', 'sticky'], ['x', 0], ['y', 0]]));
    expect(markImageReady(doc, 'sticky-1', assetKeyFor(newBoardId(), newBoardId()))).toBe(false);
    expect(markImageReady(doc, 'nope', 'a/b')).toBe(false);
    expect(markImageFailed(doc, 'nope')).toBe(false);
    expect(markImageRetrying(doc, 'nope', 1)).toBe(false);
  });

  // The status change is written outside the undo history: a remote peer that undoes
  // its own edit is not disturbed by our upload finishing.
  it('does not enter the undo history', () => {
    const { doc, id } = fresh();
    const undo = createUndo(doc);
    const before = countUndoSteps(undo);
    markImageFailed(doc, id);
    expect(countUndoSteps(undo)).toBe(before);
  });
});
