import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deleteObject, snapshot } from "../../src/shared/board-model";
import { STICKY_SIZE_WORLD } from "../../src/shared/config";
import {
  addNoteAtOrigin,
  camera,
  clickNote,
  noteEl,
  noteElements,
  pressKey,
  pointer,
  renderBoard,
  settle,
  viewportEl,
  onlyNote,
} from "./helpers/notes";

describe("sticky note interaction states", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  /** TC-18: select on mouse down, keep selected until a click on empty space. */
  it("TC-18 selects a note on press and release", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);

    clickNote(id);
    await settle();

    expect(noteEl(id).dataset.selected).toBe("true");
    expect(document.querySelector("[data-testid='note-toolbar']")).not.toBeNull();
  });

  /** TC-19: release within the drag threshold selects, never moves. */
  it("TC-19 a press under the drag threshold does not move the note", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    const before = onlyNote(doc);

    const el = noteEl(id);
    pointer("pointerdown", el, 400, 400);
    pointer("pointermove", el, 402, 401);
    pointer("pointerup", el, 402, 401);
    await settle();

    const after = onlyNote(doc);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(noteEl(id).dataset.dragging).toBe("false");
    expect(noteEl(id).dataset.selected).toBe("true");
  });

  /** TC-20: 3px or more drags; the board does not pan and the camera is unchanged. */
  it("TC-20 dragging a note moves it without panning the board", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    const cameraBefore = camera();
    const before = onlyNote(doc);
    const zoom = cameraBefore.zoom;

    const el = noteEl(id);
    pointer("pointerdown", el, 400, 400);
    pointer("pointermove", el, 403, 400);
    await settle();

    expect(noteEl(id).dataset.dragging).toBe("true");
    expect(viewportEl().dataset.panning).toBe("false");
    expect(camera()).toEqual(cameraBefore);

    const moved = onlyNote(doc);
    expect(moved.x).toBeCloseTo(before.x + 3 / zoom, 9);
    expect(moved.y).toBeCloseTo(before.y, 9);

    pointer("pointerup", el, 403, 400);
    await settle();

    expect(noteEl(id).dataset.dragging).toBe("false");
    expect(noteEl(id).dataset.selected).toBe("true");
  });

  /** TC-21: an interrupted drag keeps the position the note was last shown at. */
  it("TC-21 a cancelled drag keeps the last applied position", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    const zoom = camera().zoom;

    const el = noteEl(id);
    pointer("pointerdown", el, 400, 400);
    pointer("pointermove", el, 410, 400);
    await settle();
    const applied = onlyNote(doc);
    expect(applied.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 10 / zoom, 9);

    // A further move that never gets a frame is not applied.
    pointer("pointermove", el, 460, 400);
    pointer("pointercancel", el, 460, 400);
    await settle();

    expect(onlyNote(doc).x).toBe(applied.x);
    expect(noteEl(id).dataset.dragging).toBe("false");
    expect(noteEl(id).dataset.selected).toBe("true");
  });

  /** TC-22: a press on empty board space that does not move deselects. */
  it("TC-22 clicking empty board space clears the selection", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);

    clickNote(id);
    await settle();
    expect(document.querySelector("[data-testid='note-toolbar']")).not.toBeNull();

    const board = viewportEl();
    pointer("pointerdown", board, 900, 700);
    pointer("pointerup", board, 900, 700);
    await settle();

    expect(noteEl(id).dataset.selected).toBe("false");
    expect(document.querySelector("[data-testid='note-toolbar']")).toBeNull();
  });

  /** TC-22 (second half): a pan keeps the selection. */
  it("TC-22 dragging the board keeps the selection", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);

    clickNote(id);
    await settle();

    const board = viewportEl();
    pointer("pointerdown", board, 900, 700);
    pointer("pointermove", board, 920, 700);
    pointer("pointerup", board, 920, 700);
    await settle();

    expect(noteEl(id).dataset.selected).toBe("true");
  });

  /** TC-25: Delete removes the selected note (separate run for Backspace). */
  it("TC-25 Delete removes the selected note", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    clickNote(id);
    await settle();

    pressKey("Delete");
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it("TC-25 Backspace removes the selected note", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    clickNote(id);
    await settle();

    pressKey("Backspace");
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  /** TC-35: double-clicking a note edits it and creates nothing. */
  it("TC-35 double-click on a note edits it instead of creating one", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    const before = onlyNote(doc);

    const el = noteEl(id);
    pointer("pointerdown", el, 300, 300);
    pointer("pointerup", el, 300, 300);
    await settle();
    // The text layer must not show while editing.
    expect(document.querySelector("[data-testid='sticky-text']")).not.toBeNull();

    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();

    expect(snapshot(doc)).toHaveLength(1);
    expect(onlyNote(doc).text).toBe(before.text);
    expect(document.querySelector("[data-testid='sticky-editor']")).not.toBeNull();
    expect(document.querySelector("[data-testid='sticky-text']")).toBeNull();
    expect(document.querySelector("[data-testid='note-toolbar']")).toBeNull();
  });

  /** TC-36: Enter with nothing selected does nothing. */
  it("TC-36 Enter without a selection creates nothing", async () => {
    renderBoard(doc);

    pressKey("Enter");
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(document.querySelector("[data-testid='sticky-editor']")).toBeNull();
  });

  /** TC-37: a note deleted mid-drag or mid-edit ends silently. */
  it("TC-37 a note deleted mid-drag is not moved or recreated", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);
    const el = noteEl(id);

    pointer("pointerdown", el, 400, 400);
    pointer("pointermove", el, 420, 400);
    await settle();

    deleteObject(doc, id);
    // The pending animation frame runs against a note that no longer exists.
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it("TC-37 a note deleted mid-edit ends without an error or a new note", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);

    const el = noteEl(id);
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();

    const editor = document.querySelector<HTMLTextAreaElement>("[data-testid='sticky-editor']");
    expect(editor).not.toBeNull();
    editor!.value = "half typed";
    editor!.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(onlyNote(doc).text).toBe("half typed");

    deleteObject(doc, id);
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(document.querySelector("[data-testid='sticky-editor']")).toBeNull();
  });

  /** Notes are reachable without a pointer. */
  it("notes are keyboard reachable and selected by focus", async () => {
    const id = addNoteAtOrigin(doc);
    renderBoard(doc);

    const el = noteEl(id);
    expect(el.getAttribute("tabindex")).toBe("0");
    el.focus();
    pressKey("Enter", el);
    await settle();

    expect(document.querySelector("[data-testid='sticky-editor']")).not.toBeNull();
  });
});
