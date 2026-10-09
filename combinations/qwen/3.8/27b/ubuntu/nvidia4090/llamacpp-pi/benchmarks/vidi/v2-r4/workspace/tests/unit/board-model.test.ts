/**
 * board.model unit tests (story 2): TC-01 to TC-12 and TC-39.
 *
 * Written against a **real** `Y.Doc` (no mocks — Yjs is the store under test
 * and is deterministic in-process). Every mutation test also counts the
 * `update` events the doc emits: 1 for an applied change, 0 for a rejection
 * or no-op. Expected values reference the named settings in
 * src/shared/config.ts, never literals.
 */
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import {
  type StickySnapshot,
  createSticky,
  deleteObject,
  bringToFront,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from "../../src/shared/board-model";

interface Harness {
  doc: Y.Doc;
  /** Number of `update` events since the last call (or since creation). */
  updates(): number;
}

function freshDoc(): Harness {
  const doc = new Y.Doc();
  let total = 0;
  let seen = 0;
  doc.on("update", () => {
    total++;
  });
  initDoc(doc);
  seen = total; // ignore initDoc's own write
  return {
    doc,
    updates() {
      const n = total - seen;
      seen = total;
      return n;
    },
  };
}

/** All snapshot ids, in render order. */
function ids(doc: Y.Doc): string[] {
  return snapshot(doc).map((n) => n.id);
}

describe("board.model (Y.Doc, real)", () => {
  it("extra: initDoc sets meta.schemaVersion once and a second call is a no-op", () => {
    const doc = new Y.Doc();
    let updates = 0;
    doc.on("update", () => updates++);
    initDoc(doc);
    const afterFirst = updates;
    initDoc(doc);
    expect(doc.getMap("meta").get("schemaVersion")).toBe(1);
    expect(updates).toBe(afterFirst);
  });

  it("TC-01: createSticky on an empty doc adds one yellow, empty note at z 1, centred on the point", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    expect(h.updates()).toBe(1);

    const notes = snapshot(h.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes[0].type).toBe("sticky");
    expect(notes[0].color).toBe(DEFAULT_STICKY_COLOR);
    expect(notes[0].text).toBe("");
    expect(notes[0].z).toBe(1);
    // Top-left is the point minus half the note size (the note is centred).
    expect(notes[0].x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(notes[0].createdAt).toBeTypeOf("number");
  });

  it("TC-02: a new note stacks above existing z values (z 1,2 → new z 3)", () => {
    const h = freshDoc();
    const a = createSticky(h.doc, { x: 0, y: 0 });
    const b = createSticky(h.doc, { x: 10, y: 10 });
    const c = createSticky(h.doc, { x: 20, y: 20 });
    expect(snapshot(h.doc).map((n) => n.z)).toEqual([1, 2, 3]);
    expect(ids(h.doc)).toEqual([a, b, c]);
  });

  it("TC-03: moveObject updates x,y and leaves every other field unchanged", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    const before = snapshot(h.doc)[0];
    expect(before.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(before.y).toBe(-STICKY_SIZE_WORLD / 2);
    h.updates(); // flush setup writes

    expect(moveObject(h.doc, id, 10, -20)).toBe(true);
    expect(h.updates()).toBe(1);

    const after = snapshot(h.doc)[0];
    expect(after).toMatchObject({
      id: before.id,
      type: "sticky",
      x: 10,
      y: -20,
      color: before.color,
      text: before.text,
      z: before.z,
      createdAt: before.createdAt,
    });
  });

  it("TC-04 (negative): moveObject on a stale id returns false and emits no update", () => {
    const h = freshDoc();
    createSticky(h.doc, { x: 0, y: 0 });
    h.updates(); // flush setup writes
    expect(moveObject(h.doc, "no-such-id", 5, 5)).toBe(false);
    expect(h.updates()).toBe(0);
  });

  it("TC-05: setStickyColor applies the colour and leaves text, position and stacking unchanged", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 30, y: 40 });
    const before = snapshot(h.doc)[0];
    h.updates(); // flush setup writes

    expect(setStickyColor(h.doc, id, "green")).toBe(true);
    expect(h.updates()).toBe(1);

    const after = snapshot(h.doc)[0];
    expect(after.color).toBe("green");
    expect(after).toMatchObject({
      id: before.id,
      x: before.x,
      y: before.y,
      text: before.text,
      z: before.z,
      createdAt: before.createdAt,
    });
  });

  it("TC-06 (negative): setStickyColor with an unknown colour returns false, changes nothing, emits no update", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.updates(); // flush setup writes
    expect(setStickyColor(h.doc, id, "teal")).toBe(false);
    expect(h.updates()).toBe(0);
    expect(snapshot(h.doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("TC-07: deleteObject removes the note", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.updates(); // flush setup writes
    expect(deleteObject(h.doc, id)).toBe(true);
    expect(h.updates()).toBe(1);
    expect(snapshot(h.doc)).toHaveLength(0);
  });

  it("TC-08 (negative): deleteObject on a stale id returns false and emits no update", () => {
    const h = freshDoc();
    createSticky(h.doc, { x: 0, y: 0 });
    h.updates(); // flush setup writes
    expect(deleteObject(h.doc, "no-such-id")).toBe(false);
    expect(h.updates()).toBe(0);
    expect(snapshot(h.doc)).toHaveLength(1);
  });

  it("TC-09: bringToFront raises a bottom note above the current top (z 1 of 3 → z 4)", () => {
    const h = freshDoc();
    const a = createSticky(h.doc, { x: 0, y: 0 });
    const b = createSticky(h.doc, { x: 10, y: 0 });
    const c = createSticky(h.doc, { x: 20, y: 0 });
    expect(snapshot(h.doc).find((n) => n.id === a)!.z).toBe(1);
    h.updates(); // flush setup writes

    expect(bringToFront(h.doc, a)).toBe(true);
    expect(h.updates()).toBe(1);
    expect(snapshot(h.doc).find((n) => n.id === a)!.z).toBe(4);
    // Render order follows z: a is now last (topmost).
    expect(ids(h.doc)).toEqual([b, c, a]);
  });

  it("TC-10 (negative): bringToFront on the topmost note returns false and emits no update", () => {
    const h = freshDoc();
    const a = createSticky(h.doc, { x: 0, y: 0 });
    const b = createSticky(h.doc, { x: 10, y: 0 });
    h.updates(); // flush setup writes
    expect(bringToFront(h.doc, b)).toBe(false);
    expect(h.updates()).toBe(0);
    expect(snapshot(h.doc).find((n) => n.id === b)!.z).toBe(2);
  });

  it("TC-11: equal z values tie-break by id and the order is stable across calls", () => {
    const h = freshDoc();
    const a = createSticky(h.doc, { x: 0, y: 0 });
    const b = createSticky(h.doc, { x: 10, y: 0 });
    // Force an equal z (possible once story 3 merges concurrent creations).
    h.doc.transact(() => {
      (h.doc.getMap("objects").get(a) as Y.Map<unknown>).set("z", 5);
      (h.doc.getMap("objects").get(b) as Y.Map<unknown>).set("z", 5);
    });
    const first = ids(h.doc);
    const second = ids(h.doc);
    const sortedIds = [a, b].sort();
    expect(first).toEqual(sortedIds);
    expect(second).toEqual(first);
  });

  it("TC-12: objects with an unknown type are skipped by snapshot without throwing", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.doc.transact(() => {
      const shape = new Y.Map();
      shape.set("type", "shape");
      shape.set("x", 1);
      shape.set("y", 2);
      shape.set("z", 99);
      h.doc.getMap("objects").set("shape-1", shape);
    });
    const notes = snapshot(h.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes.every((n) => n.type === "sticky")).toBe(true);
  });

  it("TC-39 (negative): non-finite coordinates are rejected with no update (moveObject and createSticky)", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    h.updates(); // flush setup writes

    expect(moveObject(h.doc, id, Number.NaN, 0)).toBe(false);
    expect(moveObject(h.doc, id, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(moveObject(h.doc, id, Number.NEGATIVE_INFINITY, Number.NaN)).toBe(false);
    expect(h.updates()).toBe(0);

    expect(createSticky(h.doc, { x: Number.NaN, y: 0 })).toBeFalsy();
    expect(createSticky(h.doc, { x: 0, y: Number.POSITIVE_INFINITY })).toBeFalsy();
    expect(h.updates()).toBe(0);

    expect(snapshot(h.doc)).toHaveLength(1);
  });

  it("getStickyText returns the note's Y.Text and undefined for stale ids", () => {
    const h = freshDoc();
    const id = createSticky(h.doc, { x: 0, y: 0 });
    const text = getStickyText(h.doc, id);
    expect(text).toBeInstanceOf(Y.Text);
    expect(text!.toString()).toBe("");
    expect(getStickyText(h.doc, "no-such-id")).toBeUndefined();
  });
});

/** Keep StickySnapshot import used (type-level documentation of the contract). */
type _AssertStickySnapshot = StickySnapshot;
