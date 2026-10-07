/**
 * Story 12 — `image.model`, `image.placement_size`, `image.shared` and
 * `image.drop`: placement sizes, row layout, placeholders as one undo step,
 * upload state, and the state a clock produces.
 *
 * Run first: `npm run test:unit -- image-model`
 */

import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { initDoc, LOCAL_ORIGIN, moveObjects, snapshot } from "../../src/shared/board-model";
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD } from "../../src/shared/config";
import {
  createImagePlaceholders,
  displayStatus,
  IMAGE_TYPE,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  UPLOAD_ORIGIN,
  type ImageSnap,
} from "../../src/shared/objects/image";
import { assetKeyFor } from "../../src/shared/image-format";

const BOARD_ID = "Zm9vYmFyYmF6aW5nZHVwZA";
const ASSET_ID = "T25lUmFuZG9tMjJjaGFycw";

function imageAt(doc: Y.Doc, id: string): ImageSnap | undefined {
  return snapshot(doc).find((object) => object.id === id) as ImageSnap | undefined;
}

describe("placementSize (TC-03, TC-04)", () => {
  it("keeps an image that already fits at its natural size", () => {
    expect(placementSize(400, 300)).toEqual({ width: 400, height: 300 });
    expect(placementSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it("scales a landscape image down to the placement limit, keeping the ratio", () => {
    expect(placementSize(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(placementSize(1440, 900)).toEqual({ width: 800, height: 500 });
  });

  it("scales a tall image by its longest side", () => {
    expect(placementSize(300, 3200)).toEqual({ width: 75, height: 800 });
  });

  it("puts the limit on the longer side for a square, and never scales up", () => {
    expect(placementSize(800, 800)).toEqual({ width: 800, height: 800 });
    expect(placementSize(799, 800)).toEqual({ width: 799, height: 800 });
    expect(placementSize(10, 5)).toEqual({ width: 10, height: 5 });
  });

  it("never exceeds the placement limit on either side", () => {
    for (const [width, height] of [
      [4032, 3024],
      [3024, 4032],
      [10_000, 3],
      [3, 10_000],
    ]) {
      const size = placementSize(width, height);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
      expect(size.width / size.height).toBeCloseTo(width / height, 5);
    }
  });

  it("reports an unusable natural size as a zero box", () => {
    expect(placementSize(Number.NaN, 300)).toEqual({ width: 0, height: 0 });
    expect(placementSize(400, Number.POSITIVE_INFINITY)).toEqual({ width: 0, height: 0 });
    expect(placementSize(0, 300)).toEqual({ width: 0, height: 0 });
  });
});

describe("layoutRow (TC-08)", () => {
  const sizes = [{ width: 400, height: 300 }, { width: 800, height: 600 }, { width: 200, height: 400 }];

  it("places a dropped row left to right, tops aligned, gap between", () => {
    const rects = layoutRow(sizes, { x: 100, y: 100 }, "top-left");

    expect(rects).toHaveLength(3);
    expect(rects[0]).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    expect(rects[1]).toEqual({
      x: 100 + 400 + IMAGE_LAYOUT_GAP_WORLD,
      y: 100,
      width: 800,
      height: 600,
    });
    expect(rects[2]).toEqual({
      x: 100 + 400 + IMAGE_LAYOUT_GAP_WORLD + 800 + IMAGE_LAYOUT_GAP_WORLD,
      y: 100,
      width: 200,
      height: 400,
    });
    for (const rect of rects) expect(rect.y).toBe(100);
  });

  it("centres a picked row on the point, in both directions", () => {
    const rects = layoutRow(sizes, { x: 1000, y: 1000 }, "centre");

    const totalWidth = 400 + 800 + 200 + 2 * IMAGE_LAYOUT_GAP_WORLD;
    const tallest = 600;
    expect(rects[0].x).toBe(1000 - totalWidth / 2);
    expect(rects[0].y).toBe(1000 - tallest / 2);
    // The row's own centre is the point it was placed at.
    const right = rects[2].x + rects[2].width;
    expect((rects[0].x + right) / 2).toBe(1000);
  });

  it("centres a single image on the point", () => {
    const rects = layoutRow([{ width: 400, height: 300 }], { x: 500, y: 500 }, "centre");
    expect(rects).toEqual([{ x: 300, y: 350, width: 400, height: 300 }]);
  });

  it("lays out a row of 20 images with the gap between each pair", () => {
    const many = Array.from({ length: 20 }, () => ({ width: 100, height: 100 }));
    const rects = layoutRow(many, { x: 0, y: 0 }, "top-left");
    expect(rects).toHaveLength(20);
    expect(rects[19].x).toBe(19 * (100 + IMAGE_LAYOUT_GAP_WORLD));
  });

  it("skips a size it cannot lay out", () => {
    expect(layoutRow([{ width: 0, height: 10 }, { width: 10, height: 10 }], { x: 0, y: 0 }, "top-left")).toHaveLength(
      1,
    );
    expect(layoutRow([], { x: 0, y: 0 }, "top-left")).toEqual([]);
    expect(layoutRow([{ width: 10, height: 10 }], { x: Number.NaN, y: 0 }, "top-left")).toEqual([]);
  });
});

describe("image.model (TC-05, TC-07)", () => {
  function docWithObjects() {
    const doc = new Y.Doc();
    initDoc(doc);
    return { doc, objects: doc.getMap<Y.Map<unknown>>("objects") };
  }

  function undoOf(doc: Y.Doc, objects: Y.Map<Y.Map<unknown>>) {
    return new Y.UndoManager(objects, { trackedOrigins: new Set([LOCAL_ORIGIN]) });
  }

  it("creates a placeholder per image in one update, then completes one without a second undo step", () => {
    const { doc, objects } = docWithObjects();
    const updates: unknown[] = [];
    doc.on("update", (update: Uint8Array, origin: unknown) => updates.push(origin));
    // The history is open before the change, exactly as it is on a board: an
    // UndoManager only records what happens after it was created.
    const undo = undoOf(doc, objects);

    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 100, y: 100, width: 400, height: 300 }, naturalWidth: 1440, naturalHeight: 1080, contentType: "image/png" },
        { rect: { x: 524, y: 100, width: 800, height: 600 }, naturalWidth: 1600, naturalHeight: 1200, contentType: "image/jpeg" },
        { rect: { x: 1348, y: 100, width: 200, height: 400 }, naturalWidth: 400, naturalHeight: 800, contentType: "image/png" },
      ],
      "person-a",
      1_700_000_000_000,
    );

    expect(ids).toHaveLength(3);
    // One add action is one transaction, so one update reaches the other screens.
    expect(updates).toEqual([LOCAL_ORIGIN]);

    const images = snapshot(doc).filter((object) => object.type === IMAGE_TYPE);
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.status).toBe("uploading");
      expect(image.assetKey).toBeNull();
      expect(image.uploaderId).toBe("person-a");
      expect(image.uploadStartedAt).toBe(1_700_000_000_000);
    }
    // Stacking: each new image is above the ones already on the board.
    const zValues = images.map((image) => image.z);
    expect(new Set(zValues).size).toBe(3);
    expect(zValues).toEqual([...zValues].sort((a, b) => a - b));

    expect(markImageReady(doc, ids[1], assetKeyFor(BOARD_ID, ASSET_ID))).toBe(true);

    const ready = imageAt(doc, ids[1]);
    expect(ready?.status).toBe("ready");
    expect(ready?.assetKey).toBe(`${BOARD_ID}/${ASSET_ID}`);

    // `image.shared`: the completion is not a second undo step.
    expect(undo.undoStack.length).toBe(1);
    expect(undo.redoStack.length).toBe(0);

    expect(undo.undo()).toBeTruthy();
    expect(snapshot(doc).filter((object) => object.type === IMAGE_TYPE)).toHaveLength(0);
  });

  it("writes the upload state outside the undo history", () => {
    const { doc, objects } = docWithObjects();
    const undo = undoOf(doc, objects);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" }],
      "person-a",
      1,
    );

    markImageReady(doc, id, assetKeyFor(BOARD_ID, ASSET_ID));
    markImageFailed(doc, id);
    markImageRetrying(doc, id, 2);
    // Only the insertion is on the stack: no upload state is.
    expect(undo.undoStack.length).toBe(1);

    const updates: unknown[] = [];
    doc.on("update", (unused: Uint8Array, origin: unknown) => updates.push(origin));
    markImageReady(doc, id, assetKeyFor(BOARD_ID, ASSET_ID));
    expect(updates).toEqual([UPLOAD_ORIGIN]);
  });

  it("returns false for a deleted, undone or never-existing id and emits no update", () => {
    const { doc } = docWithObjects();
    const undo = new Y.UndoManager(doc.getMap("objects"), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" },
        { rect: { x: 200, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" },
      ],
      "person-a",
      1,
    );

    undo.undo();
    expect(snapshot(doc)).toHaveLength(0);

    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));

    expect(markImageReady(doc, ids[0], assetKeyFor(BOARD_ID, ASSET_ID))).toBe(false);
    expect(markImageFailed(doc, ids[1])).toBe(false);
    expect(markImageRetrying(doc, ids[1], 3)).toBe(false);
    expect(markImageReady(doc, "never-existed", assetKeyFor(BOARD_ID, ASSET_ID))).toBe(false);

    // Nothing was written, so nothing goes out over the wire.
    expect(updates).toHaveLength(0);
  });

  it("keeps the natural size and the ratio across a resize", () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 1600, naturalHeight: 1200, contentType: "image/jpeg" }],
      "person-a",
      1,
    );

    moveObjects(doc, new Map([[id, { x: 20, y: 30 }]]));
    const moved = snapshot(doc).find((object) => object.id === id) as ImageSnap;
    expect(moved.x).toBe(20);
    expect(moved.y).toBe(30);
    expect(moved.naturalWidth).toBe(1600);
    expect(moved.naturalHeight).toBe(1200);
    // The ratio the model stored is the ratio the renderer resizes by.
    expect(moved.width / moved.height).toBeCloseTo(moved.naturalWidth / moved.naturalHeight, 6);
  });

  it("ignores a placeholder whose box is unusable", () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const ids = createImagePlaceholders(
      doc,
      [
        { rect: { x: 0, y: 0, width: 0, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" },
        { rect: { x: Number.NaN, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" },
        { rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" },
      ],
      "person-a",
      1,
    );
    expect(ids).toHaveLength(1);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe("displayStatus (TC-06)", () => {
  const START = 1_700_000_000_000;

  function uploading(startedAt: number): ImageSnap {
    return {
      id: "image-1",
      type: "image",
      x: 0,
      y: 0,
      z: 1,
      createdAt: startedAt,
      width: 100,
      height: 100,
      assetKey: null,
      contentType: "image/png",
      naturalWidth: 100,
      naturalHeight: 100,
      status: "uploading",
      uploadStartedAt: startedAt,
      uploaderId: "person-a",
    };
  }

  it("is still `uploading` just under five minutes", () => {
    expect(displayStatus(uploading(START), START + 5 * 60 * 1000 - 1)).toBe("uploading");
  });

  it("becomes `unfinished` just past five minutes", () => {
    expect(displayStatus(uploading(START), START + 5 * 60 * 1000 + 1)).toBe("unfinished");
  });

  it("leaves a finished or failed upload as it is, however long ago it started", () => {
    const ready = { ...uploading(START), status: "ready", assetKey: "a/b" } as ImageSnap;
    const failed = { ...uploading(START), status: "failed" } as ImageSnap;
    expect(displayStatus(ready, START + 10 * 60 * 60 * 1000)).toBe("ready");
    expect(displayStatus(failed, START + 10 * 60 * 60 * 1000)).toBe("failed");
  });

  it("gives a retry a fresh clock", () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: "image/png" }],
      "person-a",
      START,
    );
    markImageFailed(doc, id);
    markImageRetrying(doc, id, START + 10 * 60 * 1000);

    const image = snapshot(doc).find((object) => object.id === id) as ImageSnap;
    expect(image.status).toBe("uploading");
    expect(image.uploadStartedAt).toBe(START + 10 * 60 * 1000);
    // Ten minutes after the *first* attempt, but only seconds after the retry.
    expect(displayStatus(image, START + 10 * 60 * 1000 + 1_000)).toBe("uploading");
  });
});
