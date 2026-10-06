import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as Y from "yjs";
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from "../../src/shared/config";
import {
  addNote,
  addTestBox,
  boardSpace,
  changeModel,
  dragObject,
  objectById,
  pressKey,
  readBox,
  readCamera,
  readObjects,
  renderBoard,
  runAnimationFramesSynchronously,
  selectedIds,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 7, task 13 (TC-27 to TC-31) — the selection keyboard.
 *
 * Ctrl/Cmd+A selects everything on the board that this client can select, Escape
 * clears it, the arrows nudge it by one board unit (ten with Shift) without
 * panning the board, and Delete/Backspace remove it. Keys the board handles call
 * `preventDefault`; keys that belong to a text field do not (TC-30).
 */

describe("sel.keyboard: the selection keyboard", () => {
  let board: RenderHandle;

  beforeEach(() => {
    runAnimationFramesSynchronously();
    board = renderBoard();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-27 Ctrl+A selects every object on the board and prevents the browser's own select-all", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 100 });
    const box = addTestBox(board, { x: 700, y: 100 }, { width: 80, height: 80 });

    expect(pressKey("a", document.body, { ctrlKey: true })).toBe(false);

    expect(selectedIds(board.screen).sort()).toEqual([a, b, box].sort());
    expect(board.screen.getByTestId("selection-count").textContent).toBe("3 selected");
  });

  it("Cmd+A (macOS) does the same", () => {
    const a = addNote(board, { x: 100, y: 100 });

    expect(pressKey("a", document.body, { metaKey: true })).toBe(false);

    expect(selectedIds(board.screen)).toEqual([a]);
  });

  it("TC-28 select-all on an empty board selects nothing and breaks nothing", () => {
    expect(pressKey("a", document.body, { ctrlKey: true })).toBe(false);

    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("select-all skips objects whose type is not registered", () => {
    const known = addNote(board, { x: 100, y: 100 });
    changeModel(() => {
      const objects = board.doc.getMap<Y.Map<unknown>>("objects");
      const entry = new Y.Map<unknown>();
      entry.set("type", "from-the-future");
      entry.set("x", 900);
      entry.set("y", 100);
      entry.set("z", 99);
      entry.set("createdAt", 1);
      objects.set("future-1", entry);
    });

    pressKey("a", document.body, { ctrlKey: true });

    expect(selectedIds(board.screen)).toEqual([known]);
  });

  it("TC-29 the arrows nudge the selection by one board unit, and the board does not pan", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 300, y: 100 });
    board.changeSelection([a, b]);
    const before = [readBox(board.doc, a), readBox(board.doc, b)];
    const camera = readCamera();

    expect(pressKey("ArrowRight")).toBe(false);

    const after = [readBox(board.doc, a), readBox(board.doc, b)];
    expect(after[0].x - before[0].x).toBe(NUDGE_STEP_WORLD);
    expect(after[1].x - before[1].x).toBe(NUDGE_STEP_WORLD);
    expect(after[0].y).toBe(before[0].y);
    // The board itself did not move, and the objects are still selected.
    expect(readCamera()).toEqual(camera);
    expect(selectedIds(board.screen).sort()).toEqual([a, b].sort());
  });

  it("TC-29 Shift+arrow nudges by the large step, in the opposite axis direction for ArrowUp", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);
    const before = readBox(board.doc, a);

    pressKey("ArrowUp", document.body, { shiftKey: true });
    pressKey("ArrowLeft", document.body, { shiftKey: true });
    pressKey("ArrowDown");
    pressKey("ArrowRight");

    const after = readBox(board.doc, a);
    expect(after.x - before.x).toBe(-NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD);
    expect(after.y - before.y).toBe(-NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD);
  });

  it("an arrow with nothing selected does not move any object", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const before = readBox(board.doc, a);

    pressKey("ArrowRight");

    expect(readBox(board.doc, a)).toEqual(before);
  });

  it("TC-30 Backspace while typing edits the text and keeps the object", () => {
    const a = addNote(board, { x: 100, y: 100 }, "yellow", "hello");
    board.changeSelection([a]);
    pressKey("Enter");

    const input = board.screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    expect(input.value).toBe("hello");

    // The key belongs to the text field: the board must not delete the note.
    expect(fireEvent.keyDown(input, { key: "Backspace", code: "Backspace" })).toBe(true);

    expect(readObjects(board.doc).map((entry) => entry.id)).toEqual([a]);
    expect(board.screen.getByTestId("sticky-note-input")).toBeTruthy();
  });

  it("TC-31 Delete removes every selected object and clears the selection", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 100 });
    const keep = addNote(board, { x: 700, y: 100 });
    const box = addTestBox(board, { x: 900, y: 100 }, { width: 60, height: 60 });
    board.changeSelection([a, b, box]);

    expect(pressKey("Delete")).toBe(false);

    expect(readObjects(board.doc).map((entry) => entry.id)).toEqual([keep]);
    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("Backspace deletes the selection when nobody is typing", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);

    pressKey("Backspace");

    expect(readObjects(board.doc)).toEqual([]);
    expect(selectedIds(board.screen)).toEqual([]);
  });

  it("Delete with nothing selected removes nothing", () => {
    const a = addNote(board, { x: 100, y: 100 });

    pressKey("Delete");

    expect(readObjects(board.doc).map((entry) => entry.id)).toEqual([a]);
  });

  it("Escape clears the selection and is prevented only then", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);

    expect(pressKey("Escape")).toBe(false);
    expect(selectedIds(board.screen)).toEqual([]);
    // With no selection, Escape is left to the browser.
    expect(pressKey("Escape")).toBe(true);
  });

  it("Enter starts editing exactly one selected sticky note", () => {
    const a = addNote(board, { x: 100, y: 100 }, "yellow", "text");
    board.changeSelection([a]);

    pressKey("Enter");

    expect(board.screen.getByTestId("sticky-note-input")).toBeTruthy();
  });

  it("Enter does nothing when several objects are selected", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 100 });
    board.changeSelection([a, b]);

    pressKey("Enter");

    expect(board.screen.queryByTestId("sticky-note-input")).toBeNull();
  });

  it("a nudge moves objects of every registered type", () => {
    const note = addNote(board, { x: 100, y: 100 });
    const box = addTestBox(board, { x: 400, y: 100 }, { width: 60, height: 60 });
    board.changeSelection([note, box]);
    const before = [readBox(board.doc, note), readBox(board.doc, box)];

    pressKey("ArrowRight");

    const after = [readBox(board.doc, note), readBox(board.doc, box)];
    expect(after[0].x - before[0].x).toBe(NUDGE_STEP_WORLD);
    expect(after[1].x - before[1].x).toBe(NUDGE_STEP_WORLD);
  });

  it("a keyboard nudge does not pan the board even while it is panning-sized", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);
    const camera = readCamera();

    dragObject(boardSpace(board.screen), { x: 10, y: 10 }, { x: 60, y: 60 });
    const panned = readCamera();
    pressKey("ArrowRight");

    expect(readCamera()).toEqual(panned);
    expect(panned.x).not.toBe(camera.x);
  });

  it("an object somebody else deleted drops out before the arrows are pressed", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 400, y: 100 });
    board.changeSelection([a, b]);
    const before = readBox(board.doc, a);
    changeModel(() => {
      board.doc.getMap("objects").delete(b);
    });

    pressKey("ArrowRight");

    // Only the surviving object moved, and the selection no longer mentions the
    // object that is gone.
    expect(readBox(board.doc, a).x - before.x).toBe(NUDGE_STEP_WORLD);
    expect(selectedIds(board.screen)).toEqual([a]);
  });

  it("the selection bar's Delete works on a selection made with the keyboard", () => {
    addNote(board, { x: 100, y: 100 });
    addNote(board, { x: 400, y: 100 });
    pressKey("a", document.body, { ctrlKey: true });

    fireEvent.click(board.screen.getByTestId("selection-delete"));

    expect(readObjects(board.doc)).toEqual([]);
    expect(selectedIds(board.screen)).toEqual([]);
  });

  it("objects remain clickable after a select-all-and-delete round trip", () => {
    addNote(board, { x: 100, y: 100 });
    addNote(board, { x: 400, y: 100 });
    pressKey("a", document.body, { ctrlKey: true });
    pressKey("Delete");

    const fresh = addNote(board, { x: 700, y: 100 });
    dragObject(objectById(board.screen, fresh), { x: 700, y: 700 }, { x: 700, y: 700 });

    expect(selectedIds(board.screen)).toEqual([fresh]);
    expect(board.screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });
});
