import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { screenToWorld } from "../../src/client/canvas/camera";
import { STICKY_BUTTON_LABEL, STICKY_BUTTON_TOOLTIP } from "../../src/client/board/Toolbar";
import { createSticky, snapshot } from "../../src/shared/board-model";
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from "../../src/shared/config";
import { STICKY_COLOR_ORDER, stickyColorLabel } from "../../src/client/objects/NoteToolbar";
import type { StickyColor } from "../../src/shared/config";

/**
 * ui-component tests for sticky.toolbar and sticky.recolour (TC-27 to TC-29)
 * plus the create affordances (left toolbar button, double-click on empty space).
 */

const VIEWPORT = { width: 1200, height: 800 };
const HALF = STICKY_SIZE_WORLD / 2;

let doc: Y.Doc;

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function addNote(x: number, y: number): string {
  let id = "";
  act(() => {
    id = createSticky(doc, { x, y });
  });
  return id;
}

function noteEl(id: string): HTMLElement {
  const el = screen
    .getAllByTestId("sticky-note")
    .find((candidate) => candidate.getAttribute("data-note-id") === id);
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

function notes() {
  return snapshot(doc);
}

function camera() {
  const hook = window.__vidi6;
  if (!hook) throw new Error("window.__vidi6 test hook is not installed");
  return hook.getCamera();
}

function selectNote(id: string) {
  fireEvent.pointerDown(noteEl(id), {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: 300,
    clientY: 300,
  });
  fireEvent.pointerUp(noteEl(id), {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    clientX: 300,
    clientY: 300,
  });
}

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
  render(<App doc={doc} />);
});

describe("the left toolbar", () => {
  it("offers a Sticky note button with the PRD tooltip", () => {
    const button = screen.getByRole("button", { name: STICKY_BUTTON_LABEL });
    expect(button.getAttribute("title")).toBe(STICKY_BUTTON_TOOLTIP);
    expect(STICKY_BUTTON_TOOLTIP).toBe("Sticky note – or double-click the board");
  });

  it("TC-28: clicking the Sticky note button creates one note centred on the visible area and edits it", async () => {
    fireEvent.click(screen.getByRole("button", { name: STICKY_BUTTON_LABEL }));
    await settle();

    const created = notes();
    expect(created).toHaveLength(1);
    // The centre of a freshly reset 1200x800 board is world (0, 0).
    expect(created[0].x).toBeCloseTo(-HALF, 6);
    expect(created[0].y).toBeCloseTo(-HALF, 6);
    expect(created[0].color).toBe(DEFAULT_STICKY_COLOR);

    // The new note is in Editing state with an empty focused textarea.
    const textarea = screen.getByRole("textbox", { name: "Sticky note text" });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(document.activeElement).toBe(textarea);
    expect(noteEl(created[0].id).getAttribute("data-selected")).toBe("true");
  });

  it("TC-31 (component side): double-clicking empty board space creates a note at that point", async () => {
    const viewport = screen.getByTestId("board-viewport");
    fireEvent.doubleClick(viewport, { clientX: 850, clientY: 600 });
    await settle();

    const world = screenToWorld(camera(), { x: 850, y: 600 });
    const created = notes();
    expect(created).toHaveLength(1);
    expect(created[0].x).toBeCloseTo(world.x - HALF, 6);
    expect(created[0].y).toBeCloseTo(world.y - HALF, 6);
    expect(screen.getByRole("textbox", { name: "Sticky note text" })).toBeTruthy();
  });

  it("double-clicking the board after panning puts the note where it was clicked", async () => {
    const viewport = screen.getByTestId("board-viewport");
    fireEvent.pointerDown(viewport, {
      pointerId: 3,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 500,
      clientY: 500,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 3,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 400,
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 3,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
      clientX: 300,
      clientY: 400,
    });
    await settle();

    fireEvent.doubleClick(viewport, { clientX: 700, clientY: 300 });
    await settle();

    const world = screenToWorld(camera(), { x: 700, y: 300 });
    expect(notes()[0].x).toBeCloseTo(world.x - HALF, 6);
    expect(notes()[0].y).toBeCloseTo(world.y - HALF, 6);
  });
});

describe("the floating note toolbar", () => {
  it("TC-27: shows six named colour swatches and recolours without losing the selection", async () => {
    const id = addNote(0, 0);
    selectNote(id);

    const swatches = screen.getAllByRole("button", { name: / colour$/ });
    expect(swatches).toHaveLength(6);
    expect(STICKY_COLOR_ORDER).toEqual([
      "yellow",
      "orange",
      "green",
      "blue",
      "pink",
      "violet",
    ] as StickyColor[]);
    for (const color of STICKY_COLOR_ORDER) {
      const label = `${stickyColorLabel(color)} colour`;
      const swatch = screen.getByRole("button", { name: label });
      expect(swatch.getAttribute("title")).toBe(label);
      expect(swatch.getAttribute("aria-pressed")).toBe(color === DEFAULT_STICKY_COLOR ? "true" : "false");
    }

    fireEvent.click(screen.getByRole("button", { name: "Pink colour" }));
    await settle();

    expect(notes()[0].color).toBe("pink");
    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
    expect(noteEl(id).style.background).toBe(rgb(STICKY_COLORS.pink));
    // The toolbar is still there, with pink now marked as the current colour.
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pink colour" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("recolouring a note does not move it or reorder the document", async () => {
    const first = addNote(0, 0);
    const second = addNote(400, 0);
    selectNote(first);

    fireEvent.click(screen.getByRole("button", { name: "Blue colour" }));
    await settle();

    const [a, b] = notes();
    expect(a.id).toBe(first);
    expect(a.color).toBe("blue");
    expect(a.x).toBeCloseTo(-HALF, 6);
    expect(a.y).toBeCloseTo(-HALF, 6);
    expect(b.id).toBe(second);
  });

  it("TC-29: the bin button deletes the note and clears the selection", async () => {
    const id = addNote(0, 0);
    selectNote(id);

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(0);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("clicking the toolbar never clears the selection it belongs to", () => {
    const id = addNote(0, 0);
    selectNote(id);

    const toolbar = screen.getByTestId("note-toolbar");
    fireEvent.pointerDown(toolbar, { pointerId: 5, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerUp(toolbar, { pointerId: 5, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.click(toolbar);

    expect(noteEl(id).getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });

  it("an empty board shows the first-use hint, a board with a note does not", () => {
    // Empty state: story 1's hint plus the always-available Sticky note button.
    expect(screen.getByTestId("navigation-hint")).toBeTruthy();
    expect(screen.getByRole("button", { name: STICKY_BUTTON_LABEL })).toBeTruthy();

    addNote(0, 0);

    expect(screen.queryByTestId("navigation-hint")).toBeNull();
    expect(screen.getByRole("button", { name: STICKY_BUTTON_LABEL })).toBeTruthy();
  });

  it("only the selected note has a toolbar", () => {
    const first = addNote(0, 0);
    addNote(500, 0);
    selectNote(first);

    expect(screen.getAllByTestId("note-toolbar")).toHaveLength(1);
    expect(screen.getByTestId("note-toolbar").parentElement?.parentElement).toBe(noteEl(first));
  });
});

/** jsdom reports inline colours as rgb(), so compare in that form. */
function rgb(hex: string): string {
  const value = hex.replace("#", "");
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}
