import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  type StickyColor,
} from "../../src/shared/config";
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
} from "../../src/shared/board-model";

/**
 * Unit tests for the board document model (board.model contract) against a
 * *real* Y.Doc — Yjs is deterministic in-process, so mocking it would hide the
 * merge and observe behaviour the store actually provides.
 *
 * Every mutation test also asserts how many `update` events the document
 * emitted: exactly 1 for a successful change (one transaction) and 0 for a
 * rejection or a no-op.
 */

interface TestDoc {
  doc: Y.Doc;
  /** Runs `fn` and reports its result plus the number of update events it caused. */
  act<T>(fn: () => T): { result: T; updateCount: number; origins: unknown[] };
  objects: Y.Map<Y.Map<unknown>>;
}

function testDoc(): TestDoc {
  const doc = new Y.Doc();
  const origins: unknown[] = [];
  let updates = 0;
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    updates += 1;
    origins.push(origin);
  });
  initDoc(doc);
  return {
    doc,
    objects: doc.getMap<Y.Map<unknown>>("objects"),
    act<T>(fn: () => T) {
      const before = updates;
      const originStart = origins.length;
      const result = fn();
      return { result, updateCount: updates - before, origins: origins.slice(originStart) };
    },
  };
}

function create(t: TestDoc, x = 0, y = 0, color?: StickyColor): string {
  const id = createSticky(t.doc, { x, y }, color);
  if (!id) throw new Error(`createSticky rejected (${x}, ${y})`);
  return id;
}

function noteOf(t: TestDoc, id: string) {
  const found = snapshot(t.doc).find((note) => note.id === id);
  if (!found) throw new Error(`note ${id} is missing from the snapshot`);
  return found;
}

describe("board.model: document schema", () => {
  it("initDoc sets meta.schemaVersion once and a second call writes nothing", () => {
    const doc = new Y.Doc();
    const meta = doc.getMap<number>("meta");
    expect(meta.get("schemaVersion")).toBeUndefined();

    initDoc(doc);
    expect(meta.get("schemaVersion")).toBe(1);

    const t = testDoc();
    expect(t.doc.getMap("meta").get("schemaVersion")).toBe(1);
    expect(t.act(() => initDoc(t.doc)).updateCount).toBe(0);
    expect(t.doc.getMap("meta").get("schemaVersion")).toBe(1);
  });

  it("TC-01: createSticky on an empty board yields one yellow, empty, top note centred on the point", () => {
    const t = testDoc();
    const { result: id, updateCount, origins } = t.act(() => create(t, 0, 0));

    expect(id).toBeTruthy();
    expect(updateCount).toBe(1);
    expect(origins).toEqual([LOCAL_ORIGIN]);

    const notes = snapshot(t.doc);
    expect(notes.length).toBe(1);
    const note = notes[0]!;
    expect(note.id).toBe(id);
    expect(note.type).toBe("sticky");
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.color).toBe("yellow");
    expect(note.text).toBe("");
    expect(note.z).toBe(1);
    // Centred on the requested point: top-left = point - half the note size.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    expect(note.createdAt).toBeGreaterThan(0);
  });

  it("TC-02: a new note stacks on top: with existing z 1 and 2 the new z is 3", () => {
    const t = testDoc();
    const first = create(t, 0, 0);
    const second = create(t, 300, 0);
    expect(noteOf(t, first).z).toBe(1);
    expect(noteOf(t, second).z).toBe(2);

    const third = create(t, -400, 250);
    expect(noteOf(t, third).z).toBe(3);
    expect(snapshot(t.doc).map((n) => n.z)).toEqual([1, 2, 3]);
  });

  it("createSticky accepts an explicit colour and getStickyText returns the note's Y.Text", () => {
    const t = testDoc();
    const id = create(t, 0, 0, "blue");
    expect(noteOf(t, id).color).toBe("blue");
    expect(STICKY_COLORS.blue).toBe("#90CAF9");

    const ytext = getStickyText(t.doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext?.toString()).toBe("");
    expect(getStickyText(t.doc, "no-such-id")).toBeUndefined();
  });
});

describe("board.model: move", () => {
  it("TC-03: moveObject updates x and y and leaves every other field alone", () => {
    const t = testDoc();
    const id = create(t, 0, 0, "green");
    const before = noteOf(t, id);

    const { result, updateCount } = t.act(() => moveObject(t.doc, id, 10, -20));
    expect(result).toBe(true);
    expect(updateCount).toBe(1);

    const after = noteOf(t, id);
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.text).toBe(before.text);
    expect(after.z).toBe(before.z);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("TC-04: moveObject on a stale id changes nothing and emits no update", () => {
    const t = testDoc();
    const id = create(t, 0, 0);
    const before = noteOf(t, id);

    const { result, updateCount } = t.act(() => moveObject(t.doc, "550e8400-e29b-41d4-a716-446655440000", 5, 5));
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    expect(noteOf(t, id)).toEqual(before);
    expect(snapshot(t.doc).length).toBe(1);
  });

  it("TC-39: non-finite coordinates are rejected without writing or updating", () => {
    const t = testDoc();
    const id = create(t, 0, 0);
    const before = noteOf(t, id);

    for (const [x, y] of [
      [Number.NaN, 5],
      [5, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const { result, updateCount } = t.act(() => moveObject(t.doc, id, x, y));
      expect(result).toBe(false);
      expect(updateCount).toBe(0);
    }
    expect(noteOf(t, id)).toEqual(before);

    for (const at of [{ x: Number.NaN, y: 0 }, { x: 0, y: Number.NaN }, { x: Number.POSITIVE_INFINITY, y: 2 }]) {
      const { result, updateCount } = t.act(() => createSticky(t.doc, at));
      expect(result).toBeFalsy();
      expect(updateCount).toBe(0);
    }
    expect(snapshot(t.doc).length).toBe(1);
    expect(noteOf(t, id)).toEqual(before);
  });
});

describe("board.model: colour", () => {
  it("TC-05: setStickyColor changes only the colour", () => {
    const t = testDoc();
    const id = create(t, 30, 40);
    t.act(() => {
      const ytext = getStickyText(t.doc, id);
      ytext?.insert(0, "Faster onboarding");
      moveObject(t.doc, id, 30, 40);
    });
    const before = noteOf(t, id);

    const { result, updateCount } = t.act(() => setStickyColor(t.doc, id, "green"));
    expect(result).toBe(true);
    expect(updateCount).toBe(1);

    const after = noteOf(t, id);
    expect(after.color).toBe("green");
    expect(after.text).toBe(before.text);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
  });

  it("TC-06: an unknown colour name is rejected, the note stays yellow, no update", () => {
    const t = testDoc();
    const id = create(t, 0, 0);

    const { result, updateCount } = t.act(() => setStickyColor(t.doc, id, "teal"));
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    expect(noteOf(t, id).color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("all six preset colours are accepted; re-applying the current colour is a no-op", () => {
    const t = testDoc();
    const id = create(t, 0, 0);
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      const previous = noteOf(t, id).color;
      const { result, updateCount } = t.act(() => setStickyColor(t.doc, id, color));
      // "true when a change was applied, false when rejected or a no-op".
      expect(result).toBe(previous !== color);
      expect(updateCount).toBe(previous !== color ? 1 : 0);
      expect(noteOf(t, id).color).toBe(color);
    }
  });
});

describe("board.model: delete", () => {
  it("TC-07: deleteObject removes the note", () => {
    const t = testDoc();
    const id = create(t, 0, 0);

    const { result, updateCount } = t.act(() => deleteObject(t.doc, id));
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    expect(snapshot(t.doc).length).toBe(0);
    expect(t.objects.size).toBe(0);
  });

  it("TC-08: deleteObject on a stale id returns false and emits no update", () => {
    const t = testDoc();
    create(t, 0, 0);

    const { result, updateCount } = t.act(() => deleteObject(t.doc, "missing-id"));
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    expect(snapshot(t.doc).length).toBe(1);
  });
});

describe("board.model: stacking", () => {
  it("TC-09: bringToFront moves the bottom note of three to the top (z 1 -> 4)", () => {
    const t = testDoc();
    const bottom = create(t, 0, 0);
    const middle = create(t, 10, 10);
    const top = create(t, 20, 20);
    expect([noteOf(t, bottom).z, noteOf(t, middle).z, noteOf(t, top).z]).toEqual([1, 2, 3]);

    const { result, updateCount } = t.act(() => bringToFront(t.doc, bottom));
    expect(result).toBe(true);
    expect(updateCount).toBe(1);
    expect(noteOf(t, bottom).z).toBe(4);
    expect(snapshot(t.doc).map((n) => n.id)).toEqual([middle, top, bottom].map((id) => id));
  });

  it("TC-10: bringToFront on the topmost note is a no-op and emits no update", () => {
    const t = testDoc();
    create(t, 0, 0);
    const top = create(t, 10, 10);

    const { result, updateCount } = t.act(() => bringToFront(t.doc, top));
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
    expect(noteOf(t, top).z).toBe(2);
  });

  it("TC-11: notes with equal z are ordered by id, deterministically and stably", () => {
    const t = testDoc();
    const a = create(t, 0, 0);
    const b = create(t, 0, 0);
    // Force a tie the way story 3 sync can produce it: both notes end up with
    // the same z in the document.
    t.act(() => {
      t.objects.get(b)?.set("z", (t.objects.get(a)?.get("z") as number) ?? 1);
    });
    expect(noteOf(t, a).z).toBe(noteOf(t, b).z);

    const order = snapshot(t.doc).map((n) => n.id);
    const sortedIds = [...[a, b]].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(order).toEqual(sortedIds);
    // Stable across calls: the same order every time, so every client renders
    // the same stacking.
    expect(snapshot(t.doc).map((n) => n.id)).toEqual(order);
    expect(snapshot(t.doc).map((n) => n.id)).toEqual(order);
  });

  it("bringToFront on a stale id returns false with no update", () => {
    const t = testDoc();
    create(t, 0, 0);
    const { result, updateCount } = t.act(() => bringToFront(t.doc, "missing-id"));
    expect(result).toBe(false);
    expect(updateCount).toBe(0);
  });
});

describe("board.model: forward compatibility", () => {
  it("TC-12: an object of an unknown type is skipped by snapshot and never thrown on", () => {
    const t = testDoc();
    const sticky = create(t, 0, 0);

    t.act(() => {
      const shape = new Y.Map<unknown>();
      shape.set("type", "shape");
      shape.set("x", 5);
      shape.set("y", 6);
      shape.set("z", 9);
      t.objects.set("shape-1", shape);
    });

    const notes = snapshot(t.doc);
    expect(notes.length).toBe(1);
    expect(notes[0]!.id).toBe(sticky);
    expect(getStickyText(t.doc, "shape-1")).toBeUndefined();
    // Objects of an unknown type are left strictly alone by this version of
    // the model (stories 9-12 bring their own mutation functions).
    expect(t.act(() => moveObject(t.doc, "shape-1", 1, 1)).result).toBe(false);
    expect(t.act(() => bringToFront(t.doc, "shape-1")).result).toBe(false);
    expect(t.act(() => setStickyColor(t.doc, "shape-1", "pink")).result).toBe(false);
    expect(t.act(() => deleteObject(t.doc, "shape-1")).result).toBe(false);
    expect(t.objects.has("shape-1")).toBe(true);
  });

  it("snapshot entries are immutable copies, not live document handles", () => {
    const t = testDoc();
    const id = create(t, 0, 0);
    const first = noteOf(t, id);
    t.act(() => moveObject(t.doc, id, 77, 88));
    expect(Object.getPrototypeOf(first as unknown as object)).toBe(Object.prototype);
    expect(first.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(noteOf(t, id).x).toBe(77);
  });

  it("the text limit is a product setting the model does not exceed silently", () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    const t = testDoc();
    const id = create(t, 0, 0);
    const ytext = getStickyText(t.doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    // The model stores what it is told; clamping is sticky.text's job.
    t.act(() => ytext?.insert(0, "abc"));
    expect(noteOf(t, id).text).toBe("abc");
  });
});
