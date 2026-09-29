// Story 12, task 2: unit tests for the image object model (TC-03..TC-07) on a
// real Y.Doc, including the undo-step assertion (upload completion is NOT its
// own undo step).

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  createImagePlaceholders,
  displayStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  placementSize,
  type ImagePlaceholderItem,
  type ImageSnap,
  type ImageStatus,
} from '../../src/shared/objects/image';
import { LOCAL_ORIGIN, objectSnapshot } from '../../src/shared/board-model';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects');
  return doc;
}

function imagesOf(doc: Y.Doc): ImageSnap[] {
  return objectSnapshot(doc)
    .filter((o): o is ImageSnap => o.type === 'image');
}

function item(x: number, y: number, w: number, h: number): ImagePlaceholderItem {
  return {
    rect: { x, y, width: w, height: h },
    naturalWidth: w,
    naturalHeight: h,
    contentType: 'image/png',
  };
}

describe('placementSize (TC-03)', () => {
  it('never upscales small images', () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it('scales down so the longest side is at most IMAGE_MAX_PLACE_SIZE_WORLD', () => {
    expect(placementSize(1600, 1200)).toEqual({
      width: 800,
      height: 600,
    });
    // portrait: width scales to hit the cap on height
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
    // exactly at the cap: no change
    expect(placementSize(800, 800)).toEqual({
      width: IMAGE_MAX_PLACE_SIZE_WORLD,
      height: IMAGE_MAX_PLACE_SIZE_WORLD,
    });
  });

  it('returns a zero size for non-finite input (error path)', () => {
    expect(placementSize(NaN, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe('layoutRow (TC-04)', () => {
  const sizes = [
    { width: 100, height: 80 },
    { width: 60, height: 80 },
    { width: 40, height: 80 },
  ];

  it('top-left: tops aligned at the point, gaps of IMAGE_LAYOUT_GAP_WORLD', () => {
    const row = layoutRow(sizes, { x: 200, y: 150 }, 'top-left');
    expect(row).toHaveLength(3);
    expect(row[0]!).toEqual({ x: 200, y: 150, width: 100, height: 80 });
    expect(row[1]!.x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(row[2]!.x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD + 60 + IMAGE_LAYOUT_GAP_WORLD);
    // tops all aligned at the drop point
    for (const r of row) expect(r.y).toBe(150);
  });

  it('centre: the row bounding box is centred on the point', () => {
    const row = layoutRow(sizes, { x: 500, y: 400 }, 'centre');
    const left = Math.min(...row.map((r) => r.x));
    const right = Math.max(...row.map((r) => r.x + r.width));
    const top = Math.min(...row.map((r) => r.y));
    const bottom = Math.max(...row.map((r) => r.y + r.height));
    expect((left + right) / 2).toBe(500);
    expect((top + bottom) / 2).toBe(400);
  });
});

describe('createImagePlaceholders + status (TC-05, TC-07)', () => {
  it('TC-05: 3 placeholders in ONE local transaction; ready update adds no undo step', () => {
    const doc = freshDoc();
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });

    let updateEvents = 0;
    doc.on('update', () => {
      updateEvents += 1;
    });

    const ids = createImagePlaceholders(
      doc,
      [item(0, 0, 100, 80), item(124, 0, 60, 80), item(208, 0, 40, 80)],
      'me',
      1000,
    );
    expect(ids).toHaveLength(3);
    // All three created in a single local-origin transaction.
    expect(updateEvents).toBe(1);
    const afterCreate = imagesOf(doc);
    expect(afterCreate).toHaveLength(3);
    for (const img of afterCreate) {
      expect(img.status).toBe('uploading');
      expect(img.uploaderId).toBe('me');
    }
    // One undo step for the whole add action.
    expect(undo.undoStack.length).toBe(1);

    // Completing one upload uses an untracked origin: no new undo step.
    expect(markImageReady(doc, ids[0]!, 'board/asset')).toBe(true);
    expect(undo.undoStack.length).toBe(1);
    const ready = imagesOf(doc).find((i) => i.id === ids[0])!;
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe('board/asset');

    // Undo removes ALL three placeholders in one step.
    undo.undo();
    expect(imagesOf(doc)).toHaveLength(0);
  });

  it('TC-07: marking a deleted id is false with no update (error path)', () => {
    const doc = freshDoc();
    const [id] = createImagePlaceholders(doc, [item(0, 0, 100, 80)], 'me', 1000);
    doc.getMap('objects').delete(id!);
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    expect(markImageReady(doc, id!, 'board/asset')).toBe(false);
    expect(markImageFailed(doc, id!)).toBe(false);
    expect(updates).toBe(0);
    // A never-seen id is also rejected.
    expect(markImageReady(doc, 'does-not-exist', 'k')).toBe(false);
  });
});

describe('displayStatus (TC-06)', () => {
  function snap(status: ImageStatus, startedAt: number): ImageSnap {
    return {
      id: 'x',
      type: 'image',
      x: 0,
      y: 0,
      z: 1,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 100,
      naturalHeight: 100,
      status,
      uploadStartedAt: startedAt,
      uploaderId: 'me',
    };
  }
  const T = 1_000_000;

  it('uploading just under the stale threshold is still uploading', () => {
    expect(displayStatus(snap('uploading', T), T + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
  });

  it('uploading just over the stale threshold is unfinished', () => {
    expect(displayStatus(snap('uploading', T), T + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('failed and ready pass through unchanged', () => {
    expect(displayStatus(snap('failed', T), T + IMAGE_UPLOAD_STALE_MS + 10)).toBe('failed');
    expect(displayStatus(snap('ready', T), T + IMAGE_UPLOAD_STALE_MS + 10)).toBe('ready');
  });
});

// Silence unused import in some tooling configs.
export type { Rect };
