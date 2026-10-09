/**
 * sticky.interaction component tests (story 2): TC-18 to TC-22, TC-25,
 * TC-35, TC-36, TC-37.
 *
 * Fake timers so rAF-throttled moveObject writes flush deterministically
 * (advanceFrame advances one 16 ms frame). Pointer events are dispatched
 * directly on the note element (jsdom has no hit testing or pointer
 * capture).
 */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from "../../src/shared/config";
import {
  createSticky,
  deleteObject,
  getStickyText,
  snapshot,
} from "../../src/shared/board-model";
import {
  cameraOf,
  makeDoc,
  notesOf,
  renderHarness,
  selectionOf,
} from "./stickyHarness";
import { advanceFrame, TEST_VIEWPORT } from "./testBoard";

const INITIAL = { x: -TEST_VIEWPORT.width / 2, y: -TEST_VIEWPORT.height / 2, zoom: 1 };

/** A note centred on the world origin sits at screen (640, 400). */
const NOTE_CENTER = { x: 640, y: 400 };

/** Press (pointerdown) on the note at the given point. */
function press(note: Element, x: number, y: number, pointerId = 1): void {
  fireEvent.pointerDown(note, { pointerId, button: 0, clientX: x, clientY: y });
}

/** A plain press+release without movement (a select click). */
function click(note: Element, x: number, y: number): void {
  press(note, x, y);
  fireEvent.pointerUp(note, { pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("sticky.interaction", () => {
  it("TC-18: press+release without move selects the note; outline and NoteToolbar shown", async () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    click(note, NOTE_CENTER.x, NOTE_CENTER.y);

    expect(note).toHaveAttribute("data-selected", "true");
    // The NoteToolbar is portaled to document.body in screen space.
    expect(screen.getByRole("button", { name: "Delete note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yellow colour" })).toBeInTheDocument();
    // No movement: position is unchanged.
    const [s] = notesOf(doc);
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(-STICKY_SIZE_WORLD / 2);
    await advanceFrame();
    expect(cameraOf()).toEqual(INITIAL);
  });

  it("TC-19: a move under the drag threshold (2px) stays a select and never writes a position (boundary)", async () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    press(note, NOTE_CENTER.x, NOTE_CENTER.y);
    fireEvent.pointerMove(note, {
      pointerId: 1,
      clientX: NOTE_CENTER.x + DRAG_THRESHOLD_PX - 1,
      clientY: NOTE_CENTER.y,
    });
    fireEvent.pointerUp(note, { pointerId: 1 });
    await advanceFrame(); // nothing may be queued

    const [s] = notesOf(doc);
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(s.y).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note).toHaveAttribute("data-selected", "true");
  });

  it("TC-20: a move of exactly the threshold (3px) drags the note; the board camera never changes (no pan)", async () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    press(note, NOTE_CENTER.x, NOTE_CENTER.y);
    fireEvent.pointerMove(note, {
      pointerId: 1,
      clientX: NOTE_CENTER.x + DRAG_THRESHOLD_PX,
      clientY: NOTE_CENTER.y,
    });
    await advanceFrame();
    expect(cameraOf()).toEqual(INITIAL); // drag does not pan

    fireEvent.pointerMove(note, { pointerId: 1, clientX: 660, clientY: 430 });
    await advanceFrame();
    fireEvent.pointerUp(note, { pointerId: 1 });

    expect(cameraOf()).toEqual(INITIAL); // still no pan
    const [s] = notesOf(doc);
    // 20px right, 30px down at zoom 1.
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2 + 20);
    expect(s.y).toBe(-STICKY_SIZE_WORLD / 2 + 30);
    expect(note).toHaveAttribute("data-selected", "true");
  });

  it("TC-21: pointercancel during a drag selects the note at the last applied position", async () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    press(note, NOTE_CENTER.x, NOTE_CENTER.y);
    fireEvent.pointerMove(note, { pointerId: 1, clientX: NOTE_CENTER.x + 10, clientY: NOTE_CENTER.y });
    await advanceFrame(); // applied: +10

    fireEvent.pointerMove(note, { pointerId: 1, clientX: NOTE_CENTER.x + 30, clientY: NOTE_CENTER.y });
    // The frame for +30 is queued but not run yet.
    fireEvent.pointerCancel(note, { pointerId: 1 });

    const [s] = notesOf(doc);
    expect(s.x).toBe(-STICKY_SIZE_WORLD / 2 + 10); // last applied, not +30
    expect(note).toHaveAttribute("data-selected", "true");
    await advanceFrame(); // the cancelled frame must not fire
    expect(notesOf(doc)[0].x).toBe(-STICKY_SIZE_WORLD / 2 + 10);
  });

  it("TC-22: clicking empty board space deselects and hides the toolbar", async () => {
    const doc = makeDoc();
    createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    click(note, NOTE_CENTER.x, NOTE_CENTER.y);
    expect(screen.getByRole("button", { name: "Delete note" })).toBeInTheDocument();

    const root = screen.getByTestId("board-viewport");
    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    // Same point on release: a click, not a pan (jsdom has zero-sized rects).
    fireEvent.pointerUp(root, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(note).toHaveAttribute("data-selected", "false");
    expect(screen.queryByRole("button", { name: "Delete note" })).toBeNull();
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
  });

  it("TC-25a: Delete on a selected note removes it", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    click(note, NOTE_CENTER.x, NOTE_CENTER.y);
    expect(selectionOf().selectedId).toBe(id);

    fireEvent.keyDown(window, { key: "Delete" });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Sticky note" })).toBeNull();
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
  });

  it("TC-25b: Backspace on a selected note removes it (separate run)", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    click(note, NOTE_CENTER.x, NOTE_CENTER.y);

    fireEvent.keyDown(window, { key: "Backspace" });

    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionOf().selectedId).toBeNull();
  });

  it("TC-35: dblclick on an existing note edits that note and creates no new one (negative)", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    fireEvent.dblClick(note, {});

    expect(snapshot(doc)).toHaveLength(1);
    expect(selectionOf()).toEqual({ selectedId: id, editingId: id });
    expect(screen.getByTestId("sticky-note-textarea")).toHaveFocus();
  });

  it("TC-36: Enter with nothing selected does nothing (negative)", async () => {
    const doc = makeDoc();
    renderHarness(doc);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
    expect(screen.queryByTestId("sticky-note-textarea")).toBeNull();
  });

  it("TC-37a: a note deleted via the model while Dragging ends the interaction silently and is not recreated", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    press(note, NOTE_CENTER.x, NOTE_CENTER.y);
    fireEvent.pointerMove(note, { pointerId: 1, clientX: NOTE_CENTER.x + 20, clientY: NOTE_CENTER.y });
    await advanceFrame(); // actively dragging

    await act(async () => {
      deleteObject(doc, id); // e.g. a remote client deleted it
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Sticky note" })).toBeNull();
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
    // No queued move may resurrect the note.
    await advanceFrame();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it("TC-37b: a note deleted via the model while Editing unmounts the editor without throwing and is not recreated", async () => {
    const doc = makeDoc();
    const id = createSticky(doc, { x: 0, y: 0 });
    getStickyText(doc, id)!.insert(0, "abc");
    renderHarness(doc);

    const note = screen.getByRole("group", { name: "Sticky note" });
    fireEvent.dblClick(note, {});
    expect(screen.getByTestId("sticky-note-textarea")).toHaveValue("abc");

    await act(async () => {
      deleteObject(doc, id);
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId("sticky-note-textarea")).toBeNull();
    expect(selectionOf()).toEqual({ selectedId: null, editingId: null });
    await advanceFrame();
    expect(snapshot(doc)).toHaveLength(0);
  });
});
