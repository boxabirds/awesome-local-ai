import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN, moveObjects, snapshot } from "../../src/shared/board-model";
import { UNDO_CAPTURE_TIMEOUT_MS } from "../../src/shared/config";
import { createUndo, type UndoController } from "../../src/client/board/undo";

/**
 * Story 8, task 7 (TC-12, TC-13) — the boundary rule: a burst of typing is one
 * step, a gesture is one step, and what separates them is the boundary the client
 * puts between them, not luck about how fast someone typed.
 *
 * About the clock: Yjs's capture window is measured against the `Date.now`
 * reference `lib0` exported when Yjs was loaded, which a test cannot fake
 * (`vi.useFakeTimers()` replaces the `Date` global, not that captured reference,
 * and `vi.mock("lib0/time")` does not reach Yjs's own import). So elapsed time
 * here is real, and TC-13 steps *outside* a deliberately short window
 * (`SHORT_CAPTURE_MS`) rather than sitting exactly on the edge of the product's
 * 500 ms one — see NOTES.md. What is asserted is the rule: inside the window is
 * one step, outside it is another, and a boundary decides either way.
 */

/** A capture window short enough for a test to step outside of it. */
const SHORT_CAPTURE_MS = 40;
/** Comfortably past `SHORT_CAPTURE_MS`, still quick. */
const WAIT_PAST_WINDOW_MS = 160;
/** One character of typing at a plausible human speed. */
const TYPING_INTERVAL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let doc: Y.Doc;
let undo: UndoController;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
  doc.destroy();
});

function addNote(at: { x: number; y: number }): string {
  const id = createSticky(doc, at);
  if (typeof id !== "string") throw new Error("createSticky rejected the input");
  undo.boundary();
  return id;
}

/** One character of typing, with the tab's own origin, as `StickyTextEditor` writes it. */
function typeChar(id: string, index: number, char: string): void {
  doc.transact(() => getStickyText(doc, id)?.insert(index, char), LOCAL_ORIGIN);
}

function positionOf(id: string): { x: number; y: number } {
  const entry = snapshot(doc).find((item) => item.id === id);
  if (!entry) throw new Error(`note ${id} is not on the board`);
  return { x: entry.x, y: entry.y };
}

function textOf(id: string): string {
  return getStickyText(doc, id)?.toString() ?? "";
}

describe("undo.boundaries", () => {
  it("TC-12 typing 100 ms per character is one undo step", async () => {
    const id = addNote({ x: 100, y: 100 });
    const word = "hello";
    for (let index = 0; index < word.length; index += 1) {
      typeChar(id, index, word[index]!);
      await sleep(TYPING_INTERVAL_MS);
    }
    undo.boundary();

    expect(textOf(id)).toBe(word);
    expect(undo.undo()).toBe(true);
    // The whole burst went back at once — one step, not five.
    expect(textOf(id)).toBe("");
    // Only the note's creation is left behind.
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc).length).toBe(0);
  });

  it("TC-12 a drag closed by a boundary is one step, and what follows it is another", async () => {
    const id = addNote({ x: 100, y: 100 });
    const start = positionOf(id);

    // A gesture ends with model writes; the gesture closes with a boundary.
    undo.boundary();
    moveObjects(doc, new Map([[id, { x: 140, y: 140 }]]));
    await sleep(60);
    moveObjects(doc, new Map([[id, { x: 180, y: 150 }]]));
    await sleep(60);
    moveObjects(doc, new Map([[id, { x: 200, y: 160 }]]));
    undo.boundary();

    // Then one character of typing straight after, as if it were typed the
    // moment the drag was let go.
    typeChar(id, 0, "x");
    undo.boundary();
    expect(positionOf(id)).toEqual({ x: 200, y: 160 });
    expect(textOf(id)).toBe("x");

    // Undo 1: the typing alone. The gesture is still applied.
    expect(undo.undo()).toBe(true);
    expect(textOf(id)).toBe("");
    expect(positionOf(id)).toEqual({ x: 200, y: 160 });

    // Undo 2: the whole gesture, in one step.
    expect(undo.undo()).toBe(true);
    expect(positionOf(id)).toEqual(start);
  });

  it("TC-13 changes inside the capture window are one step, changes after it are separate", async () => {
    // A window short enough to cross, so "after the window" is a real wait and
    // not a coin toss: the rule is `now - lastChange < captureTimeout`.
    undo.destroy();
    undo = createUndo(doc, { captureTimeoutMs: SHORT_CAPTURE_MS });

    const inside = addNote({ x: 100, y: 100 });
    typeChar(inside, 0, "a");
    await sleep(5); // well inside the window; the wait is the point, not the edge
    typeChar(inside, 1, "b");
    undo.boundary();
    expect(textOf(inside)).toBe("ab");
    expect(undo.undo()).toBe(true);
    expect(textOf(inside)).toBe("");

    const outside = addNote({ x: 400, y: 100 });
    typeChar(outside, 0, "c");
    await sleep(WAIT_PAST_WINDOW_MS);
    typeChar(outside, 1, "d");
    undo.boundary();
    expect(textOf(outside)).toBe("cd");
    expect(undo.undo()).toBe(true);
    expect(textOf(outside)).toBe("c");
    expect(undo.undo()).toBe(true);
    expect(textOf(outside)).toBe("");
  });

  it("TC-13 inside the product's own window typing is still one step", async () => {
    const id = addNote({ x: 100, y: 100 });
    typeChar(id, 0, "a");
    await sleep(UNDO_CAPTURE_TIMEOUT_MS - 340); // well inside UNDO_CAPTURE_TIMEOUT_MS
    typeChar(id, 1, "b");
    undo.boundary();
    expect(textOf(id)).toBe("ab");
    expect(undo.undo()).toBe(true);
    expect(textOf(id)).toBe("");
  });

  it("a boundary closes the window without creating a step of its own", () => {
    addNote({ x: 100, y: 100 });
    const before = snapshot(doc).length;

    undo.boundary();
    undo.boundary();
    undo.boundary();
    expect(snapshot(doc).length).toBe(before);

    // Only the note's creation is in the history, and it is still one step.
    let steps = 0;
    while (undo.canUndo() && undo.undo()) steps += 1;
    expect(steps).toBe(1);
  });
});
