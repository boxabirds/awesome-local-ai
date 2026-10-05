import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  SCHEMA_VERSION,
} from "../../src/shared/board-model";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "../../src/shared/config";

/**
 * Unit tests for `board.model` (TC-01 to TC-12, TC-39).
 *
 * A **real** `Y.Doc` is used everywhere: it is the store under test, and
 * mocking it would hide the merge/observe behaviour story 3 and story 4 rely
 * on. Every mutation test also asserts the number of `update` events fired —
 * one transaction on success, none on rejection.
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

/** Creates a note and fails the test if the model rejected it. */
function createNote(at: { x: number; y: number }, color?: StickyColor): string {
  const id = createSticky(doc, at, color);
  if (typeof id !== "string") throw new Error(`createSticky rejected ${JSON.stringify(at)}`);
  return id;
}

function raw(id: string): Y.Map<unknown> {
  const object = objectsMap().get(id);
  if (!object) throw new Error(`object ${id} is missing from the document`);
  return object;
}

function first(): ReturnType<typeof snapshot>[number] {
  const notes = snapshot(doc);
  expect(notes).toHaveLength(1);
  return notes[0];
}

// ---- create ---------------------------------------------------------------

describe("createSticky", () => {
  it("TC-01: creates a yellow empty note centred on the point, z 1", () => {
    const id = createNote({ x: 0, y: 0 });
    expect(objectsMap().size).toBe(1);
    expect(updateCount()).toBe(1);

    const note = first();
    expect(note.id).toBe(id);
    expect(note.type).toBe("sticky");
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe("");
    expect(note.z).toBe(1);
    expect(typeof note.createdAt).toBe("number");
    // Centred on the click: the stored top-left is the point minus half a note.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
  });

  it("TC-01: a note created at an arbitrary point is centred there", () => {
    createNote({ x: 400, y: 300 });
    const note = first();
    expect(note.x).toBe(400 - STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(300 - STICKY_SIZE_WORLD / 2);
  });

  it("TC-01: an explicit colour is honoured", () => {
    createNote({ x: 0, y: 0 }, "violet");
    expect(first().color).toBe("violet");
  });

  it("TC-02: a new note stacks above existing ones (z = maxZ + 1)", () => {
    createNote({ x: 0, y: 0 });
    createNote({ x: 300, y: 0 });
    const third = createNote({ x: 0, y: 300 });
    expect(updateCount()).toBe(3);

    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([1, 2, 3]);
    expect(notes[2].id).toBe(third);
  });

  it("TC-02: stacking follows the highest z, not insertion order", () => {
    const a = createNote({ x: 0, y: 0 }); // z 1
    createNote({ x: 300, y: 0 }); // z 2
    bringToFront(doc, a); // z 3
    const fresh = createNote({ x: 0, y: 300 });

    expect(raw(fresh).get("z")).toBe(4);
    const notes = snapshot(doc);
    expect(notes.map((note) => note.z)).toEqual([2, 3, 4]);
    expect(notes[notes.length - 1].id).toBe(fresh);
  });

  it("TC-39: refuses non-finite coordinates without touching the document", () => {
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      expect(createSticky(doc, point)).toBe(false);
    }
    expect(objectsMap().size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updateCount()).toBe(0);
  });

  it("rejects an unknown colour without writing anything", () => {
    expect(createSticky(doc, { x: 0, y: 0 }, "teal" as StickyColor)).toBe(false);
    expect(objectsMap().size).toBe(0);
    expect(updateCount()).toBe(0);
  });
});

// ---- move -----------------------------------------------------------------

describe("moveObject", () => {
  it("TC-03: moves a note and changes nothing else", () => {
    const id = createNote({ x: 0, y: 0 });
    const before = first();
    moveObject(doc, id, 0, 0);
    updates.length = 0;

    expect(moveObject(doc, id, 10, -20)).toBe(true);
    expect(updateCount()).toBe(1);

    const after = first();
    expect([after.x, after.y]).toEqual([10, -20]);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("TC-04: a stale id returns false and emits no update", () => {
    expect(moveObject(doc, "does-not-exist", 1, 1)).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("TC-39: non-finite coordinates are refused", () => {
    const id = createNote({ x: 0, y: 0 });
    const before = first();
    updates.length = 0;

    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 5],
      [5, Number.NEGATIVE_INFINITY],
    ]) {
      expect(moveObject(doc, id, x, y)).toBe(false);
    }

    const after = first();
    expect([after.x, after.y]).toEqual([before.x, before.y]);
    expect(updateCount()).toBe(0);
  });
});

// ---- colour ---------------------------------------------------------------

describe("setStickyColor", () => {
  it("TC-05: changes only the colour", () => {
    const id = createNote({ x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, "Faster onboarding");
    moveObject(doc, id, 10, 20);
    bringToFront(doc, id);
    const before = first();
    updates.length = 0;

    expect(setStickyColor(doc, id, "green")).toBe(true);
    expect(updateCount()).toBe(1);

    const after = first();
    expect(after.color).toBe("green");
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it("TC-05: all six preset colours are accepted", () => {
    const id = createNote({ x: 0, y: 0 }, "orange");
    for (const color of Object.keys(STICKY_COLORS)) {
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(first().color).toBe(color);
    }
  });

  it("TC-06: an unknown colour returns false and emits no update", () => {
    const id = createNote({ x: 0, y: 0 });
    updates.length = 0;

    expect(setStickyColor(doc, id, "teal")).toBe(false);
    expect(first().color).toBe(DEFAULT_STICKY_COLOR);
    expect(raw(id).get("color")).toBe(DEFAULT_STICKY_COLOR);
    expect(updateCount()).toBe(0);
  });

  it("TC-06: a stale id returns false and emits no update", () => {
    expect(setStickyColor(doc, "does-not-exist", "green")).toBe(false);
    expect(updateCount()).toBe(0);
  });
});

// ---- delete ---------------------------------------------------------------

describe("deleteObject", () => {
  it("TC-07: removes the note", () => {
    const id = createNote({ x: 0, y: 0 });
    updates.length = 0;

    expect(deleteObject(doc, id)).toBe(true);
    expect(updateCount()).toBe(1);
    expect(objectsMap().size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it("TC-08: a stale id returns false and emits no update", () => {
    expect(deleteObject(doc, "does-not-exist")).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("deleting one note leaves the others untouched", () => {
    const a = createNote({ x: 0, y: 0 });
    const b = createNote({ x: 300, y: 0 });
    deleteObject(doc, a);
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(b);
  });
});

// ---- stacking -------------------------------------------------------------

describe("bringToFront", () => {
  it("TC-09: a bottom note becomes the top note (z 1 of 3 -> 4)", () => {
    const a = createNote({ x: 0, y: 0 }); // z 1
    createNote({ x: 300, y: 0 }); // z 2
    createNote({ x: 0, y: 300 }); // z 3
    updates.length = 0;

    expect(bringToFront(doc, a)).toBe(true);
    expect(updateCount()).toBe(1);
    expect(raw(a).get("z")).toBe(4);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    expect(notes[2].id).toBe(a);
    expect(notes.map((note) => note.z)).toEqual([2, 3, 4]);
  });

  it("TC-10: bringing the topmost note to front is a no-op with no update", () => {
    createNote({ x: 0, y: 0 });
    const top = createNote({ x: 300, y: 0 }); // z 2
    updates.length = 0;

    expect(bringToFront(doc, top)).toBe(false);
    expect(updateCount()).toBe(0);
    expect(raw(top).get("z")).toBe(2);
  });

  it("TC-10: a stale id returns false and emits no update", () => {
    expect(bringToFront(doc, "does-not-exist")).toBe(false);
    expect(updateCount()).toBe(0);
  });

  it("TC-11: equal z values are ordered by id, stably", () => {
    const ids = [createNote({ x: 0, y: 0 }), createNote({ x: 300, y: 0 })].sort();
    const [lowerId, higherId] = ids;
    // Force the tie story 3 can produce when two peers create simultaneously.
    doc.transact(() => {
      raw(higherId).set("z", raw(lowerId).get("z"));
    }, LOCAL_ORIGIN);
    updates.length = 0;

    const expected = [lowerId, higherId];
    expect(snapshot(doc).map((note) => note.id)).toEqual(expected);
    expect(snapshot(doc).map((note) => note.id)).toEqual(expected);
    expect(snapshot(doc).map((note) => note.id)).toEqual(expected);
    expect(updateCount()).toBe(0);
  });
});

// ---- reads ----------------------------------------------------------------

describe("snapshot and reads", () => {
  it("TC-12: unknown object types are skipped without throwing", () => {
    const stickyId = createNote({ x: 0, y: 0 });
    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("type", "shape");
      shape.set("x", 5);
      objectsMap().set("shape-1", shape);
    }, LOCAL_ORIGIN);

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(stickyId);
  });

  it("returns snapshots sorted by (z, id)", () => {
    const a = createNote({ x: 0, y: 0 });
    const b = createNote({ x: 300, y: 0 });
    const notes = snapshot(doc);
    expect(notes.map((note) => note.id)).toEqual([a, b]);
    expect(notes.map((note) => note.z)).toEqual([1, 2]);
  });

  it("getStickyText exposes the Y.Text stored in the note", () => {
    const id = createNote({ x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    text?.insert(0, "Hello");
    expect(first().text).toBe("Hello");
    expect(getStickyText(doc, "does-not-exist")).toBeUndefined();
  });
});

// ---- meta -----------------------------------------------------------------

describe("initDoc", () => {
  it("sets meta.schemaVersion once", () => {
    const fresh = new Y.Doc();
    let count = 0;
    fresh.on("update", () => count++);

    initDoc(fresh);
    const meta = fresh.getMap<unknown>("meta");
    expect(meta.get("schemaVersion")).toBe(SCHEMA_VERSION);
    expect(count).toBe(1);

    initDoc(fresh);
    initDoc(fresh);
    expect(meta.get("schemaVersion")).toBe(SCHEMA_VERSION);
    expect(count).toBe(1);
  });

  it("is idempotent on a document that already has notes", () => {
    const id = createNote({ x: 0, y: 0 });
    initDoc(doc);
    initDoc(doc);
    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
  });
});
