import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  BOARD_SCHEMA_VERSION,
  LOCAL_ORIGIN,
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
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from "../../src/shared/config";

/**
 * Unit tests for the board document model (board.model contract).
 *
 * A *real* `Y.Doc` is used everywhere: it is the store under test, and Yjs is
 * deterministic in-process, so mocking it would hide the merge/observe
 * behaviour story 3 and story 4 depend on.
 *
 * Every mutation test also asserts how many `update` events the document
 * emitted: exactly 1 for a successful mutation (one transaction) and 0 for a
 * rejection (no transaction opened).
 */

const STICKY_HALF = STICKY_SIZE_WORLD / 2;

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

interface MutationResult<T> {
  result: T;
  /** Number of Y.Doc `update` events the mutation emitted. */
  updates: number;
  /** Origins of those updates (each successful mutation is one transaction). */
  origins: unknown[];
}

function measure<T>(doc: Y.Doc, mutation: () => T): MutationResult<T> {
  let updates = 0;
  const origins: unknown[] = [];
  const handler = (update: Uint8Array, origin: unknown) => {
    void update;
    updates += 1;
    origins.push(origin);
  };
  doc.on("update", handler);
  let result: T;
  try {
    result = mutation();
  } finally {
    doc.off("update", handler);
  }
  return { result, updates, origins };
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

function firstNote(doc: Y.Doc): StickySnapshot {
  const notes = snapshot(doc);
  if (notes.length !== 1) throw new Error(`expected exactly one note, got ${notes.length}`);
  return notes[0]!;
}

/** Writes a note straight into the document, bypassing the mutation API. */
function rawNote(
  doc: Y.Doc,
  id: string,
  fields: { x: number; y: number; color: string; text: string; z: number; type?: string },
): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set("type", fields.type ?? "sticky");
    map.set("x", fields.x);
    map.set("y", fields.y);
    map.set("color", fields.color);
    map.set("text", new Y.Text(fields.text));
    map.set("z", fields.z);
    map.set("createdAt", 1_700_000_000_000);
    objectsOf(doc).set(id, map);
  });
}

// ---- initDoc ---------------------------------------------------------------

describe("initDoc", () => {
  it("sets meta.schemaVersion once and leaves it alone afterwards", () => {
    const doc = new Y.Doc();
    const meta = doc.getMap<Y.Map<unknown>>("meta");
    expect(meta.get("schemaVersion")).toBeUndefined();

    initDoc(doc);
    expect(meta.get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);

    const second = measure(doc, () => initDoc(doc));
    expect(second.updates).toBe(0);
    expect(meta.get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);
  });
});

// ---- create (TC-01, TC-02) ------------------------------------------------

describe("createSticky", () => {
  it("TC-01: creates one yellow note centred on the given point, z 1", () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    const { result, updates, origins } = measure(doc, () => createSticky(doc, { x: 0, y: 0 }));
    const id = result as string;

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objectsOf(doc).size).toBe(1);

    const note = firstNote(doc);
    expect(note.id).toBe(id);
    expect(note.type).toBe("sticky");
    // Stored as top-left, centred on the requested point.
    expect(note.x).toBe(-STICKY_HALF);
    expect(note.y).toBe(-STICKY_HALF);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe("");
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
  });

  it("TC-01b: a non-default colour is honoured and the note is centred on the point", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 400, y: 300 }, "blue") as string;
    const note = firstNote(doc);
    expect(note.id).toBe(id);
    expect(note.x).toBe(400 - STICKY_HALF);
    expect(note.y).toBe(300 - STICKY_HALF);
    expect(note.color).toBe("blue");
  });

  it("TC-02: the new note stacks above existing notes (z = maxZ + 1)", () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 }) as string;
    const second = createSticky(doc, { x: 50, y: 0 }) as string;
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);

    const { result, updates } = measure(doc, () => createSticky(doc, { x: 100, y: 0 }));
    expect(updates).toBe(1);
    const third = result as string;

    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.z)).toEqual([1, 2, 3]);
    expect(notes[2]!.id).toBe(third);
    expect(first).not.toBe(second);
  });

  it("TC-39: refuses non-finite coordinates, writing nothing", () => {
    const doc = newDoc();
    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const { result, updates } = measure(doc, () => createSticky(doc, point));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);
    expect(objectsOf(doc).size).toBe(0);
  });

  it("rejects an unknown colour instead of storing it", () => {
    const doc = newDoc();
    const { result, updates } = measure(doc, () =>
      createSticky(doc, { x: 0, y: 0 }, "teal" as StickyColor),
    );
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
  });
});

// ---- move (TC-03, TC-04, TC-39) -------------------------------------------

describe("moveObject", () => {
  it("TC-03: moves a note and leaves every other field untouched", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = firstNote(doc);

    const { result, updates, origins } = measure(doc, () => moveObject(doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);

    const after = firstNote(doc);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.id).toBe(before.id);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("TC-04: a stale id is rejected with no change and no update event", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = firstNote(doc);

    const { result, updates } = measure(doc, () => moveObject(doc, "no-such-id", 5, 5));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    // The existing note is untouched.
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);

    const after = firstNote(doc);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(objectsOf(doc).size).toBe(1);
  });

  it("TC-39: non-finite coordinates are rejected with no update event", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const before = firstNote(doc);

    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const { result, updates } = measure(doc, () => moveObject(doc, id, x, y));
      expect(result).toBe(false);
      expect(updates).toBe(0);
    }

    const after = firstNote(doc);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

// ---- colour (TC-05, TC-06) ------------------------------------------------

describe("setStickyColor", () => {
  it("TC-05: recolours a note without touching text, position or stacking", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    moveObject(doc, id, 30, 40);
    getStickyText(doc, id)!.insert(0, "Faster onboarding");
    const before = firstNote(doc);

    const { result, updates, origins } = measure(doc, () => setStickyColor(doc, id, "green"));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);

    const after = firstNote(doc);
    expect(after.color).toBe("green");
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it("TC-06: an unknown colour name is rejected and changes nothing", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    const { result, updates } = measure(doc, () => setStickyColor(doc, id, "teal"));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(firstNote(doc).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("is rejected for a stale id", () => {
    const doc = newDoc();
    const { result, updates } = measure(doc, () => setStickyColor(doc, "no-such-id", "pink"));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it("accepts all six product colours by name", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(names).toEqual(["yellow", "orange", "green", "blue", "pink", "violet"]);
    for (const name of names) {
      // Move to a different colour first so every name is tested as a change.
      setStickyColor(doc, id, name === "blue" ? "green" : "blue");
      expect(setStickyColor(doc, id, name)).toBe(true);
      expect(firstNote(doc).color).toBe(name);
    }
  });

  it("re-applying the colour a note already has is a no-op with no update event", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    const { result, updates } = measure(doc, () => setStickyColor(doc, id, DEFAULT_STICKY_COLOR));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(firstNote(doc).color).toBe(DEFAULT_STICKY_COLOR);
  });
});

// ---- delete (TC-07, TC-08) ------------------------------------------------

describe("deleteObject", () => {
  it("TC-07: removes the note from the board", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(objectsOf(doc).size).toBe(1);

    const { result, updates, origins } = measure(doc, () => deleteObject(doc, id));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);
    expect(objectsOf(doc).size).toBe(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(getStickyText(doc, id)).toBeUndefined();
  });

  it("TC-08: a stale id is rejected with no update event", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });

    const { result, updates } = measure(doc, () => deleteObject(doc, "no-such-id"));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(objectsOf(doc).size).toBe(1);
  });
});

// ---- stacking (TC-09, TC-10, TC-11) ---------------------------------------

describe("bringToFront", () => {
  it("TC-09: a note that is not topmost moves to maxZ + 1", () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 }) as string;
    createSticky(doc, { x: 10, y: 0 });
    createSticky(doc, { x: 20, y: 0 });
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2, 3]);

    const { result, updates, origins } = measure(doc, () => bringToFront(doc, bottom));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);

    const notes = snapshot(doc);
    expect(notes.map((n) => n.z)).toEqual([2, 3, 4]);
    expect(notes[2]!.id).toBe(bottom);
  });

  it("TC-10: bringing the topmost note to front is a no-op with no update event", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const top = createSticky(doc, { x: 10, y: 0 }) as string;

    const { result, updates } = measure(doc, () => bringToFront(doc, top));
    expect(result).toBe(false);
    expect(updates).toBe(0);
    expect(snapshot(doc).map((n) => n.z)).toEqual([1, 2]);
  });

  it("is rejected for a stale id", () => {
    const doc = newDoc();
    const { result, updates } = measure(doc, () => bringToFront(doc, "no-such-id"));
    expect(result).toBe(false);
    expect(updates).toBe(0);
  });

  it("raises a note that ties on z with the topmost one", () => {
    const doc = newDoc();
    rawNote(doc, "a", { x: 0, y: 0, color: "yellow", text: "", z: 2 });
    rawNote(doc, "b", { x: 0, y: 0, color: "yellow", text: "", z: 2 });

    const { result, updates } = measure(doc, () => bringToFront(doc, "a"));
    expect(result).toBe(true);
    expect(updates).toBe(1);
    expect(snapshot(doc).map((n) => [n.id, n.z])).toEqual([
      ["b", 2],
      ["a", 3],
    ]);
  });
});

// ---- snapshot ordering (TC-11, TC-12) -------------------------------------

describe("snapshot", () => {
  it("TC-11: equal z values are ordered by id, stably across calls", () => {
    const doc = newDoc();
    rawNote(doc, "c-note", { x: 0, y: 0, color: "yellow", text: "", z: 5 });
    rawNote(doc, "a-note", { x: 0, y: 0, color: "green", text: "", z: 5 });
    rawNote(doc, "b-note", { x: 0, y: 0, color: "blue", text: "", z: 5 });

    const first = snapshot(doc).map((n) => n.id);
    const second = snapshot(doc).map((n) => n.id);
    expect(first).toEqual(["a-note", "b-note", "c-note"]);
    expect(second).toEqual(first);

    // Sorting is by (z, id): a higher z still wins over the id tie-break.
    rawNote(doc, "top", { x: 0, y: 0, color: "pink", text: "", z: 6 });
    rawNote(doc, "bottom", { x: 0, y: 0, color: "pink", text: "", z: 1 });
    expect(snapshot(doc).map((n) => [n.id, n.z])).toEqual([
      ["bottom", 1],
      ["a-note", 5],
      ["b-note", 5],
      ["c-note", 5],
      ["top", 6],
    ]);
  });

  it("TC-12: objects of an unknown type are skipped without throwing", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    rawNote(doc, "shape-1", { x: 0, y: 0, color: "yellow", text: "", z: 4, type: "shape" });
    rawNote(doc, "broken-1", { x: 0, y: 0, color: "yellow", text: "", z: 3, type: "text" });
    doc.transact(() => {
      objectsOf(doc).set("not-a-map", undefined as unknown as Y.Map<unknown>);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("sticky");
  });

  it("returns an immutable, self-contained snapshot (no Yjs objects leak out)", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const notes = snapshot(doc);
    expect(notes[0]!.id).toBe(id);

    const text = getStickyText(doc, id)!;
    text.insert(0, "changed");
    // The old snapshot is a plain value: it does not follow the document.
    expect(notes[0]!.text).toBe("");
    expect(snapshot(doc)[0]!.text).toBe("changed");
  });
});

describe("getStickyText", () => {
  it("returns the Y.Text of a note and undefined for anything else", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    expect(getStickyText(doc, id)).toBeInstanceOf(Y.Text);
    expect(getStickyText(doc, "no-such-id")).toBeUndefined();

    rawNote(doc, "shape-1", { x: 0, y: 0, color: "yellow", text: "hi", z: 1, type: "shape" });
    expect(getStickyText(doc, "shape-1")).toBeUndefined();
  });
});

describe("document shape (the story 3/4 wire and storage contract)", () => {
  it("uses meta.schemaVersion plus an objects map of typed Y.Maps with a Y.Text", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    getStickyText(doc, id)!.insert(0, "Faster onboarding");

    const meta = doc.getMap<Y.Map<unknown>>("meta");
    const objects = objectsOf(doc);
    expect(meta.get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);
    expect(objects.get(id)).toBeInstanceOf(Y.Map);

    const raw = objects.get(id)!;
    expect(raw.get("type")).toBe("sticky");
    expect(typeof raw.get("x")).toBe("number");
    expect(typeof raw.get("y")).toBe("number");
    expect(raw.get("color")).toBe(DEFAULT_STICKY_COLOR);
    expect(raw.get("text")).toBeInstanceOf(Y.Text);
    expect((raw.get("text") as Y.Text).toString()).toBe("Faster onboarding");
    expect(typeof raw.get("z")).toBe("number");
    expect(typeof raw.get("createdAt")).toBe("number");
  });

  it("notifies observers of nested changes so the UI snapshot can be recomputed", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    let deepEvents = 0;
    objectsOf(doc).observeDeep(() => {
      deepEvents += 1;
    });

    moveObject(doc, id, 1, 2);
    getStickyText(doc, id)!.insert(0, "abc");
    deleteObject(doc, id);
    expect(deepEvents).toBe(3);
  });
});

describe("rejections produce no sync traffic (story 3)", () => {
  it("a mirrored document never sees a rejected mutation", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    const mirror = new Y.Doc();
    initDoc(mirror);
    // Start the mirror in the same state, then forward only new updates.
    Y.applyUpdate(mirror, Y.encodeStateAsUpdate(doc));
    doc.on("update", (update) => Y.applyUpdate(mirror, update));

    moveObject(doc, "no-such-id", 7, 7);
    setStickyColor(doc, id, "teal");
    setStickyColor(doc, "no-such-id", "green");
    bringToFront(doc, "no-such-id");
    deleteObject(doc, "no-such-id");
    moveObject(doc, id, Number.NaN, 0);
    createSticky(doc, { x: Number.NaN, y: 0 });

    expect(snapshot(mirror)).toEqual(snapshot(doc));
    expect(snapshot(mirror).map((n) => n.id)).toEqual([id]);
  });
});
