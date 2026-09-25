/** Story 12 image.model unit tests (TC-03 to TC-07) on a real Y.Doc and a real Y.UndoManager. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deleteObjects, LOCAL_ORIGIN, snapshotObjects } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  displayStatus,
  isImageSnap,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
  type PlaceholderItem,
} from '../../src/shared/objects/image';
import { createUndo } from '../../src/client/board/undo';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

const NOW = 1_750_000_000_000;
const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function images(doc: Y.Doc): ImageSnap[] {
  return snapshotObjects(doc).filter(isImageSnap);
}

function countUpdates(doc: Y.Doc): { readonly count: number; origins: unknown[] } {
  const state = { count: 0, origins: [] as unknown[] };
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    state.count += 1;
    state.origins.push(origin);
  });
  return state;
}

function items(n: number): PlaceholderItem[] {
  return Array.from({ length: n }, (_, i) => ({
    rect: { x: i * 424, y: 0, width: 400, height: 300 },
    naturalWidth: 400,
    naturalHeight: 300,
    contentType: 'image/png',
  }));
}

describe('image.model', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-03 placementSize never upscales and caps the longest side at IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(801, 400)).toEqual({ width: 800, height: (400 * 800) / 801 });
  });

  it('TC-04 layoutRow top-left: tops aligned at the point, IMAGE_LAYOUT_GAP_WORLD apart', () => {
    const sizes = [
      { width: 400, height: 300 },
      { width: 200, height: 500 },
      { width: 100, height: 100 },
    ];
    const rects = layoutRow(sizes, { x: 50, y: 70 }, 'top-left');
    expect(rects).toEqual([
      { x: 50, y: 70, width: 400, height: 300 },
      { x: 50 + 400 + IMAGE_LAYOUT_GAP_WORLD, y: 70, width: 200, height: 500 },
      { x: 50 + 600 + 2 * IMAGE_LAYOUT_GAP_WORLD, y: 70, width: 100, height: 100 },
    ]);
  });

  it('TC-04 layoutRow centre: the row is centred on the point', () => {
    const sizes = [
      { width: 400, height: 300 },
      { width: 200, height: 500 },
    ];
    const rects = layoutRow(sizes, { x: 0, y: 0 }, 'centre');
    const total = 600 + IMAGE_LAYOUT_GAP_WORLD;
    expect(rects[0]).toEqual({ x: -total / 2, y: -250, width: 400, height: 300 });
    expect(rects[1]!.x + rects[1]!.width).toBeCloseTo(total / 2, 9);
    expect(rects.every((r) => r.y === -250)).toBe(true);
    expect(layoutRow([], { x: 0, y: 0 }, 'centre')).toEqual([]);
  });

  it('TC-05 three placeholders in one update, one undo step; completion is not a step; undo removes all three', () => {
    const undo = createUndo(doc);
    const updates = countUpdates(doc);
    const ids = createImagePlaceholders(doc, items(3), 'g_leo', NOW);
    expect(updates.count).toBe(1);
    expect(updates.origins).toEqual([LOCAL_ORIGIN]);
    expect(ids).toHaveLength(3);
    const placed = images(doc);
    expect(placed.map((i) => i.id).sort()).toEqual([...ids].sort());
    for (const img of placed) {
      expect(img).toMatchObject({ status: 'uploading', uploaderId: 'g_leo', uploadStartedAt: NOW, assetKey: null, contentType: 'image/png' });
    }
    // z increases in item order, above everything else.
    expect(ids.map((id) => placed.find((p) => p.id === id)!.z)).toEqual([1, 2, 3]);

    expect(markImageReady(doc, ids[1]!, KEY)).toBe(true);
    expect(updates.origins.at(-1)).toBe(UPLOAD_ORIGIN);
    expect(images(doc).find((i) => i.id === ids[1])).toMatchObject({ status: 'ready', assetKey: KEY });
    expect(undo.undoSize()).toBe(1);

    expect(undo.undo()).toBe(true);
    expect(images(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);

    // Redo brings the three placeholders back; the one that finished keeps its image
    // (see NOTES.md: Y.UndoManager restores the map with its later, untracked content).
    expect(undo.redo()).toBe(true);
    expect(images(doc)).toHaveLength(3);
    expect(images(doc).find((i) => i.id === ids[1])).toMatchObject({ status: 'ready', assetKey: KEY });
    undo.destroy();
  });

  it('TC-05 items with non-finite sizes are skipped', () => {
    const bad: PlaceholderItem = { rect: { x: 0, y: 0, width: Number.NaN, height: 10 }, naturalWidth: 1, naturalHeight: 1, contentType: 'image/png' };
    const updates = countUpdates(doc);
    expect(createImagePlaceholders(doc, [bad], 'g', NOW)).toEqual(['']);
    expect(updates.count).toBe(0);
    const ids = createImagePlaceholders(doc, [bad, ...items(1)], 'g', NOW);
    expect(ids[0]).toBe('');
    expect(ids[1]).not.toBe('');
    expect(images(doc)).toHaveLength(1);
  });

  it('TC-06 displayStatus: uploading until IMAGE_UPLOAD_STALE_MS, then unfinished; failed and ready unchanged', () => {
    const [id] = createImagePlaceholders(doc, items(1), 'g', NOW);
    const img = images(doc)[0]!;
    expect(displayStatus(img, NOW + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(img, NOW + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(img, NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
    markImageFailed(doc, id!);
    expect(displayStatus(images(doc)[0]!, NOW + IMAGE_UPLOAD_STALE_MS + 1)).toBe('failed');
    markImageRetrying(doc, id!, NOW + 10);
    expect(images(doc)[0]).toMatchObject({ status: 'uploading', uploadStartedAt: NOW + 10 });
    markImageReady(doc, id!, KEY);
    expect(displayStatus(images(doc)[0]!, NOW + 10 * IMAGE_UPLOAD_STALE_MS)).toBe('ready');
  });

  it('TC-07 markImageReady / markImageFailed / markImageRetrying on a deleted id: false, no update', () => {
    const [id] = createImagePlaceholders(doc, items(1), 'g', NOW);
    deleteObjects(doc, [id!]);
    const updates = countUpdates(doc);
    expect(markImageReady(doc, id!, KEY)).toBe(false);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(markImageRetrying(doc, id!, NOW)).toBe(false);
    expect(markImageReady(doc, 'never-existed', KEY)).toBe(false);
    expect(updates.count).toBe(0);
  });
});
