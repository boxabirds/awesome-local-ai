import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  snapshot,
} from "../../src/shared/board-model";
import {
  DEFAULT_STICKY_COLOR,
  DRAG_THRESHOLD_PX,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import { SHORT_NOTE_TEXT } from "../fixtures/texts";

/**
 * ui-component tests for sticky.interaction (TC-18 to TC-22, TC-25, TC-35 to TC-37).
 *
 * A real `Y.Doc` is handed to `App`, so every assertion about "what happened"
 * is an assertion about the document the board actually writes.
 */

const VIEWPORT = { width: 1200, height: 800 };
const HALF = STICKY_SIZE_WORLD / 2;

let doc: Y.Doc;

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

/** Let rAF-throttled writes and React re-renders land. */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function addNote(x: number, y: number, color?: string): string {
  let id = "";
  act(() => {
    id = createSticky(doc, { x, y }, color as never);
  });
  return id;
}

function noteEl(id?: string): HTMLElement {
  const all = screen.getAllByTestId("sticky-note");
  if (!id) {
    if (all.length !== 1) throw new Error(`expected exactly one note, found ${all.length}`);
    return all[0];
  }
  const el = all.find((element) => element.getAttribute("data-note-id") === id);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

/** The note's world position straight from the document. */
function notePosition(id: string): { x: number; y: number; z: number } {
  const note = snapshot(doc).find((candidate) => candidate.id === id);
  if (!note) throw new Error(`note ${id} is not in the document`);
  return { x: note.x, y: note.y, z: note.z };
}

function camera() {
  const hook = window.__vidi6;
  if (!hook) throw new Error("window.__vidi6 test hook is not installed");
  return hook.getCamera();
}

function textareaValue(): string {
  const el = screen.getByRole("textbox", { name: "Sticky note text" });
  return (el as HTMLTextAreaElement).value;
}

/** jsdom reports inline colours as rgb(), so compare in that form. */
function rgb(hex: string): string {
  const value = hex.replace("#", "");
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  el: HTMLElement,
  x: number,
  y: number,
  options: { pointerId?: number } = {},
) {
  const pointerId = options.pointerId ?? 1;
  const init = {
    pointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: x,
    clientY: y,
  };
  // fireEvent wraps the dispatch in act(), so React's state lands before the
  // next assertion.
  if (type === "pointerdown") fireEvent.pointerDown(el, init);
  else if (type === "pointermove") fireEvent.pointerMove(el, init);
  else if (type === "pointerup") fireEvent.pointerUp(el, init);
  else fireEvent.pointerCancel(el, init);
}

/** Press and release without moving: a click that selects. */
function clickNote(id: string) {
  const el = noteEl(id);
  const centre = { x: 300, y: 300 };
  pointer("pointerdown", el, centre.x, centre.y);
  pointer("pointerup", el, centre.x, centre.y);
}

/** Drag a note by (dx, dy) screen pixels. */
async function dragNote(id: string, dx: number, dy: number, steps = 3) {
  const el = noteEl(id);
  const start = { x: 300, y: 300 };
  pointer("pointerdown", el, start.x, start.y);
  for (let i = 1; i <= steps; i += 1) {
    pointer("pointermove", el, start.x + (dx * i) / steps, start.y + (dy * i) / steps);
    await settle();
  }
}

async function finishDrag(id: string, type: "pointerup" | "pointercancel" = "pointerup") {
  const el = noteEl(id);
  pointer(type, el, 400, 350);
  await settle();
}

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
  render(<App doc={doc} />);
});

describe("selecting a sticky note", () => {
  it("TC-18: press and release without moving selects the note and shows the toolbar", () => {
    const id = addNote(0, 0);
    clickNote(id);

    const el = noteEl(id);
    expect(el.getAttribute("data-selected")).toBe("true");
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("aria-label")).toBe("Sticky note");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.background).toBe(rgb(STICKY_COLORS[DEFAULT_STICKY_COLOR]));
    expect(screen.getByRole("toolbar", { name: "Sticky note tools" })).toBeTruthy();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    // Nothing about the selection was written to the document.
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].color).toBe(DEFAULT_STICKY_COLOR);
  });

  it("TC-22: clicking empty board space clears the selection and the toolbar", () => {
    const id = addNote(0, 0);
    clickNote(id);
    expect(screen.queryByTestId("note-toolbar")).not.toBeNull();

    const viewport = screen.getByTestId("board-viewport");
    pointer("pointerdown", viewport, 700, 600);
    pointer("pointerup", viewport, 700, 600);

    expect(noteEl(id).getAttribute("data-selected")).toBe("false");
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("a drag on empty board space pans and does not count as a clearing click", () => {
    const id = addNote(0, 0);
    clickNote(id);

    const viewport = screen.getByTestId("board-viewport");
    const before = camera();
    pointer("pointerdown", viewport, 700, 600);
    pointer("pointermove", viewport, 760, 600);
    pointer("pointerup", viewport, 760, 600);
    // The camera update is rAF-coalesced; the selection only survives a pan if
    // the board never clears it mid-drag.
    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
    expect(camera().x).not.toBe(before.x);
  });

  it("clicking one note while another is selected moves the selection", () => {
    const first = addNote(0, 0);
    const second = addNote(500, 0);
    clickNote(first);
    clickNote(second);

    expect(noteEl(first).getAttribute("data-selected")).toBe("false");
    expect(noteEl(second).getAttribute("data-selected")).toBe("true");
    expect(screen.getAllByTestId("note-toolbar")).toHaveLength(1);
  });
});

describe("moving a sticky note", () => {
  it("TC-19: 2 px of movement is below DRAG_THRESHOLD_PX and moves nothing", () => {
    expect(DRAG_THRESHOLD_PX).toBe(3);
    const id = addNote(0, 0);
    const before = notePosition(id);

    const el = noteEl(id);
    pointer("pointerdown", el, 300, 300);
    pointer("pointermove", el, 302, 300);
    pointer("pointerup", el, 302, 300);

    expect(el.getAttribute("data-dragging")).toBe("false");
    expect(el.getAttribute("data-selected")).toBe("true");
    expect(notePosition(id)).toEqual(before);
  });

  it("TC-20: movement at the threshold drags, and the board camera never moves", async () => {
    const id = addNote(0, 0);
    const beforeCamera = camera();
    const beforePosition = notePosition(id);

    const el = noteEl(id);
    pointer("pointerdown", el, 300, 300);
    pointer("pointermove", el, 300 + DRAG_THRESHOLD_PX, 300);
    await settle();

    expect(el.getAttribute("data-dragging")).toBe("true");
    // The floating toolbar is hidden while dragging.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    expect(notePosition(id).x).toBeCloseTo(beforePosition.x + DRAG_THRESHOLD_PX, 6);

    await finishDrag(id);
    expect(el.getAttribute("data-dragging")).toBe("false");
    expect(el.getAttribute("data-selected")).toBe("true");

    // sticky.no_pan: dragging a note must not pan the board.
    const afterCamera = camera();
    expect(afterCamera.x).toBe(beforeCamera.x);
    expect(afterCamera.y).toBe(beforeCamera.y);
    expect(afterCamera.zoom).toBe(beforeCamera.zoom);
  });

  it("sticky.move: the note follows the pointer and comes to the front", async () => {
    const bottom = addNote(0, 0);
    const top = addNote(10, 10);
    expect(notePosition(top).z).toBeGreaterThan(notePosition(bottom).z);

    await dragNote(bottom, 120, 60);
    expect(notePosition(bottom).z).toBeGreaterThan(notePosition(top).z);
    await finishDrag(bottom);

    const moved = notePosition(bottom);
    expect(moved.x).toBeCloseTo(-HALF + 120, 6);
    expect(moved.y).toBeCloseTo(-HALF + 60, 6);
  });

  it("TC-21: a cancelled drag keeps the position it was last shown at", async () => {
    const id = addNote(0, 0);
    await dragNote(id, 40, 20);
    const lastShown = notePosition(id);

    await finishDrag(id, "pointercancel");

    const after = notePosition(id);
    expect(after.x).toBeCloseTo(lastShown.x, 6);
    expect(after.y).toBeCloseTo(lastShown.y, 6);
    expect(noteEl(id).getAttribute("data-dragging")).toBe("false");
    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
  });

  it("dragging at 50% zoom divides the pointer delta by the zoom", async () => {
    const id = addNote(0, 0);
    act(() => {
      window.__vidi6?.setCamera({ x: -600, y: -400, zoom: 0.5 });
    });
    await settle();
    const before = notePosition(id);

    await dragNote(id, 100, 50);
    await finishDrag(id);

    const after = notePosition(id);
    expect(after.x).toBeCloseTo(before.x + 200, 6);
    expect(after.y).toBeCloseTo(before.y + 100, 6);
  });
});

describe("deleting a sticky note", () => {
  it.each(["Delete", "Backspace"])("TC-25: %s on a selected note removes it", (key) => {
    const id = addNote(0, 0);
    addNote(400, 0);
    clickNote(id);

    fireEvent.keyDown(document.body, { key, code: key === "Delete" ? "Delete" : "Backspace" });

    expect(snapshot(doc).map((note) => note.id)).not.toContain(id);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(1);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-36: Enter with nothing selected does nothing", () => {
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Delete with nothing selected does nothing", () => {
    const id = addNote(0, 0);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].id).toBe(id);
  });
});

describe("double-click and editing entry points", () => {
  it("sticky.edit_start: double-clicking a note edits it and creates no new note", async () => {
    const id = addNote(0, 0);
    act(() => {
      getStickyText(doc, id)?.insert(0, SHORT_NOTE_TEXT);
    });

    fireEvent.doubleClick(noteEl(id));
    await settle();

    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId("sticky-textarea")).toBeTruthy();
    expect(textareaValue()).toBe(SHORT_NOTE_TEXT);
    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
    // The floating toolbar is hidden while editing.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("Escape ends editing and keeps the note selected", async () => {
    const id = addNote(0, 0);
    fireEvent.doubleClick(noteEl(id));
    await settle();

    const textarea = screen.getByRole("textbox", { name: "Sticky note text" });
    fireEvent.change(textarea, { target: { value: SHORT_NOTE_TEXT } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    await settle();

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(snapshot(doc)[0].text).toBe(SHORT_NOTE_TEXT);
    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
  });
});

describe("TC-37: a note that disappears mid-interaction", () => {
  it("ends a drag silently and is not recreated", async () => {
    const id = addNote(0, 0);
    const el = noteEl(id);
    pointer("pointerdown", el, 300, 300);
    pointer("pointermove", el, 300 + DRAG_THRESHOLD_PX, 300);
    await settle();
    expect(el.getAttribute("data-dragging")).toBe("true");

    act(() => {
      deleteObject(doc, id);
    });
    await settle();

    // Further pointer events must not throw and must not bring the note back.
    pointer("pointermove", el, 380, 340);
    pointer("pointerup", el, 380, 340);
    await settle();

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(0);
  });

  it("ends editing silently and is not recreated", async () => {
    const id = addNote(0, 0);
    fireEvent.doubleClick(noteEl(id));
    await settle();
    const textarea = screen.getByRole("textbox", { name: "Sticky note text" });
    fireEvent.change(textarea, { target: { value: "half finished" } });

    act(() => {
      deleteObject(doc, id);
    });
    await settle();

    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(snapshot(doc)).toHaveLength(0);
  });
});

describe("model helpers used by the board", () => {
  it("bringToFront on a note that is already topmost changes nothing", () => {
    const first = addNote(0, 0);
    const second = addNote(10, 0);
    expect(snapshot(doc).map((note) => note.id)).toEqual([first, second]);

    act(() => {
      bringToFront(doc, second);
    });
    expect(notePosition(second).z).toBe(2);
  });
});
