/**
 * sticky.text component tests (story 2): TC-23, TC-24, TC-26, TC-38.
 *
 * Real timers + @testing-library/user-event (user-event is incompatible
 * with fake timers). The editor mirrors into a real Y.Text, so the
 * assertions read the model directly.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createSticky, getStickyText } from "../../src/shared/board-model";
import {
  makeDoc,
  renderHarness,
  selectionOf,
} from "./stickyHarness";

/** Note centred on the world origin sits at screen (640, 400). */
const NOTE_CENTER = { x: 640, y: 400 };

/** Select a note with a plain press+release. */
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

describe("sticky.text", () => {
  it("TC-23: Enter on a selected note starts editing: textarea focused with the caret at the end", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, "hello");
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    selectNote(note);
    expect(selectionOf()).toEqual({ selectedId: id, editingId: null });

    fireEvent.keyDown(window, { key: "Enter" });

    const ta = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;
    expect(ta).toHaveFocus();
    expect(ta.value).toBe("hello");
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
    expect(selectionOf()).toEqual({ selectedId: id, editingId: id });
  });

  it("TC-24: Escape ends editing with the note still selected and the typed text preserved", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    selectNote(note);
    fireEvent.keyDown(window, { key: "Enter" });
    const ta = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;

    await userEvent.type(ta, "hi");

    fireEvent.keyDown(ta, { key: "Escape" });

    expect(screen.queryByTestId("sticky-note-textarea")).toBeNull();
    expect(note).toHaveAttribute("data-selected", "true");
    expect(selectionOf()).toEqual({ selectedId: id, editingId: null });
    expect(getStickyText(doc, id)!.toString()).toBe("hi");
  });

  it("TC-26: Backspace while editing deletes a character, never the note (negative)", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, "ab");
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    selectNote(note);
    fireEvent.keyDown(window, { key: "Enter" });
    const ta = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;
    expect(ta.value).toBe("ab");
    expect(ta.selectionStart).toBe(2); // caret at the end

    await userEvent.keyboard("{Backspace}");

    expect(ta.value).toBe("a");
    expect(getStickyText(doc, id)!.toString()).toBe("a");
    // The note is still there, still being edited.
    expect(screen.getByRole("group", { name: "Sticky note" })).toBeInTheDocument();
    expect(selectionOf().editingId).toBe(id);
  });

  it("TC-38: typing then clicking outside unmounts the editor with the text in Y.Text and the selection cleared", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    fireEvent.dblClick(note, {});
    const ta = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;

    await userEvent.type(ta, "abc");

    const root = screen.getByTestId("board-viewport");
    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });

    expect(screen.queryByTestId("sticky-note-textarea")).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe("abc");
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
  });
});
