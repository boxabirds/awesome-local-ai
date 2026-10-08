// TC-03 to TC-07: the image object model on a real Y.Doc with a real
// Y.UndoManager tracking LOCAL_ORIGIN only.

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { getObjectType } from '../../src/client/objects/registry';
import { LOCAL_ORIGIN, objects } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../src/shared/objects/image';

const UPLOADER = 'uploader-1';
const T0 = 1_700_000_000_000;

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta');
  doc.getMap('objects');
  return doc;
}

/** Count transactions that touch the objects map (one per doc transaction). */
function observeUpdates(doc: Y.Doc): { count: { value: number } } {
  const count = { value: 0 };
  objects(doc).observe(() => {
    count.value += 1;
  });
  return { count };
}

function imgField(doc: Y.Doc, id: string, key: string): unknown {
  return objects(doc).get(id)?.get(key);
}

const threeItems = () =>
  [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 60 },
  ].map((s, i) => ({
    rect: { x: 100 + i * (s.width + IMAGE_LAYOUT_GAP_WORLD), y: 50, width: s.width, height: s.height },
    naturalWidth: s.width * 2,
    naturalHeight: s.height * 2,
    contentType: 'image/png',
  }));

describe('image.model: placementSize (TC-03)', () => {
  it('keeps small images at their natural size (no upscale)', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales a 1600x1200 landscape down to 800x600', () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales a 300x3200 portrait down to 75x800', () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it('keeps an 800x800 image exactly at the boundary', () => {
    expect(placementSize(800, 800)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
  });
});

describe('image.model: layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 80, height: 40 },
    { width: 60, height: 60 },
  ];

  it('top-left: the first image starts at the point, gaps of IMAGE_LAYOUT_GAP_WORLD, tops aligned', () => {
    const start = { x: 120, y: 340 };
    const rects = layoutRow(sizes, start, 'top-left');
    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 120, y: 340, width: 100, height: 50 });
    expect(rects[1]!.x).toBe(120 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(rects[2]!.x).toBe(120 + 100 + IMAGE_LAYOUT_GAP_WORLD + 80 + IMAGE_LAYOUT_GAP_WORLD);
    for (const r of rects) expect(r.y).toBe(340);
  });

  it('centre: the whole row is centred on the point', () => {
    const start = { x: 500, y: 400 };
    const rects = layoutRow(sizes, start, 'centre');
    const totalWidth = 100 + 80 + 60 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const totalHeight = 60; // the tallest image
    expect(rects[0]!.x).toBeCloseTo(500 - totalWidth / 2, 9);
    expect(rects[0]!.y).toBeCloseTo(400 - totalHeight / 2, 9);
    // still a left-to-right row with gaps and aligned tops
    for (const r of rects) expect(r.y).toBeCloseTo(rects[0]!.y, 9);
    expect(rects[1]!.x).toBeCloseTo(rects[0]!.x + 100 + IMAGE_LAYOUT_GAP_WORLD, 9);
    expect(rects[2]!.x).toBeCloseTo(rects[0]!.x + 100 + 80 + 2 * IMAGE_LAYOUT_GAP_WORLD, 9);
  });

  it('a single size is centred exactly on the point', () => {
    const rects = layoutRow([{ width: 120, height: 80 }], { x: 300, y: 200 }, 'centre');
    expect(rects[0]).toEqual({ x: 240, y: 160, width: 120, height: 80 });
  });
});

describe('image.model: placeholders and status (TC-05, TC-06, TC-07)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = newDoc();
  });

  it('TC-05: 3 placeholders in ONE update, one undo step; ready completion is not a step', () => {
    const undo = new Y.UndoManager(objects(doc), { trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]) });
    const { count } = observeUpdates(doc);

    const ids = createImagePlaceholders(doc, threeItems(), UPLOADER, T0);
    expect(ids).toHaveLength(3);
    // One transaction for the whole add action.
    expect(count.value).toBe(1);

    for (const id of ids) {
      expect(imgField(doc, id, 'type')).toBe('image');
      expect(imgField(doc, id, 'status')).toBe('uploading');
      expect(imgField(doc, id, 'uploaderId')).toBe(UPLOADER);
      expect(imgField(doc, id, 'uploadStartedAt')).toBe(T0);
      expect(imgField(doc, id, 'assetKey')).toBeNull();
    }
    // z increases in item order (the later images sit on top).
    const z0 = imgField(doc, ids[0]!, 'z') as number;
    const z1 = imgField(doc, ids[1]!, 'z') as number;
    const z2 = imgField(doc, ids[2]!, 'z') as number;
    expect(z0).toBeLessThan(z1);
    expect(z1).toBeLessThan(z2);

    // The add is exactly ONE undo step.
    expect(undo.undoStack.length).toBe(1);

    // Completing one upload (untracked origin) sets assetKey and adds no step.
    expect(markImageReady(doc, ids[0]!, 'aaa'.repeat(7) + 'a' + '/' + 'bbb'.repeat(7) + 'b')).toBe(true);
    expect(imgField(doc, ids[0]!, 'status')).toBe('ready');
    expect(imgField(doc, ids[0]!, 'assetKey')).toBe('aaa'.repeat(7) + 'a' + '/' + 'bbb'.repeat(7) + 'b');
    expect(undo.undoStack.length).toBe(1);

    // One undo removes ALL THREE placeholders (completion was not its own
    // step).
    expect(undo.undo()).toBeTruthy();
    for (const id of ids) expect(objects(doc).get(id)).toBeUndefined();
  });

  it('TC-05b: redo restores the final ready state (completion was not its own step)', () => {
    const undo = new Y.UndoManager(objects(doc), { trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]) });
    const ids = createImagePlaceholders(doc, threeItems(), UPLOADER, T0);
    const key = 'a'.repeat(22) + '/' + 'b'.repeat(22);
    markImageReady(doc, ids[0]!, key);
    expect(undo.undo()).toBeTruthy();
    for (const id of ids) expect(objects(doc).get(id)).toBeUndefined();
    expect(undo.redo()).toBeTruthy();
    for (const id of ids) expect(objects(doc).get(id)).toBeDefined();
    // Redo restores the FINAL state: the ready-mark lives in the same map, so
    // it comes back ready with its assetKey (completion never made its own
    // undo step).
    expect(imgField(doc, ids[0]!, 'status')).toBe('ready');
    expect(imgField(doc, ids[0]!, 'assetKey')).toBe(key);
    // The other two, never completed, come back uploading.
    expect(imgField(doc, ids[1]!, 'status')).toBe('uploading');
  });

  it('TC-06: displayStatus boundaries around IMAGE_UPLOAD_STALE_MS', () => {
    const ids = createImagePlaceholders(doc, threeItems(), UPLOADER, T0);
    const snap = (id: string): ImageSnap =>
      ({
        id,
        type: 'image',
        x: 0,
        y: 0,
        z: 1,
        width: 100,
        height: 50,
        text: '',
        assetKey: null,
        contentType: 'image/png',
        naturalWidth: 100,
        naturalHeight: 50,
        status: imgField(doc, id, 'status') as ImageSnap['status'],
        uploadStartedAt: T0,
        uploaderId: UPLOADER,
      }) satisfies ImageSnap;

    // One ms before the deadline: still uploading.
    expect(displayStatus(snap(ids[0]!), T0 + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    // One ms after: unfinished.
    expect(displayStatus(snap(ids[0]!), T0 + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    // Exactly at the deadline is not yet "more than".
    expect(displayStatus(snap(ids[0]!), T0 + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');

    expect(markImageFailed(doc, ids[1]!)).toBe(true);
    const failedSnap = snap(ids[1]!);
    expect(failedSnap.status).toBe('failed');
    expect(displayStatus(failedSnap, T0 + IMAGE_UPLOAD_STALE_MS * 10)).toBe('failed');

    markImageReady(doc, ids[2]!, 'c'.repeat(22) + '/' + 'd'.repeat(22));
    const readySnap = snap(ids[2]!);
    expect(readySnap.status).toBe('ready');
    expect(displayStatus(readySnap, T0 + IMAGE_UPLOAD_STALE_MS * 10)).toBe('ready');
  });

  it('TC-07: stale ids return false and write nothing', () => {
    createImagePlaceholders(doc, threeItems(), UPLOADER, T0);
    const stale = 'no-such-image';
    const { count } = observeUpdates(doc);
    expect(markImageReady(doc, stale, 'e'.repeat(22) + '/' + 'f'.repeat(22))).toBe(false);
    expect(markImageFailed(doc, stale)).toBe(false);
    expect(markImageRetrying(doc, stale, T0)).toBe(false);
    expect(count.value).toBe(0);
  });

  it('markImageRetrying restarts the upload clock and clears the assetKey', () => {
    const ids = createImagePlaceholders(doc, threeItems(), UPLOADER, T0);
    markImageFailed(doc, ids[0]!);
    const later = T0 + 60_000;
    expect(markImageRetrying(doc, ids[0]!, later)).toBe(true);
    expect(imgField(doc, ids[0]!, 'status')).toBe('uploading');
    expect(imgField(doc, ids[0]!, 'uploadStartedAt')).toBe(later);
    expect(imgField(doc, ids[0]!, 'assetKey')).toBeNull();
  });

  it('skips items with non-finite sizes and returns only the created ids', () => {
    const items = [
      threeItems()[0]!,
      { rect: { x: Number.NaN, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/png' },
      { rect: { x: 0, y: 0, width: 50, height: 50 }, naturalWidth: Infinity, naturalHeight: 50, contentType: 'image/png' },
    ];
    const ids = createImagePlaceholders(doc, items, UPLOADER, T0);
    expect(ids).toHaveLength(1);
    expect(imgField(doc, ids[0]!, 'type')).toBe('image');
  });

  it('registry: image is a known, aspect-locked, resizable type with the image minimum size', () => {
    const spec = getObjectType('image');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
    expect(spec!.Component).toBeDefined();
  });
});
