import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObjects,
  resizeObjects,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, UNDO_MAX_STEPS, type StickyColor } from "../../src/shared/config";
import { createUndo, type UndoController } from "../../src/client/board/undo";
import { applyLoadUpdate, createPeer, type Peer } from "./helpers/peer";

/**
 * Story 8, task 6 (TC-01 to TC-11) — `undo.history`: one person's own undo
 * history over a shared board.
 *
 * The peer is a second real Y.Doc exchanging real updates with a non-local
 * origin (`tests/unit/helpers/peer.ts`), and the "load" is story 4's
 * `LOAD_ORIGIN`. Both are the negative half of the whole story: whatever did not
 * come from this tab must never be reversible from it.
 */

let doc: Y.Doc;
let undo: UndoController;
let peer: Peer;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  undo = createUndo(doc);
  peer = createPeer(doc);
});

afterEach(() => {
  undo.destroy();
  peer.destroy();
  doc.destroy();
});

/** A note created the way the client creates one: its own local transactions. */
function addNote(at: { x: number; y: number }, color: StickyColor = "yellow", text = ""): string {
  const id = createSticky(doc, at, color);
  if (typeof id !== "string") throw new Error("createSticky rejected the input");
  if (text !== "") {
    doc.transact(() => getStickyText(doc, id)?.insert(0, text), LOCAL_ORIGIN);
  }
  undo.boundary();
  return id;
}

function note(id: string): StickySnapshot {
  const found = (snapshot(doc) as StickySnapshot[]).find((entry) => entry.id === id);
  if (!found) throw new Error(`note ${id} is not on the board`);
  return found;
}

function noteCount(): number {
  return snapshot(doc).length;
}

/** A local move, closed as its own step the way the gesture closes it. */
function move(id: string, x: number, y: number): void {
  undo.boundary();
  moveObjects(doc, new Map([[id, { x, y }]]));
  undo.boundary();
}

function textOf(id: string): string {
  return getStickyText(doc, id)?.toString() ?? "";
}

/** Undo until the history is empty, and report how many steps that took. */
function drainUndo(): number {
  let steps = 0;
  while (undo.canUndo() && undo.undo()) steps += 1;
  return steps;
}

describe("undo.history: my undo reverses my change only", () => {
  it("TC-01 undoes my move and leaves a colleague's create and recolour alone", () => {
    const moved = addNote({ x: 100, y: 100 }, "yellow", "mine");
    const recoloured = addNote({ x: 500, y: 100 }, "blue");
    const before = { ...note(moved) };

    // A colleague creates a note and recolours one of mine.
    peer.change((peerDoc) => {
      createSticky(peerDoc, { x: 900, y: 100 }, "green");
      peerDoc.transact(() => {
        getStickyText(peerDoc, recoloured)?.insert(0, " peer wrote here");
      }, LOCAL_ORIGIN);
    });
    peer.change((peerDoc) => setStickyColor(peerDoc, recoloured, "violet"));
    expect(note(recoloured).color).toBe("violet");
    expect(noteCount()).toBe(3);

    move(moved, 320, 240);
    expect(undo.canUndo()).toBe(true);

    expect(undo.undo()).toBe(true);

    // My move is gone.
    const restored = note(moved);
    expect([restored.x, restored.y]).toEqual([before.x, before.y]);
    expect(restored.text).toBe(before.text);
    // Their note is still there, with their colour.
    expect(noteCount()).toBe(3);
    const colleague = (snapshot(doc) as StickySnapshot[]).find(
      (entry) => entry.id !== moved && entry.id !== recoloured,
    );
    expect(colleague?.color).toBe("green");
    // Their text in *my* note survives too, and so does their recolour of it:
    // undo never reverts a remote key change.
    expect(note(recoloured).text).toBe(" peer wrote here");
    expect(note(recoloured).color).toBe("violet");

    // Undoing my move does not touch either of those.
    expect(undo.canRedo()).toBe(true);
  });

  it("TC-02 a board only other people changed has nothing for me to undo", () => {
    peer.change((peerDoc) => createSticky(peerDoc, { x: 100, y: 100 }));
    peer.change((peerDoc) => {
      const id = createSticky(peerDoc, { x: 400, y: 100 }, "pink");
      if (typeof id === "string") peerDoc.transact(() => getStickyText(peerDoc, id)?.insert(0, "hi"), LOCAL_ORIGIN);
    });

    expect(noteCount()).toBe(2);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
  });

  it("TC-03 a board that was loaded, not edited, has nothing to undo", () => {
    applyLoadUpdate(doc, (scratch) => {
      scratch.transact(() => {
        const objects = scratch.getMap<Y.Map<unknown>>("objects");
        const entry = new Y.Map<unknown>();
        entry.set("type", "sticky");
        entry.set("x", 120);
        entry.set("y", 120);
        entry.set("color", "blue");
        entry.set("text", new Y.Text("loaded from storage"));
        entry.set("z", 1);
        entry.set("createdAt", 1);
        objects.set("loaded-note", entry);
      }, LOCAL_ORIGIN);
    });

    expect(noteCount()).toBe(1);
    expect(note("loaded-note").text).toBe("loaded from storage");
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
  });

  it("TC-04 undoing my delete brings all eight notes back exactly as they were", () => {
    const cluster: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      cluster.push(
        addNote(
          { x: 100 + index * 220, y: 100 + (index % 2) * 240 },
          (["yellow", "orange", "green", "blue", "pink", "violet"] as StickyColor[])[index % 6]!,
          `note ${index}`,
        ),
      );
    }
    // One of them had been resized: its size must come back too.
    undo.boundary();
    resizeObjects(doc, new Map([[cluster[0]!, { x: 100, y: 100, width: 320, height: 320 }]]));
    undo.boundary();

    const before = new Map(cluster.map((id) => [id, { ...note(id) }]));
    expect(note(cluster[0]!).width).toBe(320);

    expect(deleteObjects(doc, cluster)).toBe(8);
    undo.boundary();
    expect(noteCount()).toBe(0);

    expect(undo.undo()).toBe(true);
    expect(noteCount()).toBe(8);
    for (const id of cluster) {
      const was = before.get(id)!;
      const now = note(id);
      expect({ ...now }).toEqual({ ...was });
    }
  });

  it("TC-05 redo re-applies the change I just undid", () => {
    const id = addNote({ x: 100, y: 100 });
    const start = { ...note(id) };

    move(id, 260, 180);
    expect(undo.undo()).toBe(true);
    expect({ ...note(id) }).toEqual(start);
    expect(undo.canRedo()).toBe(true);

    expect(undo.redo()).toBe(true);
    expect([note(id).x, note(id).y]).toEqual([260, 180]);
    expect(undo.canRedo()).toBe(false);
    expect(undo.canUndo()).toBe(true);
  });

  it("TC-06 a new change after undoing discards my redo history", () => {
    const moved = addNote({ x: 100, y: 100 });
    const other = addNote({ x: 600, y: 100 });
    const movedStart = { ...note(moved) };
    const otherStart = { ...note(other) };

    move(moved, 300, 300);
    expect(undo.undo()).toBe(true);
    expect(undo.canRedo()).toBe(true);

    move(other, 700, 700);
    expect(undo.canRedo()).toBe(false);
    expect(undo.redo()).toBe(false);
    // The move that was undone is still undone.
    expect({ ...note(moved) }).toEqual(movedStart);
    expect([note(other).x, note(other).y]).toEqual([700, 700]);
    expect({ ...note(other) }).not.toEqual(otherStart);
  });

  it("TC-07 undoing a move of a note a colleague deleted does nothing and does not break", () => {
    const doomed = addNote({ x: 100, y: 100 }, "yellow", "doomed");
    const keep = addNote({ x: 400, y: 400 }, "blue", "kept");
    move(keep, 460, 460);
    const keepMoved = { ...note(keep) };
    move(doomed, 200, 200);

    peer.change((peerDoc) => {
      deleteObjects(peerDoc, [doomed]);
    });
    expect(noteCount()).toBe(1);

    // No error and no resurrection: the step targets a note that is gone.
    let applied = false;
    expect(() => {
      applied = undo.undo();
    }).not.toThrow();
    expect(snapshot(doc).find((entry) => entry.id === doomed)).toBeUndefined();
    expect(noteCount()).toBe(1);

    // The history stays usable: a step still gets undone, and it is a real one.
    let guard = 0;
    while (!applied && undo.canUndo() && guard < 8) {
      applied = undo.undo();
      guard += 1;
    }
    expect(applied).toBe(true);
    expect(note(keep)).not.toEqual(keepMoved);
    expect(snapshot(doc).find((entry) => entry.id === doomed)).toBeUndefined();
    expect(note(keep).text).toBe("kept");
  });

  it("TC-08 undoing my delete restores a note a colleague had just edited", () => {
    const id = addNote({ x: 100, y: 100 }, "yellow", "draft");
    peer.change((peerDoc) => {
      peerDoc.transact(() => getStickyText(peerDoc, id)?.insert(5, " — peer edit"), LOCAL_ORIGIN);
    });
    expect(textOf(id)).toBe("draft — peer edit");

    undo.boundary();
    deleteObjects(doc, [id]);
    undo.boundary();
    expect(noteCount()).toBe(0);

    expect(undo.undo()).toBe(true);
    // Back with the content it had at the moment I deleted it.
    expect(textOf(id)).toBe("draft — peer edit");
    expect(note(id).color).toBe("yellow");
  });

  it("TC-09 at UNDO_MAX_STEPS the oldest step is discarded when a new one is added", () => {
    const ids: string[] = [];
    for (let index = 0; index < UNDO_MAX_STEPS + 1; index += 1) {
      ids.push(addNote({ x: 100 + index * 10, y: 100 }));
    }
    expect(noteCount()).toBe(UNDO_MAX_STEPS + 1);

    // Exactly `UNDO_MAX_STEPS` steps are available, and the one that fell off is
    // the *oldest*: the first note can never be undone.
    expect(drainUndo()).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    expect(noteCount()).toBe(1);
    expect(snapshot(doc).find((entry) => entry.id === ids[0])).toBeDefined();
    expect(ids.slice(1).every((id) => snapshot(doc).some((entry) => entry.id === id))).toBe(false);
  });

  it("TC-10 at UNDO_MAX_STEPS minus one nothing is discarded", () => {
    const ids: string[] = [];
    for (let index = 0; index < UNDO_MAX_STEPS; index += 1) {
      ids.push(addNote({ x: 100 + index * 10, y: 100 }));
    }
    expect(noteCount()).toBe(UNDO_MAX_STEPS);

    expect(drainUndo()).toBe(UNDO_MAX_STEPS);
    expect(undo.canUndo()).toBe(false);
    expect(noteCount()).toBe(0);
  });

  it("TC-11 a fresh controller after a reload starts with an empty history", () => {
    const id = addNote({ x: 100, y: 100 });
    move(id, 300, 300);
    expect(undo.canUndo()).toBe(true);

    undo.destroy();
    undo = createUndo(doc);
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(undo.undo()).toBe(false);
    // The board itself is untouched.
    expect([note(id).x, note(id).y]).toEqual([300, 300]);
  });
});

describe("undo.history: the controller's own contract", () => {
  it("onChange reports every change to the stacks and can be unsubscribed", () => {
    let calls = 0;
    const unsubscribe = undo.onChange(() => {
      calls += 1;
    });

    addNote({ x: 100, y: 100 });
    const afterChange = calls;
    expect(afterChange).toBeGreaterThan(0);

    undo.undo();
    expect(calls).toBeGreaterThan(afterChange);

    unsubscribe();
    const afterUnsubscribe = calls;
    addNote({ x: 400, y: 400 });
    expect(calls).toBe(afterUnsubscribe);
  });

  it("boundary() on an empty history is a no-op", () => {
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });

  it("destroy() is idempotent and stops the controller from capturing", () => {
    undo.destroy();
    undo.destroy();
    addNote({ x: 100, y: 100 });
    expect(undo.canUndo()).toBe(false);
  });

  it("addScope widens the history without new undo code (story 16's comments)", () => {
    const comments = doc.getMap<Y.Map<unknown>>("comments");
    const before = snapshot(doc).length;

    doc.transact(() => comments.set("c1", new Y.Map([["body", "not tracked yet"]])), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(false);

    undo.addScope(comments);
    doc.transact(() => comments.set("c2", new Y.Map([["body", "tracked now"]])), LOCAL_ORIGIN);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(comments.has("c2")).toBe(false);
    expect(comments.has("c1")).toBe(true);
    expect(snapshot(doc).length).toBe(before);
  });
});

describe("undo.history: the settings are the ones the product names", () => {
  it("the defaults are UNDO_MAX_STEPS and the board model's own limits still apply", () => {
    // A resize the model rejects is not a step at all: nothing was written.
    const id = addNote({ x: 100, y: 100 });
    undo.boundary();
    expect(
      resizeObjects(doc, new Map([[id, { x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD - 1, height: STICKY_SIZE_WORLD }]])),
    ).toBe(0);
    undo.boundary();
    expect(undo.canUndo()).toBe(true); // the note's creation is still the only step
    expect(drainUndo()).toBe(1);
    expect(noteCount()).toBe(0);
  });
});
