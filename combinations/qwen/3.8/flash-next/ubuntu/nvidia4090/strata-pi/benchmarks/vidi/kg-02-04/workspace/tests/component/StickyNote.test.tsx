import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/client/App";
import {
  createSticky,
  deleteObject,
  getStickyText,
  type StickySnapshot,
} from "../../src/shared/board-model";
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from "../../src/shared/config";
import { STICKY_BUTTON_LABEL } from "../../src/client/board/Toolbar";
import { STICKY_COLOR_NAMES } from "../../src/client/objects/NoteToolbar";

/**
 * ui-component tests for sticky note interaction (sticky.interaction):
 * TC-18 to TC-22, TC-25, TC-35 to TC-37.
 *
 * The board is rendered as the real `App`, and the tests go through the
 * document (`window.__vidi6Board`) to assert what the interaction actually
 * wrote, rather than what the DOM looks like.
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

function firstNote(): StickySnapshot {
  const list = notes();
  if (list.length === 0) throw new Error("expected a note on the board");
  return list[0]!;
}

function noteEl(index = 0): HTMLElement {
  return screen.getAllByTestId("sticky-note")[index]!;
}

/** Notes reorder in the DOM when their stacking changes, so tests that drag
 *  one note look it up by id. */
function noteElById(id: string): HTMLElement {
  const el = screen
    .getAllByTestId("sticky-note")
    .find((node) => node.dataset.noteId === id);
  if (!el) throw new Error(`no note element for ${id}`);
  return el;
}

function viewportEl(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

/** Lets rAF-throttled writes land and React re-render. */
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
  // The Yjs change is observed synchronously, so it has to happen inside act()
  // for React to have re-rendered by the time the assertion runs.
  act(() => {
    const id = createSticky(api.doc, { x, y });
    if (id !== null) created.push(id);
  });
  if (created.length === 0) throw new Error("createSticky was rejected");
  return created[0]!;
}

function pointer(type: string, el: HTMLElement, x: number, y: number, pointerId = 1) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    pointerType: "mouse",
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

/** Press, optionally move, release. Returns the number of moves applied. */
async function pressNote(index: number, from: { x: number; y: number }, to?: { x: number; y: number }) {
  const el = noteEl(index);
  pointer("pointerdown", el, from.x, from.y);
  if (to) {
    pointer("pointermove", el, to.x, to.y);
    await settle();
  }
  pointer("pointerup", el, to?.x ?? from.x, to?.y ?? from.y);
  await settle();
}

function selected(id?: string): boolean {
  return (id ? noteElById(id) : noteEl()).dataset.selected === "true";
}

describe("sticky note interaction", () => {
  beforeEach(() => {
    setWindowSize(VIEWPORT.width, VIEWPORT.height);
    render(<App />);
  });

  it("TC-18: a click on a note selects it (outline plus note toolbar)", async () => {
    const id = addNote(100, 100);
    await pressNote(0, { x: 150, y: 150 });

    expect(selected()).toBe(true);
    expect(noteEl().dataset.selected).toBe("true");
    expect(noteEl().getAttribute("aria-label")).toBe("Sticky note");
    expect(screen.getByRole("group", { name: "Sticky note" })).toBeTruthy();

    const toolbar = screen.getByTestId("note-toolbar");
    for (const name of Object.keys(STICKY_COLORS)) {
      const button = within(toolbar).getByRole("button", {
        name: `${STICKY_COLOR_NAMES[name as keyof typeof STICKY_COLOR_NAMES]} colour`,
      });
      expect(button.getAttribute("aria-pressed")).toBe(name === "yellow" ? "true" : "false");
    }
    expect(within(toolbar).getByRole("button", { name: "Delete note" })).toBeTruthy();

    // Selection is UI state: it is never written to the document.
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.id).toBe(id);
    expect(notes()[0]).toMatchObject({ x: -STICKY_SIZE_WORLD / 2 + 100, z: 1 });
  });

  it("TC-19: a press that moves 2 px selects without moving the note", async () => {
    addNote(0, 0);
    const before = firstNote();
    const el = noteEl();
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 150 + (DRAG_THRESHOLD_PX - 1), 150);
    await settle();
    pointer("pointerup", el, 152, 150);
    await settle();

    const after = firstNote();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(noteEl().dataset.dragging).toBe("false");
    expect(selected()).toBe(true);
  });

  it("TC-20 boundary: a press that moves exactly DRAG_THRESHOLD_PX starts the drag", async () => {
    const id = addNote(0, 0);
    const before = firstNote();
    const el = noteEl();
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 150 + DRAG_THRESHOLD_PX, 150);
    await settle();
    expect(noteElById(id).dataset.dragging).toBe("true");
    pointer("pointerup", el, 150 + DRAG_THRESHOLD_PX, 150);
    await settle();

    const after = notes().find((note) => note.id === id)!;
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("TC-20: dragging a note moves it and does not move the board", async () => {
    const id = addNote(0, 0);
    addNote(600, 600); // a second note that must not budge
    const cameraBefore = window.__vidi6!.getCamera();
    const gridBefore = screen.getByTestId("board-grid").getAttribute("style");

    const el = noteElById(id);
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 190, 170);
    await settle();
    expect(noteElById(id).dataset.dragging).toBe("true");
    pointer("pointermove", el, 220, 200);
    pointer("pointerup", el, 220, 200);
    await settle();

    const moved = notes().find((note) => note.id === id)!;
    // 100% zoom: a 70 x 50 px drag moves the note 70 x 50 world units.
    expect(moved.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 70, 6);
    expect(moved.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 50, 6);

    const cameraAfter = window.__vidi6!.getCamera();
    expect(cameraAfter).toEqual(cameraBefore);
    expect(screen.getByTestId("board-grid").getAttribute("style")).toBe(gridBefore);
    expect(noteElById(id).dataset.dragging).toBe("false");
    expect(selected(id)).toBe(true);
  });

  it("TC-21: pointercancel during a drag keeps the last position and selects", async () => {
    const id = addNote(0, 0);
    const el = noteElById(id);
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 190, 170);
    await settle();
    pointer("pointermove", el, 210, 190); // pending, not yet applied
    pointer("pointercancel", el, 210, 190);
    await settle();

    const moved = notes().find((note) => note.id === id)!;
    expect(moved.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 60, 6);
    expect(moved.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 40, 6);
    expect(noteElById(id).dataset.dragging).toBe("false");
    expect(selected(id)).toBe(true);
  });

  it("TC-22: a click on empty board clears the selection and the toolbar", async () => {
    addNote(0, 0);
    await pressNote(0, { x: 150, y: 150 });
    expect(selected()).toBe(true);
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    pointer("pointerdown", viewportEl(), 700, 700);
    pointer("pointerup", viewportEl(), 700, 700);
    await settle();

    expect(selected()).toBe(false);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-25: Delete removes the selected note", async () => {
    addNote(0, 0);
    await pressNote(0, { x: 150, y: 150 });
    fireEvent.keyDown(document.body, { key: "Delete", code: "Delete" });
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-note")).toBeNull();
  });

  it("TC-25: Backspace removes the selected note (separate run)", async () => {
    addNote(0, 0);
    await pressNote(0, { x: 150, y: 150 });
    fireEvent.keyDown(document.body, { key: "Backspace", code: "Backspace" });
    await settle();

    expect(notes()).toHaveLength(0);
  });

  it("TC-35: double-clicking a note edits it instead of creating another", async () => {
    const id = addNote(0, 0);
    fireEvent.doubleClick(noteEl());
    await settle();

    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.id).toBe(id);
    expect(screen.getByTestId("sticky-text-editor")).toBeTruthy();
    // A note being edited shows no toolbar.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-36: Enter with nothing selected does nothing", async () => {
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-text-editor")).toBeNull();
  });

  it("TC-37: a note deleted mid-drag ends the interaction silently", async () => {
    const id = addNote(0, 0);
    const el = noteElById(id);
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 190, 170);
    await settle();

    const api = boardApi();
    expect(() => {
      act(() => {
        deleteObject(api.doc, id);
      });
    }).not.toThrow();
    await settle();

    expect(() => {
      pointer("pointermove", el, 220, 200);
      pointer("pointerup", el, 220, 200);
    }).not.toThrow();
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-note")).toBeNull();
  });

  it("TC-37: a note deleted while editing is not re-created", async () => {
    const id = addNote(0, 0);
    fireEvent.doubleClick(noteEl());
    await settle();
    const editor = screen.getByTestId("sticky-text-editor") as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: "kept until deleted" } });
    await settle();

    const api = boardApi();
    expect(() => {
      act(() => {
        deleteObject(api.doc, id);
      });
    }).not.toThrow();
    await settle();

    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId("sticky-text-editor")).toBeNull();
    expect(screen.queryByTestId("sticky-note")).toBeNull();
  });

  it("a dragged note is drawn above the notes it overlaps (bringToFront once)", async () => {
    // The first rendered note is the bottom one (z 1); add a note above it.
    const bottom = addNote(0, 0);
    addNote(600, 600);
    const bottomBefore = notes().find((note) => note.id === bottom)!.z;
    const topBefore = notes().filter((note) => note.id !== bottom)[0]!.z;
    expect(bottomBefore).toBeLessThan(topBefore);

    const el = screen.getAllByTestId("sticky-note").find((node) => node.dataset.noteId === bottom)!;
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 200, 200);
    await settle();

    const after = notes().find((note) => note.id === bottom)!;
    expect(after.z).toBeGreaterThan(topBefore);
    // DOM order is the paint order.
    expect(screen.getAllByTestId("sticky-note").at(-1)!.dataset.noteId).toBe(bottom);
  });

  it("a blank note shows no placeholder text", async () => {
    addNote(0, 0);
    expect(noteEl().querySelector("[data-testid='sticky-text']")?.textContent).toBe("");
  });

  it("a note is reachable by keyboard (tabIndex, accessible name)", () => {
    addNote(0, 0);
    const el = noteEl();
    expect(el.getAttribute("role")).toBe("group");
    expect(el.getAttribute("aria-label")).toBe("Sticky note");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("the left toolbar exposes the Sticky note button with an accessible name", () => {
    const button = screen.getByTestId("sticky-note-button");
    expect(button.getAttribute("aria-label")).toBe(STICKY_BUTTON_LABEL);
    expect((button.getAttribute("title") ?? "").includes(STICKY_BUTTON_LABEL));
  });

  it("notes are rendered in stacking order, bottom note first", () => {
    addNote(0, 0);
    addNote(600, 600);
    addNote(900, 900);
    expect(notes().map((note) => note.z)).toEqual([1, 2, 3]);
  });

  it("moving a note keeps its colour and text", async () => {
    const id = addNote(0, 0);
    const api = boardApi();
    act(() => {
      getStickyText(api.doc, id)?.insert(0, "Faster onboarding");
    });
    await settle();

    const el = noteEl();
    pointer("pointerdown", el, 150, 150);
    pointer("pointermove", el, 200, 200);
    pointer("pointerup", el, 200, 200);
    await settle();

    const note = notes().find((item) => item.id === id)!;
    expect(note.color).toBe("yellow");
    expect(note.text).toBe("Faster onboarding");
  });
});
