import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { deleteObject } from "../../src/shared/board-model";
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from "../../src/shared/config";
import {
  boardSpace,
  changeModel,
  dragNote,
  newNote,
  noteElements,
  noteById,
  noteOf,
  pointer,
  pressKey,
  readCamera,
  readNotes,
  runAnimationFramesSynchronously,
  selectNote,
  selectedIds,
} from "./boardFixture";

/**
 * Story 2, task 7 (part 1) — sticky note interaction (TC-18 to TC-22, TC-25,
 * TC-35 to TC-37), tested through the real wiring in `App`: viewport, notes,
 * toolbars and keyboard behaviour, with a real Y.Doc injected.
 *
 * jsdom has no layout engine, so nothing here asserts rendered pixels: note
 * state is asserted on the Y.Doc, interaction state on the data attributes the
 * components expose, and stacking on z, which is the application's own answer
 * to "drawn above". Pixel-accurate dragging is e2e (TC-30 to TC-32).
 */

beforeEach(() => {
  runAnimationFramesSynchronously();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sticky.interaction: select, drag, create, delete", () => {
  it("TC-18 pointerdown and up without moving selects the note: outline and NoteToolbar rendered", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 40, y: 60 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    selectNote(screen, id);

    expect(selectedIds(screen)).toEqual([id]);
    expect(noteById(screen, id).className).toContain("is-selected");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(noteById(screen, id).getAttribute("role")).toBe("group");
    expect(noteById(screen, id).getAttribute("aria-label")).toBe("Sticky note, yellow");
    // Selection is view state: the document did not change at all.
    expect(noteOf(doc, id)).toEqual(before);
  });

  it("TC-19 moving 2px (below DRAG_THRESHOLD_PX) selects without moving the note", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 40, y: 60 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    dragNote(screen, id, { x: 100, y: 100 }, { x: 100 + DRAG_THRESHOLD_PX - 1, y: 100 });

    expect(selectedIds(screen)).toEqual([id]);
    expect(noteById(screen, id).dataset.dragging).toBe("false");
    expect(noteOf(doc, id)).toEqual(before);
  });

  it("TC-19 moving exactly DRAG_THRESHOLD_PX starts a drag", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 40, y: 60 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    dragNote(screen, id, { x: 100, y: 100 }, { x: 100 + DRAG_THRESHOLD_PX, y: 100 });

    expect(noteOf(doc, id).x - before.x).toBeCloseTo(DRAG_THRESHOLD_PX, 6);
  });

  it("TC-20 a drag that starts on a note never moves the board camera", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    const cameraBefore = readCamera();

    dragNote(screen, id, { x: 100, y: 100 }, { x: 400, y: 350 });

    expect(readCamera()).toEqual(cameraBefore);
  });

  it("TC-21 pointercancel while dragging leaves the note Selected at the last applied position", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    const el = noteById(screen, id);
    pointer("pointerDown", el, 100, 100);
    pointer("pointerMove", el, 140, 100);
    pointer("pointerMove", el, 180, 130);
    expect(noteById(screen, id).dataset.dragging).toBe("true");

    pointer("pointerCancel", el, 180, 130);

    const note = noteOf(doc, id);
    expect(note.x - before.x).toBeCloseTo(80, 6);
    expect(note.y - before.y).toBeCloseTo(30, 6);
    expect(selectedIds(screen)).toEqual([id]);
    expect(noteById(screen, id).dataset.dragging).toBe("false");
  });

  it("TC-22 clicking empty board space clears the selection and the toolbar", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    const space = boardSpace(screen);
    pointer("pointerDown", space, 400, 400);
    pointer("pointerUp", space, 400, 400);

    expect(selectedIds(screen)).toEqual([]);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-25 Delete removes the selected note", () => {
    const doc = new Y.Doc();
    const other = newNote(doc, { x: 300, y: 0 }, "green");
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    pressKey("Delete");

    expect(readNotes(doc).map((note) => note.id)).toEqual([other]);
    expect(noteElements(screen)).toHaveLength(1);
  });

  it("TC-25 Backspace also removes the selected note", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    pressKey("Backspace");

    expect(readNotes(doc)).toEqual([]);
    expect(noteElements(screen)).toHaveLength(0);
  });

  it("TC-35 a double-click on a note edits it instead of creating another note", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "typed");
    const screen = render(<App doc={doc} />);

    fireEvent.doubleClick(noteById(screen, id));

    expect(readNotes(doc)).toHaveLength(1);
    const textarea = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    expect(textarea.value).toBe("typed");
    expect(document.activeElement).toBe(textarea);
  });

  it("TC-36 Enter with nothing selected creates and edits nothing", () => {
    const doc = new Y.Doc();
    const screen = render(<App doc={doc} />);

    pressKey("Enter");

    expect(readNotes(doc)).toEqual([]);
    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
  });

  it("TC-36 Delete with nothing selected deletes nothing", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    render(<App doc={doc} />);

    pressKey("Delete");

    expect(readNotes(doc).map((note) => note.id)).toEqual([id]);
  });

  it("TC-37 a note deleted through the model while dragging ends the interaction and is not recreated", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    const el = noteById(screen, id);
    pointer("pointerDown", el, 100, 100);
    pointer("pointerMove", el, 120, 100);
    expect(noteById(screen, id).dataset.dragging).toBe("true");

    let removed: boolean | undefined;
    changeModel(() => {
      removed = deleteObject(doc, id);
    });
    expect(removed).toBe(true);
    expect(readNotes(doc)).toEqual([]);
    expect(noteElements(screen)).toHaveLength(0);
    expect(selectedIds(screen)).toEqual([]);

    // Late pointer events on the vanished element must not resurrect it.
    expect(() => pointer("pointerMove", el, 160, 100)).not.toThrow();
    expect(() => pointer("pointerUp", el, 160, 100)).not.toThrow();
    expect(readNotes(doc)).toEqual([]);
  });

  it("TC-37 a note deleted through the model while editing ends the interaction", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "draft");
    const screen = render(<App doc={doc} />);

    fireEvent.doubleClick(noteById(screen, id));
    expect(screen.getByTestId("sticky-note-input")).toBeTruthy();

    changeModel(() => {
      deleteObject(doc, id);
    });
    expect(readNotes(doc)).toEqual([]);
    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
    expect(selectedIds(screen)).toEqual([]);
  });

  it("a drag moves at board scale: 100 screen px at zoom 1.25 is 80 board units", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    // Story 1 owns zooming: one press of its control is ZOOM_STEP_FACTOR.
    fireEvent.click(screen.getByTestId("zoom-in"));
    expect(readCamera().zoom).toBeCloseTo(1.25, 6);

    dragNote(screen, id, { x: 100, y: 100 }, { x: 200, y: 100 });

    expect(noteOf(doc, id).x - before.x).toBeCloseTo(100 / 1.25, 6);
  });

  it("a drag keeps the grabbed point under the pointer", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, id);

    // The pointer grabs the note 70 board units inside its top-left corner.
    dragNote(screen, id, { x: 70, y: 70 }, { x: 130, y: 120 });

    const note = noteOf(doc, id);
    expect(note.x - before.x).toBeCloseTo(60, 6);
    expect(note.y - before.y).toBeCloseTo(50, 6);
    expect(noteById(screen, id).dataset.dragging).toBe("false");
  });

  it("a dragged note is brought to front once and drawn above what it overlaps", () => {
    const doc = new Y.Doc();
    const a = newNote(doc, { x: 0, y: 0 });
    const b = newNote(doc, { x: 150, y: 0 });
    const c = newNote(doc, { x: 600, y: 0 });
    const screen = render(<App doc={doc} />);
    const before = noteOf(doc, a);

    expect(readNotes(doc).map((note) => note.id)).toEqual([a, b, c]);

    dragNote(screen, a, { x: 50, y: 50 }, { x: 190, y: 50 });

    const dragged = noteOf(doc, a);
    const other = noteOf(doc, b);
    expect(dragged.x - before.x).toBeCloseTo(140, 6);
    // The two boxes overlap.
    expect(dragged.x).toBeLessThan(other.x + STICKY_SIZE_WORLD);
    expect(other.x).toBeLessThan(dragged.x + STICKY_SIZE_WORLD);
    // z 1, 2, 3 became 2, 3, 4: the dragged note is drawn above the others.
    expect(readNotes(doc).map((note) => note.z)).toEqual([2, 3, 4]);
    // Stacking is a CSS z-index on a stable DOM order (ids ascending), so a
    // drag is never interrupted by the board re-parenting the note it drags.
    expect(Object.fromEntries(
      noteElements(screen).map((el) => [el.dataset.noteId, Number(el.style.zIndex)]),
    )).toEqual({ [a]: 4, [b]: 2, [c]: 3 });
    expect(noteElements(screen).map((el) => el.dataset.noteId)).toEqual([a, b, c].sort());
  });

  it("a note grabbed while it is topmost keeps its z (no pointless update)", () => {
    const doc = new Y.Doc();
    const a = newNote(doc, { x: 0, y: 0 });
    const b = newNote(doc, { x: 300, y: 0 });
    const screen = render(<App doc={doc} />);

    let updates = 0;
    doc.on("update", () => {
      updates += 1;
    });

    dragNote(screen, b, { x: 50, y: 50 }, { x: 90, y: 50 });

    // One transaction for the move; bringToFront was a no-op.
    expect(updates).toBe(1);
    expect(noteOf(doc, b).z).toBe(2);
    expect(noteOf(doc, a).z).toBe(1);
  });
});
