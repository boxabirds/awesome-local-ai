import * as Y from "yjs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_SCHEMA_VERSION,
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  deleteObject,
  getObjectsMap,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";

/**
 * Unit tests for the board document model (board.model contract).
 *
 * These run against a **real** `Y.Doc`: the document is the store under test,
 * it is deterministic in-process, and mocking it would hide exactly the
 * merge/observe behaviour stories 3 and 4 depend on.
 *
 * Every mutation test also counts `update` events: 1 for a successful
 * transaction, 0 for a rejection (stories 3/4 pay for every update they sync).
 */

const HALF = STICKY_SIZE_WORLD / 2;

interface Harness {
  doc: Y.Doc;
  updates: () => number;
  /** Ids in insertion order, taken from the document itself. */
  ids: () => string[];
}

let h: Harness;

beforeEach(() => {
  const doc = new Y.Doc();
  initDoc(doc);

  let count = 0;
  doc.on("update", () => {
    count += 1;
  });

  h = {
    doc,
    updates: () => count,
    ids: () => Array.from(doc.getMap<string>("objects").keys()),
  };
});

function objectsMap(): Y.Map<Y.Map<unknown>> {
  return h.doc.getMap<Y.Map<unknown>>("objects");
}

function first(): StickySnapshot {
  const notes = snapshot(h.doc);
  if (notes.length === 0) throw new Error("expected at least one note");
  return notes[0]!;
}

function raw(id: string): Y.Map<unknown> {
  const entry = objectsMap().get(id);
  if (!entry) throw new Error(`object ${id} is missing from the document`);
  return entry;
}

/** Create `n` notes at distinct points and return their ids. */
function createNotes(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    createSticky(h.doc, { x: HALF + i * 10, y: HALF + i * 10 }),
  );
}

// ---- initDoc ---------------------------------------------------------------

describe("initDoc", () => {
  it("sets meta.schemaVersion (extra)", () => {
    const doc = new Y.Doc();
    expect(doc.getMap("meta").get("schemaVersion")).toBeUndefined();
    initDoc(doc);
    expect(doc.getMap<number>("meta").get("schemaVersion")).toBe(BOARD_SCHEMA_VERSION);
  });

  it("does not overwrite an existing schemaVersion and writes nothing (extra)", () => {
    let count = 0;
    h.doc.on("update", () => {
      count += 1;
    });
    h.doc.getMap<number>("meta").set("schemaVersion", 99);
    const before = count;
    initDoc(h.doc);
    expect(h.doc.getMap<number>("meta").get("schemaVersion")).toBe(99);
    expect(count - before).toBe(0);
  });
});

// ---- createSticky ----------------------------------------------------------

describe("createSticky", () => {
  it("TC-01: creates the first note centred on the point, yellow, empty, z 1", () => {
    const id = createSticky(h.doc, { x: 0, y: 0 });
    const notes = snapshot(h.doc);

    expect(id).toBeTruthy();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id,
      type: "sticky",
      x: -HALF,
      y: -HALF,
      color: DEFAULT_STICKY_COLOR,
      text: "",
      z: 1,
    });
    expect(notes[0]!.createdAt).toBeGreaterThan(0);
    expect(h.updates()).toBe(1);
  });

  it("TC-02: the third note gets z = max z + 1", () => {
    createNotes(2);
    expect(snapshot(h.doc).map((n) => n.z)).toEqual([1, 2]);

    const before = h.updates();
    const id = createSticky(h.doc, { x: 500, y: 500 });
    expect(raw(id).get("z")).toBe(3);
    expect(snapshot(h.doc)).toHaveLength(3);
    expect(h.updates() - before).toBe(1);
  });

  it("uses the requested colour when it is one of the six (extra)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF }, "blue");
    expect(id).toBeTruthy();
    expect(first().color).toBe("blue");
    expect(STICKY_COLORS.blue).toBe("#90CAF9");
  });

  it("falls back to the default colour for an unknown colour name (extra)", () => {
    createSticky(h.doc, { x: HALF, y: HALF }, "teal" as never);
    expect(first().color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("exposes the note text as a Y.Text (extra)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    const text = getStickyText(h.doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe("");
    expect(getStickyText(h.doc, "nope")).toBeUndefined();
  });

  it("TC-39: NaN coordinates are rejected without writing or updating", () => {
    const before = h.updates();
    const id = createSticky(h.doc, { x: Number.NaN, y: 0 });
    expect(id).toBe("");
    expect(snapshot(h.doc)).toHaveLength(0);
    expect(objectsMap().size).toBe(0);
    expect(h.updates() - before).toBe(0);
  });

  it("TC-39: Infinity coordinates are rejected without writing or updating", () => {
    const before = h.updates();
    expect(createSticky(h.doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBe("");
    expect(createSticky(h.doc, { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY })).toBe("");
    expect(snapshot(h.doc)).toHaveLength(0);
    expect(h.updates() - before).toBe(0);
  });
});

// ---- moveObject ------------------------------------------------------------

describe("moveObject", () => {
  it("TC-03: moves a note and touches nothing else", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF }, "green");
    expect(first()).toMatchObject({ x: 0, y: 0, z: 1, color: "green", text: "" });
    const createdAt = first().createdAt;

    const before = h.updates();
    expect(moveObject(h.doc, id, 10, -20)).toBe(true);

    const after = first();
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.z).toBe(1);
    expect(after.color).toBe("green");
    expect(after.text).toBe("");
    expect(after.id).toBe(id);
    expect(after.createdAt).toBe(createdAt);
    expect(h.updates() - before).toBe(1);
  });

  it("TC-04: a stale id changes nothing and emits no update", () => {
    createSticky(h.doc, { x: HALF, y: HALF });
    const before = snapshot(h.doc);
    const beforeUpdates = h.updates();

    expect(moveObject(h.doc, "550e8400-e29b-41d4-a716-446655440000", 5, 5)).toBe(false);
    expect(snapshot(h.doc)).toEqual(before);
    expect(h.updates() - beforeUpdates).toBe(0);
  });

  it("TC-39: non-finite target coordinates are rejected (NaN, +/-Infinity)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    const before = snapshot(h.doc);
    const beforeUpdates = h.updates();

    expect(moveObject(h.doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(h.doc, id, 0, Number.NaN)).toBe(false);
    expect(moveObject(h.doc, id, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(moveObject(h.doc, id, 0, Number.NEGATIVE_INFINITY)).toBe(false);

    expect(snapshot(h.doc)).toEqual(before);
    expect(h.updates() - beforeUpdates).toBe(0);
  });
});

// ---- setStickyColor --------------------------------------------------------

describe("setStickyColor", () => {
  it("TC-05: recolours a note without touching text, position or stacking", () => {
    const id = createSticky(h.doc, { x: 300, y: 400 });
    const entry = raw(id);
    entry.get("text");
    (entry.get("text") as Y.Text).insert(0, "Faster onboarding");
    moveObject(h.doc, id, -50, 120);

    const before = h.updates();
    expect(setStickyColor(h.doc, id, "green")).toBe(true);

    const note = first();
    expect(note.color).toBe("green");
    expect(note.text).toBe("Faster onboarding");
    expect(note.x).toBe(-50);
    expect(note.y).toBe(120);
    expect(note.z).toBe(1);
    expect(note.id).toBe(id);
    expect(h.updates() - before).toBe(1);
  });

  it("TC-06: an unknown colour name is rejected and emits no update", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    const before = h.updates();

    expect(setStickyColor(h.doc, id, "teal")).toBe(false);
    expect(first().color).toBe(DEFAULT_STICKY_COLOR);
    expect(h.updates() - before).toBe(0);
  });

  it("TC-06: a stale id is rejected too (negative)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    const before = h.updates();
    expect(setStickyColor(h.doc, `${id}-stale`, "green")).toBe(false);
    expect(first().color).toBe(DEFAULT_STICKY_COLOR);
    expect(h.updates() - before).toBe(0);
  });

  it("accepts all six preset colours (extra)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    for (const name of Object.keys(STICKY_COLORS)) {
      expect(setStickyColor(h.doc, id, name)).toBe(true);
      expect(first().color).toBe(name);
    }
  });
});

// ---- deleteObject ----------------------------------------------------------

describe("deleteObject", () => {
  it("TC-07: deletes a note", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    const before = h.updates();

    expect(deleteObject(h.doc, id)).toBe(true);
    expect(snapshot(h.doc)).toHaveLength(0);
    expect(objectsMap().has(id)).toBe(false);
    expect(h.updates() - before).toBe(1);
  });

  it("TC-08: a stale id is rejected and emits no update", () => {
    createSticky(h.doc, { x: HALF, y: HALF });
    const before = h.updates();
    expect(deleteObject(h.doc, "550e8400-e29b-41d4-a716-446655440001")).toBe(false);
    expect(snapshot(h.doc)).toHaveLength(1);
    expect(h.updates() - before).toBe(0);
  });

  it("deleting twice is a no-op the second time (extra)", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });
    expect(deleteObject(h.doc, id)).toBe(true);
    const before = h.updates();
    expect(deleteObject(h.doc, id)).toBe(false);
    expect(h.updates() - before).toBe(0);
  });
});

// ---- bringToFront ----------------------------------------------------------

describe("bringToFront", () => {
  it("TC-09: the bottom note of three becomes the top note (z 1 -> 4)", () => {
    const [bottom] = createNotes(3);
    expect(snapshot(h.doc).map((n) => n.z)).toEqual([1, 2, 3]);
    expect(first().id).toBe(bottom);

    const before = h.updates();
    expect(bringToFront(h.doc, bottom!)).toBe(true);
    expect(raw(bottom!).get("z")).toBe(4);

    const ordered = snapshot(h.doc);
    expect(ordered.map((n) => n.z)).toEqual([2, 3, 4]);
    expect(ordered[ordered.length - 1]!.id).toBe(bottom);
    expect(h.updates() - before).toBe(1);
  });

  it("TC-10: bringing the topmost note to front writes nothing and emits no update", () => {
    const notes = createNotes(3);
    const top = notes[notes.length - 1]!;
    const before = snapshot(h.doc);
    const beforeUpdates = h.updates();

    expect(bringToFront(h.doc, top)).toBe(false);
    expect(snapshot(h.doc)).toEqual(before);
    expect(h.updates() - beforeUpdates).toBe(0);
  });

  it("TC-10: a stale id is rejected (negative)", () => {
    createNotes(1);
    const before = h.updates();
    expect(bringToFront(h.doc, "missing")).toBe(false);
    expect(h.updates() - before).toBe(0);
  });

  it("leaves text, colour and position untouched (extra)", () => {
    const [bottom, top] = createNotes(2);
    const entry = raw(bottom!);
    (entry.get("text") as Y.Text).insert(0, "Keep me");
    moveObject(h.doc, bottom!, 7, 9);
    setStickyColor(h.doc, bottom!, "violet");

    bringToFront(h.doc, top!);
    expect(bringToFront(h.doc, bottom!)).toBe(true);

    const moved = snapshot(h.doc).find((n) => n.id === bottom)!;
    expect(moved).toMatchObject({ x: 7, y: 9, color: "violet", text: "Keep me", z: 3 });
  });
});

// ---- snapshot ordering and forward compatibility ---------------------------

describe("snapshot", () => {
  it("TC-11: equal z values are ordered by id, stably", () => {
    const ids = createNotes(2);
    // Force a tie the way story 3's concurrent clients can produce one.
    for (const id of ids) raw(id).set("z", 5);

    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const once = snapshot(h.doc);
    const twice = snapshot(h.doc);

    expect(once.map((n) => n.z)).toEqual([5, 5]);
    expect(once.map((n) => n.id)).toEqual(sorted);
    expect(twice.map((n) => n.id)).toEqual(sorted);
    expect(once.map((n) => n.id)).toEqual(twice.map((n) => n.id));
  });

  it("TC-11: ordering is (z, id), not insertion order", () => {
    const ids = createNotes(3);
    raw(ids[2]!).set("z", 1);
    raw(ids[0]!).set("z", 1);
    raw(ids[1]!).set("z", 1);
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(snapshot(h.doc).map((n) => n.id)).toEqual(sorted);
  });

  it("TC-12: objects of an unknown type are skipped, without throwing", () => {
    const id = createSticky(h.doc, { x: HALF, y: HALF });

    // Stories 9-12 add new object types; an older client must ignore them.
    const shape = new Y.Map<unknown>();
    shape.set("type", "shape");
    shape.set("x", 1);
    shape.set("y", 2);
    shape.set("z", 99);
    objectsMap().set("shape-1", shape);

    objectsMap().set("not-a-map", 42 as unknown as Y.Map<unknown>);

    const notes = snapshot(h.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.id).toBe(id);
  });

  it("TC-12: a sticky with missing optional fields snapshots without throwing", () => {
    const bare = new Y.Map<unknown>();
    bare.set("type", "sticky");
    bare.set("x", 1);
    bare.set("y", 2);
    objectsMap().set("bare", bare);

    const notes = snapshot(h.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: "bare", type: "sticky", x: 1, y: 2, z: 0, text: "" });
  });

  it("empty document snapshots to an empty array (extra)", () => {
    expect(snapshot(h.doc)).toEqual([]);
  });
});

// ---- transaction origin ----------------------------------------------------

describe("LOCAL_ORIGIN", () => {
  it("tags every successful mutation so story 3/8 can tell local from remote (extra)", () => {
    const origins: unknown[] = [];
    h.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });

    const [bottom, other] = createNotes(2);
    moveObject(h.doc, bottom!, 1, 2);
    setStickyColor(h.doc, bottom!, "orange");
    expect(bringToFront(h.doc, bottom!)).toBe(true);
    expect(deleteObject(h.doc, other!)).toBe(true);

    expect(origins).toHaveLength(6);
    for (const origin of origins) expect(origin).toBe(LOCAL_ORIGIN);

    // A mutation from anywhere else (story 3's provider, story 4's restore)
    // has a different origin, so it is never mistaken for a local change.
    origins.length = 0;
    h.doc.transact(() => {
      getObjectsMap(h.doc).set("remote", new Y.Map<unknown>());
    });
    expect(origins).toHaveLength(1);
    expect(origins[0]).not.toBe(LOCAL_ORIGIN);
  });
});
