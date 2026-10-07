import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/client/App";
import { createSticky, type StickySnapshot } from "../../src/shared/board-model";
import { screenToWorld } from "../../src/client/canvas/camera";
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from "../../src/shared/config";
import { STICKY_BUTTON_LABEL, STICKY_BUTTON_TOOLTIP } from "../../src/client/board/Toolbar";
import { STICKY_COLOR_NAMES, STICKY_COLOR_ORDER } from "../../src/client/objects/NoteToolbar";

/**
 * ui-component tests for the toolbars (sticky.toolbar): TC-27 to TC-29.
 */

const VIEWPORT = { width: 1200, height: 800 };

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

function boardApi() {
  const api = window.__vidi6Board;
  if (!api) throw new Error("window.__vidi6Board test hook is not installed");
  return api;
}

function notes(): readonly StickySnapshot[] {
  return boardApi().snapshot();
}

function note(): StickySnapshot {
  const list = notes();
  if (list.length === 0) throw new Error("expected a note on the board");
  return list[0]!;
}

function noteEl(): HTMLElement {
  return screen.getByTestId("sticky-note");
}

function toolbar(): HTMLElement {
  return screen.getByTestId("note-toolbar");
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function addNote(x = 0, y = 0): string {
  const api = boardApi();
  const created: string[] = [];
  act(() => {
    const id = createSticky(api.doc, { x, y });
    if (id !== null) created.push(id);
  });
  if (created.length === 0) throw new Error("createSticky was rejected");
  return created[0]!;
}

function pointer(type: string, el: HTMLElement, x: number, y: number) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

async function selectNote() {
  const el = noteEl();
  pointer("pointerdown", el, 150, 150);
  pointer("pointerup", el, 150, 150);
  await settle();
}

function swatch(color: StickyColor): HTMLButtonElement {
  return within(toolbar()).getByRole("button", {
    name: `${STICKY_COLOR_NAMES[color]} colour`,
  }) as HTMLButtonElement;
}

/** jsdom normalizes colours, so expectations are normalized the same way. */
function cssColor(value: string): string {
  const el = document.createElement("div");
  el.style.background = value;
  return el.style.background;
}

describe("note toolbar and left toolbar", () => {
  beforeEach(() => {
    setWindowSize(VIEWPORT.width, VIEWPORT.height);
    render(<App />);
  });

  it("TC-27: clicking the Pink swatch recolours the note and keeps it selected", async () => {
    const id = addNote(0, 0);
    const before = note();
    const cameraBefore = window.__vidi6!.getCamera();

    await selectNote();
    fireEvent.click(swatch("pink"));
    await settle();

    const after = notes().find((item) => item.id === id)!;
    expect(after.color).toBe("pink");
    // Only the colour changed.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);

    expect(noteEl().dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(swatch("pink").getAttribute("aria-pressed")).toBe("true");
    expect(swatch("yellow").getAttribute("aria-pressed")).toBe("false");
    // A toolbar click never pans the board.
    expect(window.__vidi6!.getCamera()).toEqual(cameraBefore);
  });

  it("the note toolbar offers exactly the six product colours, named", async () => {
    addNote(0, 0);
    await selectNote();

    expect(STICKY_COLOR_ORDER).toEqual(["yellow", "orange", "green", "blue", "pink", "violet"]);
    for (const [color, name] of Object.entries(STICKY_COLOR_NAMES)) {
      const button = swatch(color as StickyColor);
      expect(button.getAttribute("aria-label")).toBe(`${name} colour`);
      expect(button.getAttribute("title")).toBe(`${name} colour`);
      expect(button.style.background).toBe(cssColor(STICKY_COLORS[color as StickyColor]));
    }
    expect(within(toolbar()).getAllByRole("button")).toHaveLength(7); // 6 swatches + delete
  });

  it("TC-29: the bin button deletes the note and clears the selection", async () => {
    addNote(0, 0);
    await selectNote();

    fireEvent.click(within(toolbar()).getByRole("button", { name: "Delete note" }));
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-note")).toBeNull();
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-28: the Sticky note button creates a note at the centre of the view and edits it", async () => {
    const camera = window.__vidi6!.getCamera();
    const centre = screenToWorld(camera, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });

    fireEvent.click(screen.getByTestId("sticky-note-button"));
    await settle();

    expect(notes()).toHaveLength(1);
    const created = note();
    expect(created.color).toBe("yellow");
    expect(created.text).toBe("");
    expect(created.z).toBe(1);
    // Centred on the middle of the visible board.
    expect(created.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(created.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);

    // Selected and being edited straight away.
    expect(noteEl().dataset.selected).toBe("true");
    expect(screen.getByTestId("sticky-text-editor")).toBeTruthy();

    // Typing goes straight into the new note.
    fireEvent.input(screen.getByTestId("sticky-text-editor"), { target: { value: "Hello" } });
    await settle();
    expect(note().text).toBe("Hello");
  });

  it("TC-28: the button is named and always available", () => {
    const button = screen.getByTestId("sticky-note-button");
    expect(button.getAttribute("aria-label")).toBe(STICKY_BUTTON_LABEL);
    expect(button.getAttribute("title")).toBe(STICKY_BUTTON_TOOLTIP);
    expect(button.closest("[data-testid='board-toolbar']")).toBeTruthy();
  });

  it("the left toolbar creates a note even when the view is panned far away", async () => {
    window.__vidi6!.setCamera({ x: -250_000, y: 180_000, zoom: 1 });
    await settle();
    const camera = window.__vidi6!.getCamera();
    const centre = screenToWorld(camera, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });

    fireEvent.click(screen.getByTestId("sticky-note-button"));
    await settle();

    expect(notes()).toHaveLength(1);
    expect(note().x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note().y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
  });

  it("a new note is created on top of the notes already on the board", async () => {
    addNote(0, 0);
    addNote(400, 0);
    fireEvent.click(screen.getByTestId("sticky-note-button"));
    await settle();

    expect(notes().map((item) => item.z)).toEqual([1, 2, 3]);
  });

  it("the note toolbar is hidden while the note is being edited or dragged", async () => {
    const id = addNote(0, 0);
    await selectNote();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    fireEvent.doubleClick(noteEl());
    await settle();
    expect(screen.queryByTestId("note-toolbar")).toBeNull();

    // End editing, then start a drag.
    fireEvent.keyDown(screen.getByTestId("sticky-text-editor"), { key: "Escape", code: "Escape" });
    await settle();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    const el = screen.getAllByTestId("sticky-note").find((node) => node.dataset.noteId === id)!;
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 200, 200);
    await settle();
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    pointer("pointerup", el, 200, 200);
    await settle();
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });

  it("clicking a swatch does not select another note or create one", async () => {
    addNote(0, 0);
    await selectNote();
    fireEvent.click(swatch("blue"));
    await settle();

    expect(notes()).toHaveLength(1);
    expect(note().color).toBe("blue");
    expect(screen.queryByTestId("sticky-text-editor")).toBeNull();
  });
});
