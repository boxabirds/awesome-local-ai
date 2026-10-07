import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";

/**
 * Unit tests for the board.model contract (TC-01 to TC-12, TC-39) against a
 * real `Y.Doc`: no mocks, because Yjs merge/observe behaviour is the store
 * under test. Every mutation test also asserts how many `update` events left
 * the document, which is what story 3 pays for on the wire.
 */

const HALF = STICKY_SIZE_WORLD / 2;

const docs: Y.Doc[] = [];

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  docs.push(doc);
  initDoc(doc);
  return doc;
}

/** Counts `update` events from now on. */
function updateCounter(doc: Y.Doc): () => number {
  let count = 0;
  const listener = () => {
    count += 1;
  };
  doc.on("update", listener);
  return () => count;
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects") as Y.Map<Y.Map<unknown>>;
}

function byId(notes: readonly StickySnapshot[], id: string): StickySnapshot {
  const found = notes.find((note) => note.id === id);
  if (!found) throw new Error(`note ${id} is missing from the snapshot`);
  return found;
}

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

describe("initDoc", () => {
  it("sets meta.schemaVersion once and never rewrites it", () => {
    const doc = new Y.Doc();
    docs.push(doc);

    const updates = updateCounter(doc);
    initDoc(doc);
    expect(updates()).toBe(1);
    expect(doc.getMap("meta").get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);

    // A second init (e.g. when a provider attaches, story 3) must be silent.
    initDoc(doc);
    expect(updates()).toBe(1);
    expect(doc.getMap("meta").get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);
  });
});

describe("createSticky", () => {
  it("TC-01: creates one centred yellow sticky with empty text at z 1", () => {
    const doc = newDoc();
    const updates = updateCounter(doc);

    const id = createSticky(doc, { x: 0, y: 0 });

    const notes = snapshot(doc);
    expect(id).toBeTruthy();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note.id).toBe(id);
    expect(note.type).toBe("sticky");
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe("yellow");
    expect(note.text).toBe("");
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    // Centred on the point: top-left is point minus half the note size.
    expect(note.x).toBe(-HALF);
    expect(note.y).toBe(-HALF);
    expect(updates()).toBe(1);
  });

  it("TC-01: centres on an arbitrary point, including negative coordinates", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: -1_000, y: 2_000.5 });
    const note = byId(snapshot(doc), id);
    expect(note.x).toBe(-1_000 - HALF);
    expect(note.y).toBe(2_000.5 - HALF);
  });

  it("TC-02: stacks above existing notes with z = maxZ + 1", () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 50, y: 0 });
    expect(byId(snapshot(doc), first).z).toBe(1);
    expect(byId(snapshot(doc), second).z).toBe(2);

    const updates = updateCounter(doc);
    const third = createSticky(doc, { x: 0, y: 100 });
    expect(byId(snapshot(doc), third).z).toBe(3);
    expect(snapshot(doc)).toHaveLength(3);
    expect(updates()).toBe(1);
  });

  it("TC-39: rejects non-finite coordinates without writing anything", () => {
    const doc = newDoc();
    const updates = updateCounter(doc);

    expect(createSticky(doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.NaN })).toBeFalsy();
    expect(createSticky(doc, { x: Number.POSITIVE_INFINITY, y: 0 })).toBeFalsy();
    expect(createSticky(doc, { x: 0, y: Number.NEGATIVE_INFINITY })).toBeFalsy();
    expect(createSticky(doc, { x: undefined as unknown as number, y: 0 })).toBeFalsy();

    expect(objectsMap(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(updates()).toBe(0);
  });

  it("rejects an unknown colour name without writing anything", () => {
    const doc = newDoc();
    const updates = updateCounter(doc);

    expect(createSticky(doc, { x: 0, y: 0 }, "teal" as never)).toBeFalsy();
    expect(objectsMap(doc).size).toBe(0);
    expect(updates()).toBe(0);

    const violet = createSticky(doc, { x: 0, y: 0 }, "violet");
    expect(byId(snapshot(doc), violet).color).toBe("violet");
    expect(Object.keys(STICKY_COLORS)).toContain("violet");
  });

  it("stores the text as a Y.Text so it can merge with remote edits (story 3)", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = getStickyText(doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    text?.insert(0, "hello");
    expect(byId(snapshot(doc), id).text).toBe("hello");
    expect(getStickyText(doc, "missing-id")).toBeUndefined();
  });
});

describe("moveObject", () => {
  it("TC-03: updates x and y and leaves every other field alone", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)?.insert(0, "keep me");
    setStickyColor(doc, id, "blue");
    const before = byId(snapshot(doc), id);

    const updates = updateCounter(doc);
    expect(moveObject(doc, id, 10, -20)).toBe(true);

    const after = byId(snapshot(doc), id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.text).toBe(before.text);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates()).toBe(1);
  });

  it("TC-04: a stale id returns false and emits no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(moveObject(doc, "5f0a5a4b-0000-4000-8000-000000000000", 5, 5)).toBe(false);
    expect(snapshot(doc)[0].x).toBe(-HALF);
    expect(snapshot(doc)[0].y).toBe(-HALF);
    expect(updates()).toBe(0);
  });

  it("TC-39: NaN and Infinity coordinates are rejected with no update", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 3, y: 4 });
    const updates = updateCounter(doc);

    expect(moveObject(doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(moveObject(doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);

    const note = byId(snapshot(doc), id);
    expect(note.x).toBe(3 - HALF);
    expect(note.y).toBe(4 - HALF);
    expect(updates()).toBe(0);
  });
});

describe("setStickyColor", () => {
  it("TC-05: recolours to green and touches nothing else", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 1, y: 2 });
    getStickyText(doc, id)?.insert(0, "Faster onboarding");
    const before = byId(snapshot(doc), id);

    const updates = updateCounter(doc);
    expect(setStickyColor(doc, id, "green")).toBe(true);

    const after = byId(snapshot(doc), id);
    expect(after.color).toBe("green");
    expect(after.text).toBe("Faster onboarding");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
    expect(updates()).toBe(1);
  });

  it("TC-06: an unknown colour name changes nothing and emits no update", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(setStickyColor(doc, id, "teal")).toBe(false);
    expect(byId(snapshot(doc), id).color).toBe(DEFAULT_STICKY_COLOR);
    expect(byId(snapshot(doc), id).color).toBe("yellow");
    expect(updates()).toBe(0);
  });

  it("returns false for a stale id and emits no update", () => {
    const doc = newDoc();
    const updates = updateCounter(doc);
    expect(setStickyColor(doc, "missing-id", "pink")).toBe(false);
    expect(updates()).toBe(0);
  });

  it("TC-27 model side: every swatch colour is accepted", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    let current: string = DEFAULT_STICKY_COLOR;
    for (const color of Object.keys(STICKY_COLORS)) {
      // Re-applying the colour the note already has is a no-op (no pointless
      // sync traffic once story 3 is live); every other colour is applied.
      expect(setStickyColor(doc, id, color)).toBe(color !== current);
      current = color;
      expect(byId(snapshot(doc), id).color).toBe(color);
    }
  });

  it("re-applying the current colour is a silent no-op", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    expect(byId(snapshot(doc), id).color).toBe(DEFAULT_STICKY_COLOR);
    expect(updates()).toBe(0);
  });
});

describe("deleteObject", () => {
  it("TC-07: removes the note from the document", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const updates = updateCounter(doc);

    expect(deleteObject(doc, id)).toBe(true);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].id).not.toBe(id);
    expect(getStickyText(doc, id)).toBeUndefined();
    expect(updates()).toBe(1);
  });

  it("TC-08: a stale id returns false and emits no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);

    expect(deleteObject(doc, "no-such-id")).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
    expect(updates()).toBe(0);
  });
});

describe("bringToFront", () => {
  it("TC-09: brings the bottom note of three to z 4", () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 10, y: 0 });
    const top = createSticky(doc, { x: 20, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);

    const updates = updateCounter(doc);
    expect(bringToFront(doc, bottom)).toBe(true);

    const ordered = snapshot(doc);
    expect(byId(ordered, bottom).z).toBe(4);
    expect(ordered.map((note) => note.z)).toEqual([2, 3, 4]);
    expect(byId(ordered, top).z).toBe(3);
    expect(updates()).toBe(1);
  });

  it("TC-10: bringing the topmost note to front is a no-op with no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 });
    const updates = updateCounter(doc);

    expect(bringToFront(doc, top)).toBe(false);
    expect(byId(snapshot(doc), top).z).toBe(2);
    expect(updates()).toBe(0);
  });

  it("returns false for a stale id with no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const updates = updateCounter(doc);
    expect(bringToFront(doc, "missing-id")).toBe(false);
    expect(updates()).toBe(0);
  });
});

describe("snapshot", () => {
  it("TC-11: equal z values are ordered by id and stable across calls", () => {
    const doc = newDoc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 100, y: 0 });
    const c = createSticky(doc, { x: 200, y: 0 });

    // Force equal z, exactly what two concurrent clients produce in story 3.
    const objects = objectsMap(doc);
    const zA = objects.get(a)!.get("z") as number;
    doc.transact(() => {
      objects.get(b)!.set("z", zA);
      objects.get(c)!.set("z", zA);
    });

    const ids = [a, b, c].slice().sort((p, q) => (p < q ? -1 : 1));
    const first = snapshot(doc).map((note) => note.id);
    expect(first).toEqual(ids);
    expect(snapshot(doc).map((note) => note.id)).toEqual(ids);
    expect(snapshot(doc).map((note) => note.id)).toEqual(ids);
  });

  it("TC-12: objects of an unknown type are skipped and do not throw", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const objects = objectsMap(doc);
    doc.transact(() => {
      const shape = new Y.Map();
      shape.set("type", "shape");
      shape.set("x", 1);
      shape.set("y", 2);
      objects.set("shape-1", shape);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("sticky");
    expect(notes.some((note) => note.id === "shape-1")).toBe(false);
  });

  it("returns an immutable snapshot sorted by (z, id)", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const notes = snapshot(doc);
    expect(Object.isFrozen(notes)).toBe(true);
    expect(Object.isFrozen(notes[0])).toBe(true);
    expect(() => {
      (notes as { length: number }).length = 0;
    }).toThrow();
    expect(notes[0].id).toBe(id);
  });

  it("returns an empty list for an empty board", () => {
    const doc = newDoc();
    expect(snapshot(doc)).toEqual([]);
  });
});

