import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
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
 * board.model unit tests (TC-01 to TC-12, TC-39).
 *
 * A real `Y.Doc` is used everywhere: it is the store under test, and mocking it
 * would hide the merge/observe behaviour story 3 and story 4 rely on.
 */

const HALF = STICKY_SIZE_WORLD / 2;

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

interface UpdateLog {
  count: number;
  origins: unknown[];
}

/** Runs `fn` and counts the `update` events the doc emitted because of it. */
function recorded(doc: Y.Doc, fn: () => void): UpdateLog {
  const log: UpdateLog = { count: 0, origins: [] };
  const handler = (_update: Uint8Array, origin: unknown) => {
    log.count += 1;
    log.origins.push(origin);
  };
  doc.on("update", handler);
  fn();
  doc.off("update", handler);
  return log;
}

function stickyIds(doc: Y.Doc): string[] {
  return snapshot(doc).map((note) => note.id);
}

function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

describe("board.model: create", () => {
  it("TC-01: createSticky on an empty doc adds one yellow empty note at z 1", () => {
    const doc = newDoc();
    expect(snapshot(doc)).toHaveLength(0);

    const log = recorded(doc, () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      expect(id).toEqual(expect.any(String));
      expect(id).not.toBe(false);
    });

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.type).toBe("sticky");
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe("");
    expect(note.z).toBe(1);
    expect(Number.isFinite(note.createdAt)).toBe(true);
    // Creation is centred on the given point: the stored point is the top-left.
    expect(note.x).toBe(-HALF);
    expect(note.y).toBe(-HALF);
    expect(note.id).toEqual(expect.any(String));

    // Exactly one transaction, written with LOCAL_ORIGIN.
    expect(log.count).toBe(1);
    expect(log.origins).toEqual([LOCAL_ORIGIN]);
  });

  it("TC-02: createSticky stacks on top of existing notes (z 1, 2 -> new z 3)", () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 300, y: 0 });
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2]);

    const log = recorded(doc, () => createSticky(doc, { x: 0, y: 300 }));
    const notes = snapshot(doc);
    expect(notes).toHaveLength(3);
    expect(notes.map((note) => note.z)).toEqual([1, 2, 3]);
    const created = notes.find((note) => note.id !== first && note.id !== second)!;
    expect(created.z).toBe(3);
    expect(log.count).toBe(1);
  });

  it("creates with an explicit colour and centred on an off-origin point", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 500, y: -250 }, "blue");
    const note = snapshot(doc).find((entry) => entry.id === id)!;
    expect(note.color).toBe("blue");
    expect(note.x).toBe(500 - HALF);
    expect(note.y).toBe(-250 - HALF);
  });

  it("TC-39: non-finite coordinates are rejected without a transaction", () => {
    const doc = newDoc();

    for (const point of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const log = recorded(doc, () => {
        expect(createSticky(doc, point)).toBe(false);
      });
      expect(log.count).toBe(0);
    }
    expect(snapshot(doc)).toHaveLength(0);

    const id = createSticky(doc, { x: 0, y: 0 });
    for (const [x, y] of [
      [Number.NaN, 0],
      [0, Number.NaN],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
    ]) {
      const log = recorded(doc, () => {
        expect(moveObject(doc, id as string, x, y)).toBe(false);
      });
      expect(log.count).toBe(0);
    }
    // The note is still where it was.
    const note = snapshot(doc)[0]!;
    expect(note.x).toBe(-HALF);
    expect(note.y).toBe(-HALF);
  });

  it("initDoc records the schema version once", () => {
    const doc = newDoc();
    const meta = doc.getMap<number>("meta");
    expect(meta.get("schemaVersion")).toBe(1);

    const log = recorded(doc, () => initDoc(doc));
    expect(log.count).toBe(0);
    expect(meta.get("schemaVersion")).toBe(1);
  });
});

describe("board.model: move", () => {
  it("TC-03: moveObject updates x and y and leaves every other field alone", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    setStickyColor(doc, id as string, "green");
    const before = snapshot(doc).find((note) => note.id === id)!;
    expect([before.x, before.y]).toEqual([-HALF, -HALF]);

    const log = recorded(doc, () => {
      expect(moveObject(doc, id as string, 10, -20)).toBe(true);
    });

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.x).toBe(10);
    expect(after.y).toBe(-20);
    expect(after.color).toBe(before.color);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
    expect(log.count).toBe(1);
    expect(log.origins).toEqual([LOCAL_ORIGIN]);
  });

  it("TC-04: moveObject on a stale id returns false and emits no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });

    const log = recorded(doc, () => {
      expect(moveObject(doc, "5f0c1b3c-0000-4000-8000-000000000000", 10, 10)).toBe(false);
    });
    expect(log.count).toBe(0);
    expect(snapshot(doc)[0]!.x).toBe(-HALF);
  });

  it("TC-09: bringToFront puts the bottom note above every other note", () => {
    const doc = newDoc();
    const bottom = createSticky(doc, { x: 0, y: 0 }) as string;
    const middle = createSticky(doc, { x: 300, y: 0 }) as string;
    const top = createSticky(doc, { x: 600, y: 0 }) as string;
    expect(snapshot(doc).map((note) => note.z)).toEqual([1, 2, 3]);

    const log = recorded(doc, () => {
      expect(bringToFront(doc, bottom)).toBe(true);
    });

    const byId = new Map(snapshot(doc).map((note) => [note.id, note.z]));
    expect(byId.get(bottom)).toBe(4);
    expect(byId.get(middle)).toBe(2);
    expect(byId.get(top)).toBe(3);
    expect(snapshot(doc).map((note) => note.id)).toEqual([middle, top, bottom]);
    expect(log.count).toBe(1);
  });

  it("TC-10: bringToFront on the topmost note is a no-op with no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 0 });
    const top = createSticky(doc, { x: 600, y: 0 }) as string;

    const log = recorded(doc, () => {
      expect(bringToFront(doc, top)).toBe(false);
    });
    expect(log.count).toBe(0);
    expect(snapshot(doc).find((note) => note.id === top)!.z).toBe(3);
  });

  it("bringToFront on a stale id returns false with no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const log = recorded(doc, () => {
      expect(bringToFront(doc, "not-an-id")).toBe(false);
    });
    expect(log.count).toBe(0);
  });
});

describe("board.model: colour", () => {
  it("TC-05: setStickyColor changes only the colour", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 100, y: 200 }) as string;
    moveObject(doc, id, 40, 60);
    const before = snapshot(doc).find((note) => note.id === id)!;

    const log = recorded(doc, () => {
      expect(setStickyColor(doc, id, "green")).toBe(true);
    });

    const after = snapshot(doc).find((note) => note.id === id)!;
    expect(after.color).toBe("green");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(after.createdAt).toBe(before.createdAt);
    expect(log.count).toBe(1);
  });

  it("TC-06: an unknown colour name is rejected and writes nothing", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;

    const log = recorded(doc, () => {
      expect(setStickyColor(doc, id, "teal")).toBe(false);
    });
    expect(log.count).toBe(0);
    expect(snapshot(doc).find((note) => note.id === id)!.color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("setStickyColor on a stale id returns false with no update", () => {
    const doc = newDoc();
    const log = recorded(doc, () => {
      expect(setStickyColor(doc, "missing-id", "pink")).toBe(false);
    });
    expect(log.count).toBe(0);
  });

  it("accepts every preset colour name", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    let current: StickyColor = DEFAULT_STICKY_COLOR;
    for (const color of Object.keys(STICKY_COLORS) as StickyColor[]) {
      if (color === current) continue;
      expect(setStickyColor(doc, id, color)).toBe(true);
      expect(snapshot(doc).find((note) => note.id === id)!.color).toBe(color);
      current = color;
    }
  });

  it("re-applying the current colour is a no-op: false and no update", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const log = recorded(doc, () => {
      expect(setStickyColor(doc, id, DEFAULT_STICKY_COLOR)).toBe(false);
    });
    expect(log.count).toBe(0);
    expect(snapshot(doc).find((note) => note.id === id)!.color).toBe(DEFAULT_STICKY_COLOR);
  });
});

describe("board.model: delete", () => {
  it("TC-07: deleteObject removes the note", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const id = createSticky(doc, { x: 300, y: 0 }) as string;
    expect(snapshot(doc)).toHaveLength(2);

    const log = recorded(doc, () => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
    expect(stickyIds(doc)).not.toContain(id);
    expect(log.count).toBe(1);
    expect(log.origins).toEqual([LOCAL_ORIGIN]);
  });

  it("TC-08: deleteObject on a stale id returns false with no update", () => {
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    const log = recorded(doc, () => {
      expect(deleteObject(doc, "long-gone-id")).toBe(false);
    });
    expect(log.count).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe("board.model: read", () => {
  it("TC-11: equal z values are ordered by id, stably", () => {
    const doc = newDoc();
    const first = createSticky(doc, { x: 0, y: 0 }) as string;
    const second = createSticky(doc, { x: 300, y: 0 }) as string;

    // Force identical z, exactly what story 3 sync can produce.
    doc.transact(() => {
      const objects = objectsMap(doc);
      objects.get(first)!.set("z", 7);
      objects.get(second)!.set("z", 7);
    });

    const sortedById = [first, second].slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const expectedOrder = sortedById;

    const once = snapshot(doc).map((note) => note.id);
    const twice = snapshot(doc).map((note) => note.id);
    expect(once).toEqual(expectedOrder);
    expect(twice).toEqual(expectedOrder);

    // And the tie-break is not an accident of insertion order.
    const ids = [first, second];
    expect([...once].sort()).toEqual(ids.sort());
    expect(once).not.toEqual([first, second].sort((a, b) => (a < b ? 1 : -1)));
  });

  it("TC-12: objects of an unknown type are skipped, not thrown on", () => {
    const doc = newDoc();
    const stickyId = createSticky(doc, { x: 0, y: 0 }) as string;

    doc.transact(() => {
      const shape = new Y.Map<unknown>();
      shape.set("type", "shape");
      shape.set("x", 5);
      shape.set("y", 5);
      objectsMap(doc).set("shape-1", shape);
      // A malformed entry must not throw either.
      objectsMap(doc).set("broken-1", new Y.Map<unknown>([["type", "sticky"]]));
    });

    const notes = snapshot(doc);
    expect(notes.map((note) => note.id)).toEqual([stickyId]);
    expect(snapshot(doc).map((note) => note.id)).toEqual([stickyId]);
  });

  it("getStickyText returns the note's Y.Text and undefined for unknown ids", () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    const ytext = getStickyText(doc, id);
    expect(ytext).toBeInstanceOf(Y.Text);
    expect(ytext!.toString()).toBe("");

    doc.transact(() => ytext!.insert(0, "Faster onboarding"));
    expect(snapshot(doc).find((note) => note.id === id)!.text).toBe("Faster onboarding");

    expect(getStickyText(doc, "missing-id")).toBeUndefined();
  });
});
