import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { getStickyText } from "../../src/shared/board-model";
import { DRAG_THRESHOLD_PX } from "../../src/shared/config";
import {
  addNote,
  dragObject,
  noteById,
  objectById,
  objectCount,
  pointer,
  pressKey,
  readBox,
  readNotes,
  renderBoard,
  runAnimationFramesSynchronously,
  screenDelta,
  screenOf,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 8, task 9 (TC-14 to TC-17) — a step is an action, not a write.
 *
 * A real `Y.Doc`, a real `Y.UndoManager` and story 7's real gesture hook, wired
 * the way `App` wires them. Each case drags or types through the components and
 * then undoes **once**, because that is the whole claim: thirty animation frames
 * of one drag is one step, a cancelled drag is one step, a drag and a colour
 * change are two steps, and typing in a note does not reach back to the move
 * before it.
 */

describe("undo.boundaries in the components", () => {
  let board: RenderHandle | undefined;

  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    board?.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("TC-14 a 30-frame drag of a selection is one undo step", () => {
    board = renderBoard();
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 300 });
    board.changeSelection([a, b]);

    const startA = readBox(board.doc, a);
    const startB = readBox(board.doc, b);

    // Thirty frames of one gesture, each one its own `moveObjects` transaction.
    dragObject(
      objectById(board.screen, a),
      screenOf({ x: 100, y: 100 }),
      screenOf({ x: 100 + 60, y: 100 - 40 }),
      { n: 30 },
    );

    const draggedA = readBox(board.doc, a);
    const draggedB = readBox(board.doc, b);
    expect([draggedA.x - startA.x, draggedA.y - startA.y]).toEqual([60, -40]);
    expect([draggedB.x - startB.x, draggedB.y - startB.y]).toEqual([60, -40]);

    // One undo, one step: both objects are back where the gesture began.
    expect(pressKey("z", document.body, { ctrlKey: true })).toBe(false);
    expect(readBox(board.doc, a)).toEqual(startA);
    expect(readBox(board.doc, b)).toEqual(startB);

    // Both notes are still on the board, so the gesture did not swallow their
    // creation into itself: the creations are the steps below it.
    expect(objectCount(board.doc)).toBe(2);
    expect(board.undo().undo()).toBe(true);
    expect(objectCount(board.doc)).toBe(0);
  });

  it("TC-15 a drag and a colour change 200 ms later are two separate steps", async () => {
    board = renderBoard();
    const id = addNote(board, { x: 200, y: 200 }, "yellow");
    const start = readBox(board.doc, id);

    dragObject(
      objectById(board.screen, id),
      screenOf({ x: 200, y: 200 }),
      screenOf({ x: 260, y: 200 }),
      { n: 5 },
    );
    const dragged = readBox(board.doc, id);

    // 200 ms later, and still inside the capture window: what keeps these two
    // actions apart is the boundary the gesture closed, not the pause between them.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The note is selected after the drag, so its toolbar is on screen.
    fireEvent.click(screen.getByTestId("swatch-pink"));
    expect(readNotes(board.doc).find((note) => note.id === id)?.color).toBe("pink");

    // Undo 1: the colour only. The move is still applied.
    expect(board.undo().undo()).toBe(true);
    expect(readNotes(board.doc).find((note) => note.id === id)?.color).toBe("yellow");
    expect(readBox(board.doc, id)).toEqual(dragged);

    // Undo 2: the move.
    expect(board.undo().undo()).toBe(true);
    expect(readBox(board.doc, id)).toEqual(start);
  });

  it("TC-16 Ctrl+Z inside the editor undoes the typing and leaves the move before it alone", () => {
    board = renderBoard();
    const id = addNote(board, { x: 300, y: 100 }, "yellow", "keep");
    const start = readBox(board.doc, id);

    dragObject(
      objectById(board.screen, id),
      screenOf({ x: 300, y: 100 }),
      screenOf({ x: 360, y: 100 }),
      { n: 4 },
    );
    const dragged = readBox(board.doc, id);
    expect(dragged).not.toEqual(start);

    // A double-click edits the note; typing goes through the field, as it does
    // for a person.
    fireEvent.doubleClick(noteById(board.screen, id));
    const field = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "keep hello" } });
    expect(getStickyText(board.doc, id)?.toString()).toBe("keep hello");

    // Ctrl+Z inside the field: the board takes the key over (returns `false`),
    // and the typing is what goes back.
    expect(pressKey("z", field, { ctrlKey: true })).toBe(false);
    expect(getStickyText(board.doc, id)?.toString()).toBe("keep");
    // The move before it is untouched — that is the negative half of this case.
    expect(readBox(board.doc, id)).toEqual(dragged);

    // Leaving the note (Escape ends editing, the text stays) gives the keyboard
    // back to the board, and undoing again is the move.
    expect(pressKey("Escape", field)).toBe(false);
    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
    expect(pressKey("z", document.body, { ctrlKey: true })).toBe(false);
    expect(readBox(board.doc, id)).toEqual(start);
  });

  it("TC-17 a drag cancelled mid-way is still one step, restoring the start position", () => {
    board = renderBoard();
    const id = addNote(board, { x: 100, y: 400 }, "yellow");
    const start = readBox(board.doc, id);
    const el = objectById(board.screen, id);
    const from = screenOf({ x: 100, y: 400 });
    const step = screenDelta({ x: 40, y: 20 });

    pointer("pointerDown", el, from.x, from.y);
    for (let frame = 1; frame <= 3; frame += 1) {
      pointer("pointerMove", el, from.x + (step.x * frame) / 3, from.y + (step.y * frame) / 3);
    }
    expect(readBox(board.doc, id)).not.toEqual(start);

    // The pointer is taken away mid-gesture (a system gesture, a lost touch).
    pointer("pointerCancel", el, from.x + step.x, from.y + step.y);
    const cancelled = readBox(board.doc, id);

    // One undo closes the whole partial drag.
    expect(board.undo().undo()).toBe(true);
    expect(readBox(board.doc, id)).toEqual(start);
    // And the cancelled drag was not remembered as three frames.
    expect(board.undo().undo()).toBe(true);
    expect(objectCount(board.doc)).toBe(0);
    expect(cancelled).not.toEqual(start);
  });

  it("a click that never passes the drag threshold is not an undo step", () => {
    board = renderBoard();
    const id = addNote(board, { x: 100, y: 100 }, "yellow");
    const start = readBox(board.doc, id);

    const nudge = Math.max(1, Math.floor(DRAG_THRESHOLD_PX / 2));
    dragObject(
      objectById(board.screen, id),
      screenOf({ x: 100, y: 100 }),
      screenOf({ x: 100 + nudge, y: 100 }),
      { n: 2 },
    );
    expect(readBox(board.doc, id)).toEqual(start);

    // Undo takes back the note's creation and nothing else.
    expect(board.undo().undo()).toBe(true);
    expect(objectCount(board.doc)).toBe(0);
    expect(board.undo().canUndo()).toBe(false);
  });

  it("creating a note from the board is one step, and typing in it is another", () => {
    board = renderBoard();
    const id = addNote(board, { x: 100, y: 100 }, "yellow");

    // `addNote` writes the model the way the toolbar does, and typing then lands
    // in the same capture window unless a boundary closes it. Here the note is
    // edited through the components, which close it at edit start.
    fireEvent.doubleClick(noteById(board.screen, id));
    const field = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "typed" } });

    expect(board.undo().undo()).toBe(true);
    expect(getStickyText(board.doc, id)?.toString()).toBe("");
    expect(objectCount(board.doc)).toBe(1);

    expect(board.undo().undo()).toBe(true);
    expect(objectCount(board.doc)).toBe(0);
  });
});
