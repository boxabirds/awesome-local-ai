import { beforeEach, describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";
import * as Y from "yjs";
import {
  cameraNow,
  clickNote,
  createNoteAt,
  doubleClickNote,
  modelChange,
  mountBoard,
  noteElement,
  noteElements,
  notesOf,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  pressKey,
  setWindowSize,
  settle,
  viewportElement,
} from "./helpers";
import { STICKY_SIZE_WORLD } from "../../src/shared/config";
import { deleteObject, getStickyText } from "../../src/shared/board-model";

/**
 * TC-18 - TC-22, TC-25, TC-35 - TC-37: the note interaction states
 * (Unselected -> Pressed -> Selected / Dragging -> Editing) as the user
 * performs them. The document is inspected directly: what the user decided
 * must be in it, and nothing else.
 */

const VIEWPORT = { width: 1200, height: 800 };
const NOTE_CENTRE = { x: 0, y: 0 };
/** createSticky centres a note on the point it is given. */
const NOTE_ORIGIN = -STICKY_SIZE_WORLD / 2;

let doc: Y.Doc;

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
});

describe("press and release on a note (TC-18)", () => {
  it("selects the note without touching the document", () => {
    const id = createNoteAt(doc, NOTE_CENTRE.x, NOTE_CENTRE.y);
    mountBoard(doc);

    const note = noteElement(id);
    expect(note.dataset.selected).toBe("false");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();

    clickNote(id, { x: 100, y: 100 });

    expect(noteElement(id).dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    // Selection and editing are local state, never document content.
    const after = notesOf(doc)[0]!;
    expect(after).toMatchObject({ id, x: NOTE_ORIGIN, y: NOTE_ORIGIN, z: after.z });
    expect(notesOf(doc)).toHaveLength(1);
  });
});

describe("drag threshold (TC-19, TC-20)", () => {
  it("2 px of movement is not a drag: the note does not move", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    const before = cameraNow();

    const el = noteElement(id);
    pointerDown(el, 50, 50);
    pointerMove(el, 52, 50);
    pointerUp(el, 52, 50);

    expect(notesOf(doc)[0]).toMatchObject({ x: NOTE_ORIGIN, y: NOTE_ORIGIN });
    expect(cameraNow()).toEqual(before); // and the board did not pan
  });

  it("3 px of movement drags the note, one screen pixel per board unit at 100%", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    const before = cameraNow();

    const el = noteElement(id);
    pointerDown(el, 50, 50);
    pointerMove(el, 53, 50);
    // Dragging: the toolbar is hidden and the board has not panned.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    expect(cameraNow()).toEqual(before);

    await settle();
    expect(notesOf(doc)[0]).toMatchObject({ x: NOTE_ORIGIN + 3, y: NOTE_ORIGIN });
    expect(cameraNow()).toEqual(before);
  });

  it("drag distance divides by zoom, so the grabbed point stays under the pointer", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    await act(async () => {
      window.__vidi6!.setCamera({ ...cameraNow(), zoom: 0.5 });
    });
    await settle();
    const zoom = cameraNow().zoom;
    expect(zoom).toBeCloseTo(0.5, 5);

    const el = noteElement(id);
    pointerDown(el, 100, 100);
    pointerMove(el, 200, 150);
    await settle();

    const moved = notesOf(doc)[0]!;
    expect(moved.x - NOTE_ORIGIN).toBeCloseTo(100 / zoom, 6);
    expect(moved.y - NOTE_ORIGIN).toBeCloseTo(50 / zoom, 6);
  });

  it("writes at most one position per animation frame", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);

    const updates: number[] = [];
    const items = doc.getMap<Y.Map<unknown>>("objects").get(id)!;
    items.observe((event) => {
      if (event.keys.has("x")) updates.push(updates.length + 1);
    });

    const el = noteElement(id);
    pointerDown(el, 0, 0);
    for (let x = 3; x <= 60; x += 3) {
      pointerMove(el, x, 0);
    }
    await settle();
    pointerUp(el, 60, 0);

    // 20 pointer moves, one written position for the whole gesture.
    expect(updates.length).toBeLessThanOrEqual(2);
    expect(notesOf(doc)[0]!.x).toBeCloseTo(NOTE_ORIGIN + 60, 6);
  });
});

describe("interrupted drag (TC-21)", () => {
  it("pointercancel leaves the note at the last position it moved to", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);

    const el = noteElement(id);
    pointerDown(el, 0, 0);
    pointerMove(el, 30, 0);
    await settle();
    pointerMove(el, 55, 0);
    await settle();
    pointerCancel(el, 55, 0);

    expect(notesOf(doc)[0]!.x).toBeCloseTo(NOTE_ORIGIN + 55, 6);
    // The note is still there and still selected, not dropped mid-flight.
    expect(noteElement(id).dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });
});

describe("clicking empty board space (TC-22)", () => {
  it("clears the selection and the note toolbar", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 10, y: 10 });
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    const board = viewportElement();
    pointerDown(board, 400, 400);
    pointerUp(board, 400, 400);

    expect(noteElement(id).dataset.selected).toBe("false");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });
});

describe("panning the board (extra)", () => {
  it("leaves the selection and the note toolbar alone", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 10, y: 10 });

    const board = viewportElement();
    pointerDown(board, 400, 400);
    pointerMove(board, 430, 420);
    pointerMove(board, 460, 440);
    pointerUp(board, 460, 440);

    expect(noteElement(id).dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });
});

describe("deleting a note from the keyboard (TC-25)", () => {
  it.each(["Delete", "Backspace"])("%s deletes the selected note", (key) => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 5, y: 5 });

    pressKey(key);

    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("deleting a note does not touch the other notes", () => {
    const doomed = createNoteAt(doc, 0, 0);
    const kept = createNoteAt(doc, 500, 500, "green");
    mountBoard(doc);
    clickNote(doomed, { x: 5, y: 5 });

    pressKey("Delete");

    const remaining = notesOf(doc);
    expect(remaining.map((note) => note.id)).toEqual([kept]);
    expect(remaining[0]).toMatchObject({
      x: 500 - STICKY_SIZE_WORLD / 2,
      y: 500 - STICKY_SIZE_WORLD / 2,
      color: "green",
    });
  });
});

describe("double-click on an existing note (TC-35)", () => {
  it("starts editing that note and does not create another one", () => {
    const id = createNoteAt(doc, 0, 0);
    modelChange(() => getStickyText(doc, id)!.insert(0, "existing idea"));
    mountBoard(doc);

    doubleClickNote(id);

    expect(notesOf(doc)).toHaveLength(1);
    expect(notesOf(doc)[0]!.id).toBe(id);
    const editor = screen.getByTestId("sticky-textarea");
    expect((editor as HTMLTextAreaElement).value).toBe("existing idea");
    expect(noteElement(id).dataset.editing).toBe("true");
  });
});

describe("Enter while nothing is selected (TC-36)", () => {
  it("creates or edits nothing", () => {
    mountBoard(doc);

    pressKey("Enter");

    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-textarea")).toBeNull();
  });
});

describe("note deleted while dragging or editing (TC-37)", () => {
  it("a drag that loses its note ends without an error and without recreating it", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);

    const el = noteElement(id);
    pointerDown(el, 0, 0);
    pointerMove(el, 40, 0);
    await settle();

    modelChange(() => deleteObject(doc, id));
    pointerMove(el, 80, 0);
    await settle();
    pointerUp(el, 80, 0);

    expect(notesOf(doc)).toHaveLength(0);
    expect(noteElements()).toHaveLength(0);
  });

  it("an edit whose note is deleted ends and the text is not rewritten", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    doubleClickNote(id);
    expect(screen.getByTestId("sticky-textarea")).toBeTruthy();

    modelChange(() => deleteObject(doc, id));

    expect(screen.queryByTestId("sticky-textarea")).toBeNull();
    expect(notesOf(doc)).toHaveLength(0);
    expect(doc.getMap<Y.Map<unknown>>("objects").size).toBe(0);
  });
});

describe("notes are reachable and named", () => {
  it("renders each note with the accessible name 'Sticky note' and its text", () => {
    const id = createNoteAt(doc, 0, 0);
    modelChange(() => getStickyText(doc, id)!.insert(0, "Retro ideas"));
    mountBoard(doc);

    const notes = screen.getAllByRole("group", { name: "Sticky note" });
    expect(notes).toHaveLength(1);
    expect(within(notes[0]!).getByText("Retro ideas", { selector: ".sticky-text" })).toBeTruthy();
    expect(notes[0]!.getAttribute("tabindex")).toBe("0");
  });

  it("lays out a note as STICKY_SIZE_WORLD square board units", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    const style = noteElement(id).getAttribute("style") ?? "";

    expect(style).toContain(`width: ${STICKY_SIZE_WORLD}px`);
    expect(style).toContain(`height: ${STICKY_SIZE_WORLD}px`);
  });

  it("a focused note is selected, so Enter edits it and Delete removes it", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);

    act(() => noteElement(id).focus());

    expect(noteElement(id).dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    pressKey("Enter");
    expect(noteElement(id).dataset.editing).toBe("true");

    pressKey("Escape", screen.getByTestId("sticky-textarea"));
    pressKey("Delete");

    expect(notesOf(doc)).toHaveLength(0);
  });
});

