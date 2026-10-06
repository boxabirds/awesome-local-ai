import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  allObjectIds,
  bringObjectsToFront,
  createSticky,
  deleteObjects,
  initDoc,
  moveObjects,
  objectBounds,
  objectsInRect,
  resizeObjects,
  snapshot,
  type ObjectSnapshot,
} from "../../src/shared/board-model";
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, MAX_OBJECT_SIZE_WORLD } from "../../src/shared/config";
import type { Rect } from "../../src/shared/geometry";

/**
 * Story 7, task 6 (TC-05 to TC-10) — the generic group operations every later
 * object type uses: move, resize, delete, stacking, marquee containment and
 * select-all, all writing through the real Y.Doc, one transaction per call.
 */

let doc: Y.Doc;
let updates: number;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  updates = 0;
  doc.on("update", () => {
    updates += 1;
  });
});

function note(at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  if (typeof id !== "string") throw new Error("createSticky rejected the point");
  return id;
}

function objectsMap(): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

function raw(id: string): Y.Map<unknown> {
  const entry = objectsMap().get(id);
  if (!entry) throw new Error(`object ${id} is missing from the document`);
  return entry;
}

function byId(id: string): ObjectSnapshot {
  const found = snapshot(doc).find((entry) => entry.id === id);
  if (!found) throw new Error(`object ${id} is missing from the snapshot`);
  return found;
}

function positions(entries: ReadonlyArray<[string, number, number]>): Map<string, { x: number; y: number }> {
  return new Map(entries.map(([id, x, y]) => [id, { x, y }]));
}

function rects(entries: ReadonlyArray<[string, Rect]>): Map<string, Rect> {
  return new Map(entries);
}

describe("sel.geometry_ops: objectBounds", () => {
  it("TC-10 a note created before story 7 has no persisted size and reads at STICKY_SIZE_WORLD", () => {
    const id = note({ x: 0, y: 0 });
    expect(raw(id).get("width")).toBeUndefined();
    expect(raw(id).get("height")).toBeUndefined();
    expect(objectBounds(byId(id))).toEqual({
      x: -STICKY_SIZE_WORLD / 2,
      y: -STICKY_SIZE_WORLD / 2,
      width: STICKY_SIZE_WORLD,
      height: STICKY_SIZE_WORLD,
    });
  });

  it("a note with a persisted size reports it", () => {
    const id = note({ x: 100, y: 100 });
    resizeObjects(doc, rects([[id, { x: 10, y: 20, width: 320, height: 320 }]]));
    expect(objectBounds(byId(id))).toEqual({ x: 10, y: 20, width: 320, height: 320 });
  });
});

describe("sel.geometry_ops: moveObjects", () => {
  it("TC-05 an id deleted by somebody else is skipped, in one transaction", () => {
    const a = note({ x: 0, y: 0 });
    const b = note({ x: 300, y: 0 });
    const c = note({ x: 600, y: 0 });
    deleteObjects(doc, [c]);
    const updatesAfterDelete = updates;

    const changed = moveObjects(
      doc,
      positions([
        [a, 10, 20],
        [b, 310, 20],
        [c, 610, 20],
      ]),
    );

    expect(changed).toBe(2);
    // One transaction for the whole group, whatever its size.
    expect(updates).toBe(updatesAfterDelete + 1);
    expect([byId(a).x, byId(a).y]).toEqual([10, 20]);
    expect([byId(b).x, byId(b).y]).toEqual([310, 20]);
  });

  it("absolute positions are written as given (a gesture rewrites the same target every frame)", () => {
    const a = note({ x: 0, y: 0 });
    const target = positions([[a, 400, -50]]);

    expect(moveObjects(doc, target)).toBe(1);
    expect(moveObjects(doc, target)).toBe(0);
    expect(moveObjects(doc, target)).toBe(0);
    expect([byId(a).x, byId(a).y]).toEqual([400, -50]);
  });

  it("TC-09 a non-finite coordinate applies nothing and opens no transaction", () => {
    const a = note({ x: 0, y: 0 });
    const before = updates;

    expect(moveObjects(doc, positions([[a, Number.NaN, 0]]))).toBe(0);
    expect(moveObjects(doc, positions([[a, Number.POSITIVE_INFINITY, 0]]))).toBe(0);
    // A bad coordinate in a group rejects the whole group: half a move is worse than none.
    expect(
      moveObjects(
        doc,
        positions([
          [a, 10, 10],
          [byId(a).id, Number.NaN, 10],
        ]),
      ),
    ).toBe(0);

    expect(updates).toBe(before);
    expect([byId(a).x, byId(a).y]).toEqual([-STICKY_SIZE_WORLD / 2, -STICKY_SIZE_WORLD / 2]);
  });

  it("TC-09 an empty id list applies nothing and opens no transaction", () => {
    const before = updates;
    expect(moveObjects(doc, positions([]))).toBe(0);
    expect(deleteObjects(doc, [])).toBe(0);
    expect(bringObjectsToFront(doc, [])).toBe(0);
    expect(resizeObjects(doc, new Map())).toBe(0);
    expect(updates).toBe(before);
  });

  it("an unknown id is skipped without failing the whole group", () => {
    const a = note({ x: 0, y: 0 });
    expect(moveObjects(doc, positions([["missing-id", 1, 2], [a, 3, 4]]))).toBe(1);
  });
});

describe("sel.geometry_ops: resizeObjects", () => {
  it("TC-10 the first resize persists both width and height", () => {
    const id = note({ x: 0, y: 0 });
    const changed = resizeObjects(doc, rects([[id, { x: -100, y: -100, width: 400, height: 400 }]]));

    expect(changed).toBe(1);
    expect(raw(id).get("width")).toBe(400);
    expect(raw(id).get("height")).toBe(400);
    expect(byId(id).width).toBe(400);
    expect(byId(id).height).toBe(400);
  });

  it("a resize never writes past the model's own size limits", () => {
    const id = note({ x: 0, y: 0 });
    const before = updates;

    expect(resizeObjects(doc, rects([[id, { x: 0, y: 0, width: 25_000, height: 100 }]]))).toBe(0);
    expect(resizeObjects(doc, rects([[id, { x: 0, y: 0, width: 10, height: 10 }]]))).toBe(0);
    expect(resizeObjects(doc, rects([[id, { x: 0, y: 0, width: Number.NaN, height: 100 }]]))).toBe(0);

    expect(updates).toBe(before);
    expect(objectBounds(byId(id)).width).toBe(STICKY_SIZE_WORLD);
  });

  it("the model's own maximum applies to a type it does not render either", () => {
    doc.transact(() => {
      const foreign = new Y.Map<unknown>();
      foreign.set("type", "shape-rect");
      foreign.set("x", 0);
      foreign.set("y", 0);
      foreign.set("z", 1);
      objectsMap().set("unknown-1", foreign);
    });

    // No registered minimum for an unknown type, but the one global maximum does.
    expect(resizeObjects(doc, rects([["unknown-1", { x: 0, y: 0, width: 30_000, height: 10 }]]))).toBe(0);
    expect(
      resizeObjects(doc, rects([["unknown-1", { x: 0, y: 0, width: MAX_OBJECT_SIZE_WORLD, height: 10 }]])),
    ).toBe(1);
  });

  it("TC-04 the group's sizes and gaps land where the geometry says", () => {
    const a = note({ x: 100, y: 100 });
    const b = note({ x: 400, y: 100 });
    // Two 200-unit notes, 100 apart, resized to double.
    resizeObjects(
      doc,
      rects([
        [a, { x: 0, y: 0, width: 400, height: 400 }],
        [b, { x: 600, y: 0, width: 400, height: 400 }],
      ]),
    );

    const aBox = objectBounds(byId(a));
    const bBox = objectBounds(byId(b));
    expect([aBox.width, aBox.height]).toEqual([400, 400]);
    expect([bBox.width, bBox.height]).toEqual([400, 400]);
    expect(bBox.x - (aBox.x + aBox.width)).toBe(200);
  });

  it("a resize to where the object already is changes nothing (no update)", () => {
    const id = note({ x: 0, y: 0 });
    const box = objectBounds(byId(id));
    const before = updates;
    expect(resizeObjects(doc, rects([[id, box]]))).toBe(0);
    expect(updates).toBe(before);
  });
});

describe("sel.geometry_ops: bringObjectsToFront (TC-06)", () => {
  it("the whole selection moves above every unselected object, keeping its own order", () => {
    const unselectedA = note({ x: 0, y: 0 }); // z 1
    const selectedA = note({ x: 60, y: 0 }); // z 2
    const selectedB = note({ x: 120, y: 0 }); // z 3
    const unselectedB = note({ x: 180, y: 0 }); // z 4
    const selectedC = note({ x: 240, y: 0 }); // z 5

    const changed = bringObjectsToFront(doc, [selectedB, selectedA, selectedC]);

    expect(changed).toBe(3);
    const notes = snapshot(doc);
    const zOf = (id: string) => notes.find((entry) => entry.id === id)!.z;
    const maxUnselected = Math.max(zOf(unselectedA), zOf(unselectedB));
    // Selected z values are all above the unselected ones...
    expect(Math.min(zOf(selectedA), zOf(selectedB), zOf(selectedC))).toBeGreaterThan(maxUnselected);
    // ...and their relative order is the order they had before.
    expect(zOf(selectedA)).toBeLessThan(zOf(selectedB));
    expect(zOf(selectedB)).toBeLessThan(zOf(selectedC));
    // The render order the client paints in.
    expect(notes.map((entry) => entry.id)).toEqual([
      unselectedA,
      unselectedB,
      selectedA,
      selectedB,
      selectedC,
    ]);
  });

  it("a selection that is already on top changes nothing (no update)", () => {
    const a = note({ x: 0, y: 0 }); // z 1
    const b = note({ x: 300, y: 0 }); // z 2
    const before = updates;

    expect(bringObjectsToFront(doc, [b])).toBe(0);
    expect(updates).toBe(before);
    expect(byId(b).z).toBe(2);
    expect(byId(a).z).toBe(1);
  });

  it("an object already above the unselected ones is never lowered", () => {
    const low = note({ x: 0, y: 0 }); // z 1
    const high = note({ x: 300, y: 0 }); // z 2
    const middle = note({ x: 600, y: 0 }); // z 3
    bringObjectsToFront(doc, [high]); // high -> z 4
    const before = updates;

    // Selecting `low` (z 1) together with the topmost `high` (z 4) puts them at
    // 4 and 5: `high` keeps its place on top of the selection, `low` lands below
    // it and above `middle` (z 3). Nothing is ever lowered — which is why `high`
    // moves up rather than down, board z values being whole numbers.
    expect(bringObjectsToFront(doc, [low, high])).toBe(2);
    expect(updates).toBe(before + 1);
    expect(byId(middle).z).toBe(3);
    expect(byId(low).z).toBe(4);
    expect(byId(high).z).toBe(5);
  });

  it("deleted ids are skipped", () => {
    const a = note({ x: 0, y: 0 });
    const b = note({ x: 300, y: 0 });
    deleteObjects(doc, [b]);
    expect(bringObjectsToFront(doc, [a, b])).toBe(0);
  });
});

describe("sel.geometry_ops: deleteObjects", () => {
  it("removes every listed object in one transaction and reports the count", () => {
    const a = note({ x: 0, y: 0 });
    const b = note({ x: 300, y: 0 });
    const c = note({ x: 600, y: 0 });
    const updatesAfterCreate = updates;

    expect(deleteObjects(doc, [a, b, "missing"])).toBe(2);
    expect(updates).toBe(updatesAfterCreate + 1);
    expect(snapshot(doc).map((entry) => entry.id)).toEqual([c]);
  });
});

describe("sel.geometry_ops: objectsInRect (TC-07)", () => {
  it("selects only the objects lying entirely inside the rectangle", () => {
    const a = note({ x: 100, y: 100 }); // 0..200   fully inside
    const b = note({ x: 180, y: 100 }); // 80..280  partly inside
    const c = note({ x: 500, y: 500 }); // outside

    const inside = objectsInRect(snapshot(doc), { x: 0, y: 0, width: 250, height: 250 });

    expect(inside).toEqual([a]);
    expect(inside).not.toContain(b);
    expect(inside).not.toContain(c);
  });

  it("an object whose edge exactly matches the rectangle counts as fully inside", () => {
    const a = note({ x: 100, y: 100 }); // -0..200 with this centring
    const inside = objectsInRect(snapshot(doc), { x: -100, y: -100, width: 300, height: 300 });
    expect(inside).toEqual([a]);
  });

  it("an empty rectangle selects nothing", () => {
    note({ x: 0, y: 0 });
    expect(objectsInRect(snapshot(doc), { x: 0, y: 0, width: 0, height: 0 })).toEqual([]);
    expect(objectsInRect([], { x: 0, y: 0, width: 500, height: 500 })).toEqual([]);
  });
});

describe("sel.geometry_ops: allObjectIds (TC-08)", () => {
  it("TC-08 select-all skips a type this client has not registered", () => {
    const a = note({ x: 0, y: 0 });
    const b = note({ x: 300, y: 0 });
    // Content a newer client would have written and this one cannot render.
    doc.transact(() => {
      const unknown = new Y.Map<unknown>();
      unknown.set("type", "shape-rect");
      unknown.set("x", 600);
      unknown.set("y", 0);
      unknown.set("z", 9);
      objectsMap().set("unknown-1", unknown);
    });

    // The model can read it (forward compatibility), the *board* cannot select it.
    const all = snapshot(doc);
    expect(all.map((object) => object.id).sort()).toEqual([a, b, "unknown-1"].sort());
    expect(allObjectIds(all, ["sticky"]).sort()).toEqual([a, b].sort());
    expect(objectsInRect(all, { x: -1_000, y: -1_000, width: 3_000, height: 3_000 }, ["sticky"])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(
      objectsInRect(all, { x: -1_000, y: -1_000, width: 3_000, height: 3_000 }, ["sticky"]),
    ).not.toContain("unknown-1");
  });

  it("an entry the model cannot read as an object is skipped entirely", () => {
    const a = note({ x: 0, y: 0 });
    doc.transact(() => {
      const broken = new Y.Map<unknown>();
      broken.set("x", 400);
      broken.set("y", 0);
      objectsMap().set("broken-1", broken);
    });

    expect(snapshot(doc).map((object) => object.id)).toEqual([a]);
    expect(allObjectIds(snapshot(doc))).toEqual([a]);
  });

  it("an empty board selects nothing", () => {
    expect(allObjectIds(snapshot(doc))).toEqual([]);
  });
});

describe("sel.geometry_ops: size limits come from the model too", () => {
  it("the model refuses a sticky below its minimum size", () => {
    const id = note({ x: 0, y: 0 });
    resizeObjects(doc, rects([[id, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD - 1, height: 100 }]]));
    expect(objectBounds(byId(id)).width).toBe(STICKY_SIZE_WORLD);
  });
});
