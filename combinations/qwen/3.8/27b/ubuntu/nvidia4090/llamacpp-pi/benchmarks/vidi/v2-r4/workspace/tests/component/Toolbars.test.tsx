/**
 * sticky.toolbar component tests (story 2): TC-27, TC-28, TC-29.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import { createSticky, snapshot } from "../../src/shared/board-model";
import {
  makeDoc,
  renderHarness,
  selectionOf,
} from "./stickyHarness";

/** Note centred on the world origin sits at screen (640, 400). */
const NOTE_CENTER = { x: 640, y: 400 };

function selectNote(note: Element): void {
  fireEvent.pointerDown(note, {
    pointerId: 1,
    button: 0,
    clientX: NOTE_CENTER.x,
    clientY: NOTE_CENTER.y,
  });
  fireEvent.pointerUp(note, { pointerId: 1 });
}

afterEach(() => {
  cleanup();
});

describe("sticky.toolbar", () => {
  it("TC-27: the Pink swatch changes the model colour and keeps the selection", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    selectNote(note);
    const pink = screen.getByRole("button", { name: "Pink colour" });
    expect(pink).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(pink);

    expect(snapshot(doc)[0].color).toBe("pink");
    expect(note).toHaveAttribute("data-selected", "true");
    expect(selectionOf().selectedId).toBe(id);
    expect(pink).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Yellow colour" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("TC-28: the Sticky note button creates one note centred on the viewport centre, in Editing mode", async () => {
    const doc = makeDoc();
    renderHarness(doc);

    await userEvent.click(screen.getByRole("button", { name: "Sticky note" }));

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    // Viewport centre at the default camera is world (0,0): the note is
    // centred there, in the default colour.
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe("");
    expect(selectionOf()).toEqual({ selectedId: note.id, editingId: note.id });
    expect(screen.getByTestId("sticky-note-textarea")).toHaveFocus();
  });

  it("TC-29: the bin button removes the note and clears the selection", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    selectNote(note);
    expect(screen.getByRole("button", { name: "Delete note" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Sticky note" })).toBeNull();
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
  });
});
