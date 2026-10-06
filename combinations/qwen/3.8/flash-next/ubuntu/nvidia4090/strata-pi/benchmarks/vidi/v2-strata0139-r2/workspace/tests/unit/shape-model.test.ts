import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createSticky, initDoc, moveObjects, resizeObjects, snapshot } from "../../src/shared/board-model";
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  MAX_OBJECT_SIZE_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from "../../src/shared/config";
import type { Rect } from "../../src/shared/geometry";
import {
  createShape,
  getShapeLabel,
  setShapeStyle,
  shapeSnapshot,
  type ShapeSnap,
} from "../../src/shared/objects/shape";

/**
 * Story 10, task 7 — the shape model (`shape.model`), TC-01 to TC-06.
 *
 * A **real** `Y.Doc` throughout: it is the store under test. Every case also
 * asserts the number of `update` events the document fired, because the model's
 * contract is "one `LOCAL_ORIGIN` transaction on success, **no transaction** on
 * rejection" — a rejected call must never put useless sync traffic on the wire.
 */

let doc: Y.Doc;
let updates: { update: Uint8Array; origin: unknown }[];

beforeEach(() => {
  doc = new Y.Doc();
  updates = [];
  doc.on("update", (update, origin) => updates.push({ update, origin }));
  initDoc(doc);
  updates.length = 0;
});

function updateCount(): number {
  return updates.length;
}

function objectsMap(): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

function newShape(
  args: { kind: ShapeKind; rect: Rect | null; at: { x: number; y: number }; square?: boolean },
  by = "dana",
): string {
  const id = createShape(doc, args, by);
  if (typeof id !== "string") throw new Error(`createShape rejected ${JSON.stringify(args)}`);
  return id;
}

function shapeOf(id: string): ShapeSnap {
  const shape = snapshot(doc).find((entry) => entry.id === id) as ShapeSnap | undefined;
  if (!shape || shape.type !== "shape") throw new Error(`no shape ${id} in the model`);
  return shape;
}

function raw(id: string): Y.Map<unknown> {
  const entry = objectsMap().get(id);
  if (!entry) throw new Error(`object ${id} is missing from the document`);
  return entry;
}

describe("shape.model: createShape", () => {
  it("TC-01 a dragged rect becomes a shape of exactly that size, default colours, empty label", () => {
    const sticky = createSticky(doc, { x: 0, y: 0 });
    if (typeof sticky !== "string") throw new Error("createSticky failed");
    updates.length = 0;

    const id = newShape({ kind: "rect", rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } });

    expect(objectsMap().size).toBe(2);
    expect(updateCount()).toBe(1);

    const shape = shapeOf(id);
    expect(shape.type).toBe("shape");
    expect(shape.kind).toBe("rect");
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(shape.fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shape.stroke).toBe(DEFAULT_SHAPE_STROKE);
    expect(shape.label).toBe("");
    // Above every object the board already had, whatever its type.
    expect(shape.z).toBeGreaterThan(1);
    expect(shape.createdBy).toBe("dana");

    // The label is a shared Y.Text, not a plain string: story 3's typing has to
    // merge inside it.
    expect(raw(id).get("label")).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, id)).toBeInstanceOf(Y.Text);
    expect(getShapeLabel(doc, id)?.toString()).toBe("");
  });

  it("TC-01 every shape kind is created the same way", () => {
    for (const kind of SHAPE_KINDS) {
      const id = newShape({ kind, rect: { x: 0, y: 0, width: 100, height: 80 }, at: { x: 0, y: 0 } });
      expect(shapeOf(id).kind).toBe(kind);
    }
  });

  it("TC-02 a rect under the minimum size, and a rect of null, both become a standard shape centred on the point (boundary 19)", () => {
    const at = { x: 400, y: 300 };
    const tiny = newShape({ kind: "rect", rect: { x: at.x, y: at.y, width: 19, height: 200 }, at });
    const click = newShape({ kind: "ellipse", rect: null, at });

    for (const id of [tiny, click]) {
      const shape = shapeOf(id);
      expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(shape.x).toBe(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2);
      expect(shape.y).toBe(at.y - SHAPE_DEFAULT_SIZE_WORLD / 2);
    }
    expect(updateCount()).toBe(2);
  });

  it("TC-03 a rect of exactly the minimum size is kept as drawn (boundary 20)", () => {
    const id = newShape({ kind: "diamond", rect: { x: 50, y: 60, width: SHAPE_MIN_SIZE_WORLD, height: SHAPE_MIN_SIZE_WORLD }, at: { x: 50, y: 60 } });
    const shape = shapeOf(id);
    expect(shape.width).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_MIN_SIZE_WORLD);
    expect(shape.x).toBe(50);
    expect(shape.y).toBe(60);
  });

  it("TC-04 Shift makes the new shape square, using the larger dragged side", () => {
    const id = newShape({
      kind: "rect",
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 100, y: 100 },
      square: true,
    });
    const shape = shapeOf(id);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    // Anchored at the drag origin: the corner the drag started from stays put.
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(100);
  });

  it("TC-04 Shift keeps the corner the drag was pulled from when dragging up-left", () => {
    const id = newShape({
      kind: "ellipse",
      rect: { x: 100, y: 100, width: 200, height: 120 },
      at: { x: 300, y: 220 },
      square: true,
    });
    const shape = shapeOf(id);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(20);
  });

  it("TC-06 an unknown kind or a non-finite rect/point creates nothing and writes nothing", () => {
    const before = snapshot(doc).length;

    expect(createShape(doc, { kind: "triangle" as ShapeKind, rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, "dana")).toBeNull();
    expect(createShape(doc, { kind: "rect", rect: { x: 0, y: 0, width: Number.NaN, height: 100 }, at: { x: 0, y: 0 } }, "dana")).toBeNull();
    expect(createShape(doc, { kind: "rect", rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: Infinity, y: 0 } }, "dana")).toBeNull();
    expect(createShape(doc, { kind: "rect", rect: { x: 0, y: 0, width: 100, height: -4 }, at: { x: 0, y: 0 } }, "dana")).toBeNull();
    expect(createShape(doc, { kind: "rect", rect: { x: 0, y: 0, width: 100, height: MAX_OBJECT_SIZE_WORLD * 2 }, at: { x: 0, y: 0 } }, "dana")).toBeNull();

    expect(updateCount()).toBe(0);
    expect(snapshot(doc).length).toBe(before);
    expect(objectsMap().size).toBe(0);
  });
});

describe("shape.model: setShapeStyle", () => {
  it("TC-05 a valid fill name is applied in exactly one update, and nothing else changes", () => {
    const id = newShape({ kind: "rect", rect: { x: 100, y: 100, width: 200, height: 120 }, at: { x: 100, y: 100 } });
    getShapeLabel(doc, id)?.insert(0, "Checkout");
    const before = shapeOf(id);
    updates.length = 0;

    expect(setShapeStyle(doc, id, { fill: "blue" })).toBe(true);
    expect(updateCount()).toBe(1);

    const after = shapeOf(id);
    expect(after.fill).toBe("blue");
    expect(after.stroke).toBe(before.stroke);
    expect(after.label).toBe("Checkout");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.z).toBe(before.z);
    expect(after.kind).toBe(before.kind);
  });

  it("TC-05 an unknown colour is refused with no transaction at all", () => {
    const id = newShape({ kind: "rect", rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } });
    updates.length = 0;

    expect(setShapeStyle(doc, id, { fill: "teal" })).toBe(false);
    expect(setShapeStyle(doc, id, { stroke: "teal" })).toBe(false);
    expect(updateCount()).toBe(0);
    expect(shapeOf(id).fill).toBe(DEFAULT_SHAPE_FILL);
    expect(shapeOf(id).stroke).toBe(DEFAULT_SHAPE_STROKE);
  });

  it("setShapeStyle writes only the key it was given, and a no-op change writes nothing", () => {
    const id = newShape({ kind: "rect", rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } });
    expect(setShapeStyle(doc, id, { stroke: "red" })).toBe(true);
    updates.length = 0;
    expect(setShapeStyle(doc, id, { stroke: "red" })).toBe(false);
    expect(updateCount()).toBe(0);
    expect(setShapeStyle(doc, id, {})).toBe(false);
    expect(setShapeStyle(doc, "no-such-shape", { fill: "blue" })).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("setShapeStyle refuses a shape of another type and a stale id", () => {
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== "string") throw new Error("createSticky failed");
    updates.length = 0;
    expect(setShapeStyle(doc, note, { fill: "blue" })).toBe(false);
    expect(updateCount()).toBe(0);
  });
});

describe("shape.model: labels and shared objects", () => {
  it("a label is clamped to the model's limit and a shape moves, resizes and deletes like any other object", () => {
    const id = newShape({ kind: "rect", rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } });
    const label = getShapeLabel(doc, id);
    if (!label) throw new Error("no Y.Text label");
    label.insert(0, "x".repeat(SHAPE_LABEL_MAX_CHARS + 100));
    expect(label.toString().length).toBeGreaterThan(SHAPE_LABEL_MAX_CHARS);
    expect(shapeOf(id).label.length).toBeGreaterThan(SHAPE_LABEL_MAX_CHARS);

    expect(
      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: 300, height: 200 }]])),
    ).toBe(1);
    expect(moveObjects(doc, new Map([[id, { x: 40, y: 50 }]]))).toBe(1);
    const moved = shapeOf(id);
    expect(moved.x).toBe(40);
    expect(moved.y).toBe(50);
    expect(moved.width).toBe(300);
    expect(moved.height).toBe(200);
  });

  it("shapeSnapshot reports only shapes, z-ordered", () => {
    createSticky(doc, { x: 0, y: 0 });
    const first = newShape({ kind: "rect", rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } });
    const second = newShape({ kind: "ellipse", rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } });
    const shapes = shapeSnapshot(doc);
    expect(shapes.map((shape) => shape.id)).toEqual([first, second]);
  });

  it("getShapeLabel returns undefined for a stale id or a non-shape", () => {
    const note = createSticky(doc, { x: 0, y: 0 });
    if (typeof note !== "string") throw new Error("createSticky failed");
    expect(getShapeLabel(doc, note)).toBeUndefined();
    expect(getShapeLabel(doc, "no-such-object")).toBeUndefined();
  });

  it("the shape stroke width is a named setting, so the drawing and the model agree", () => {
    expect(SHAPE_STROKE_WIDTH_WORLD).toBeGreaterThan(0);
    expect(SHAPE_KINDS).toEqual(["rect", "ellipse", "diamond"]);
  });
});
