import { beforeEach, describe, expect, it } from "vitest";
import { deleteObjects } from "../../src/shared/board-model";
import { STICKY_SIZE_WORLD } from "../../src/shared/config";
import {
  fireEvent,
  addNote,
  addTestBox,
  changeModel,
  dragObject,
  noteById,
  objectById,
  pressKey,
  readNotes,
  renderBoard,
  selectedIds,
  boardSpace,
  TESTBOX_TYPE,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 7, task 10 (TC-16 to TC-19) — the selection and the bar above it.
 *
 * The selection is this screen's own view state: it is never written to the
 * document (asserted below), it drops objects somebody else deleted, and from two
 * objects upward the bar offers one Delete for the whole selection where story 2
 * offered a per-note toolbar.
 */

describe("sel.interaction: the selection bar", () => {
  let board: RenderHandle;

  beforeEach(() => {
    board = renderBoard();
  });

  it("TC-17 two objects selected -> a bar reading '2 selected' with a Delete button", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    board.changeSelection([a, b]);

    const bar = board.screen.getByTestId("selection-bar");
    expect(bar.textContent).toContain("2 selected");

    const count = board.screen.getByTestId("selection-count");
    // A screen reader hears the count change (`sel.keyboard` accessibility).
    expect(count.getAttribute("aria-live")).toBe("polite");

    const deleteButton = board.screen.getByTestId("selection-delete");
    expect(deleteButton.getAttribute("aria-label")).toBe("Delete selection");
  });

  it("TC-17 the count follows the selection", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    const c = addNote(board, { x: 900, y: 100 });
    board.changeSelection([a, b]);
    expect(board.screen.getByTestId("selection-count").textContent).toBe("2 selected");

    board.changeSelection([a, b, c]);
    expect(board.screen.getByTestId("selection-count").textContent).toBe("3 selected");
  });

  it("the bar's Delete button removes every selected object and clears the selection", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    const keep = addNote(board, { x: 900, y: 100 });
    board.changeSelection([a, b]);

    fireEvent.click(board.screen.getByTestId("selection-delete"));

    expect(readNotes(board.doc).map((note) => note.id)).toEqual([keep]);
    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("TC-18 exactly one sticky note selected shows story 2's note toolbar, not the bar", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);

    expect(board.screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("TC-16 objects deleted by somebody else leave the selection; the bar disappears", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    board.changeSelection([a, b]);
    expect(board.screen.getByTestId("selection-count").textContent).toBe("2 selected");

    changeModel(() => {
      deleteObjects(board.doc, [a, b]);
    });

    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("a remote delete drops one object from the selection and keeps the rest selected", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    const c = addNote(board, { x: 900, y: 100 });
    board.changeSelection([a, b, c]);

    changeModel(() => {
      deleteObjects(board.doc, [b]);
    });

    expect(selectedIds(board.screen).sort()).toEqual([a, c].sort());
    expect(board.screen.getByTestId("selection-count").textContent).toBe("2 selected");
  });

  it("selection is never written to the document", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const before = JSON.stringify(readNotes(board.doc));

    board.changeSelection([a]);
    dragObject(noteById(board.screen, a), { x: 100, y: 100 }, { x: 101, y: 101 });

    expect(JSON.stringify(readNotes(board.doc))).toBe(before);
  });

  it("TC-19 clicking empty board space without dragging clears the selection", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);
    expect(selectedIds(board.screen)).toEqual([a]);

    dragObject(boardSpace(board.screen), { x: 20, y: 20 }, { x: 20, y: 20 });

    expect(selectedIds(board.screen)).toEqual([]);
  });

  it("a click on an object replaces the selection; Shift+click adds to it", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });

    dragObject(noteById(board.screen, a), { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(selectedIds(board.screen)).toEqual([a]);

    dragObject(noteById(board.screen, b), { x: 500, y: 100 }, { x: 500, y: 100 }, { shiftKey: true });
    expect(selectedIds(board.screen).sort()).toEqual([a, b].sort());

    // A plain click on one of them replaces the whole selection.
    dragObject(noteById(board.screen, a), { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(selectedIds(board.screen)).toEqual([a]);

    // Shift+clicking the only selected member leaves nothing selected.
    dragObject(noteById(board.screen, a), { x: 100, y: 100 }, { x: 100, y: 100 }, { shiftKey: true });
    expect(selectedIds(board.screen)).toEqual([]);
  });

  it("selection works the same for another object type", () => {
    const sticky = addNote(board, { x: 100, y: 100 });
    const box = addTestBox(board, { x: 600, y: 100 });
    expect(board.screen.getByTestId("testbox").dataset.objectType).toBe(TESTBOX_TYPE);

    board.changeSelection([sticky, box]);
    expect(selectedIds(board.screen).sort()).toEqual([sticky, box].sort());
    expect(board.screen.getByTestId("selection-count").textContent).toBe("2 selected");

    // And its own Delete removes objects of both types.
    fireEvent.click(board.screen.getByTestId("selection-delete"));
    expect(readNotes(board.doc)).toEqual([]);
  });

  it("Escape clears the selection", () => {
    const a = addNote(board, { x: 100, y: 100 });
    board.changeSelection([a]);

    pressKey("Escape");

    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("a selected object is outlined and drawn with its selection state", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    board.changeSelection([a, b]);

    expect(noteById(board.screen, a).className).toContain("is-selected");
    expect(objectById(board.screen, a).dataset.selected).toBe("true");
    // The bounding box around the whole selection, with its 8 handles.
    const overlay = board.screen.getByTestId("selection-overlay");
    expect(overlay.dataset.selectionSize).toBe("2");
    expect(overlay.querySelectorAll("[data-handle]").length).toBe(8);
  });

  it("the bounding box around a group is the union of the objects' boxes", () => {
    const a = addNote(board, { x: 100, y: 100 });
    const b = addNote(board, { x: 500, y: 100 });
    board.changeSelection([a, b]);

    const overlay = board.screen.getByTestId("selection-overlay");
    // Both notes are 200 units wide, centred on their points.
    expect(overlay.style.width).toBe(`${2 * STICKY_SIZE_WORLD + 200}px`);
  });
});
