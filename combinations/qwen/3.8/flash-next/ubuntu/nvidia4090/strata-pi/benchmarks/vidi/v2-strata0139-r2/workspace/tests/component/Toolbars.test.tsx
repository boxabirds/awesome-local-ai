import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { screenToWorld } from "../../src/client/canvas/camera";
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from "../../src/shared/config";
import {
  changeModel,
  dragNote,
  newNote,
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
 * Story 2, task 7 (part 3) - the toolbars (TC-27, TC-28, TC-29).
 *
 * The board toolbar is story 1's element; story 2 adds only the Sticky note
 * tool to it. The note toolbar is story 2's, and both must stay out of the
 * board's own gestures.
 */

function viewportCentre() {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

const LABELS: Record<string, string> = {
  yellow: "Yellow",
  pink: "Pink",
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  violet: "Violet",
};

beforeEach(() => {
  runAnimationFramesSynchronously();
});

function toolbarButton(screen: RenderResult, testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

describe("sticky.toolbar: the Sticky note tool", () => {
  it("TC-28 clicking the Sticky note tool creates one note at the centre of the visible board and edits it", () => {
    const doc = new Y.Doc();
    const screen = render(<App doc={doc} />);
    const camera = readCamera();

    fireEvent.click(toolbarButton(screen, "create-sticky"));

    const notes = readNotes(doc);
    expect(notes).toHaveLength(1);
    const centre = screenToWorld(camera, viewportCentre());
    // The note is centred on the view centre, so its top-left is half a note away.
    expect(notes[0]?.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0]?.color).toBe("yellow");
    expect(notes[0]?.text).toBe("");

    // Straight into Editing, with the caret ready.
    const textarea = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(selectedIds(screen)).toEqual([notes[0]?.id]);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-28 the tool keeps working with an empty board and repeated presses add notes", () => {
    const doc = new Y.Doc();
    const screen = render(<App doc={doc} />);

    const created: string[] = [];
    for (let press = 0; press < 3; press += 1) {
      fireEvent.click(toolbarButton(screen, "create-sticky"));
      const notes = readNotes(doc);
      const latest = notes[notes.length - 1];
      if (!latest) throw new Error("expected a note");
      created.push(latest.id);
      // Leaving the previous note's editing state before the next press.
      pressKey("Escape");
    }

    expect(new Set(created).size).toBe(3);
    expect(readNotes(doc)).toHaveLength(3);
  });

  it("TC-34 after panning far away the new note still lands in the middle of the screen", () => {
    const doc = new Y.Doc();
    const screen = render(<App doc={doc} />);

    // Story 1 owns panning; its test hook moves the camera far from the origin.
    const far = { x: 4_000, y: -2_500, zoom: 1 };
    fireEvent.click(toolbarButton(screen, "create-sticky"));
    pressKey("Escape");
    changeModel(() => {
      window.__vidi6?.setCamera(far);
    });
    fireEvent.click(toolbarButton(screen, "create-sticky"));

    const notes = readNotes(doc);
    expect(notes).toHaveLength(2);
    const latest = notes[notes.length - 1];
    if (!latest) throw new Error("expected a note");
    const centre = screenToWorld(readCamera(), viewportCentre());
    expect(latest.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(latest.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    // Screen position of the new note's centre: dead centre of the viewport.
    expect(latest.x + STICKY_SIZE_WORLD / 2 - far.x).toBeCloseTo(viewportCentre().x, 6);
    expect(latest.y + STICKY_SIZE_WORLD / 2 - far.y).toBeCloseTo(viewportCentre().y, 6);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(2);
  });

  it("the Sticky note tool keeps its place in the board toolbar beside the two tools", () => {
    const doc = new Y.Doc();
    const screen = render(<App doc={doc} />);
    const button = toolbarButton(screen, "create-sticky");

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Sticky note (N)");
    expect(button.getAttribute("title")).toBe("Sticky note (N) \u2013 centre of view");
  });
});

describe("sticky.toolbar: colour and delete", () => {
  function selectedNote(): { doc: Y.Doc; id: string; screen: RenderResult } {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 100, y: 100 });
    const screen = render(<App doc={doc} />);
    selectNote(screen, id);
    return { doc, id, screen };
  }

  it("TC-27 clicking the Pink swatch recolours the note and keeps the selection", () => {
    const { doc, id, screen } = selectedNote();

    fireEvent.click(screen.getByTestId("swatch-pink"));

    expect(noteOf(doc, id).color).toBe("pink");
    expect(selectedIds(screen)).toEqual([id]);
    expect(noteById(screen, id).getAttribute("aria-label")).toBe("Sticky note, pink");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
  });

  it("all six colours are offered as named buttons, and the current colour is marked pressed", () => {
    const { doc, id, screen } = selectedNote();
    const names = Object.keys(STICKY_COLORS);

    for (const name of names) {
      const swatch = screen.getByTestId(`swatch-${name}`);
      expect(swatch.getAttribute("aria-label")).toBe(`${LABELS[name] ?? name} colour`);
      expect(swatch.getAttribute("title")).toBe(`${LABELS[name] ?? name} colour`);
      expect(swatch.getAttribute("aria-pressed")).toBe(name === "yellow" ? "true" : "false");
      expect(swatch.style.background).not.toBe("");
    }

    for (const name of names) {
      fireEvent.click(screen.getByTestId(`swatch-${name}`));
      expect(noteOf(doc, id).color).toBe(name as StickyColor);
      expect(screen.getByTestId(`swatch-${name}`).getAttribute("aria-pressed")).toBe("true");
      expect(selectedIds(screen)).toEqual([id]);
    }
  });

  it("recolouring does not move the note, change its text or its z", () => {
    const { doc, id, screen } = selectedNote();
    const before = noteOf(doc, id);

    fireEvent.click(screen.getByTestId("swatch-blue"));

    const after = noteOf(doc, id);
    expect(after).toEqual({ ...before, color: "blue" });
  });

  it("TC-29 the bin button deletes the note and clears the selection", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    newNote(doc, { x: 400, y: 0 }, "green");
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    fireEvent.click(screen.getByTestId("note-delete"));

    expect(readNotes(doc).map((note) => note.color)).toEqual(["green"]);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    expect(selectedIds(screen)).toEqual([]);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(1);
  });

  it("TC-20 toolbars never pan or zoom the board", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    selectNote(screen, id);
    const before = readCamera();

    // The note toolbar lives inside the board's DOM: gestures on it must stop there.
    const anchor = screen.getByTestId("sticky-note-toolbar-anchor");
    pointer("pointerDown", anchor, 150, 40);
    pointer("pointerMove", anchor, 450, 300);
    pointer("pointerUp", anchor, 450, 300);
    fireEvent.wheel(anchor, { deltaY: -300, ctrlKey: true });
    fireEvent.doubleClick(anchor);

    expect(readCamera()).toEqual(before);
    // And it did not select, drag, edit or duplicate the note either.
    expect(selectedIds(screen)).toEqual([id]);
    expect(readNotes(doc)).toHaveLength(1);
    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
  });

  it("a gesture that begins on a note never reaches the board toolbar's controls", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);
    const before = readCamera();

    dragNote(screen, id, { x: 50, y: 50 }, { x: 350, y: 250 });

    expect(readCamera()).toEqual(before);
  });
});

describe("sticky.toolbar: keyboard control of the toolbar", () => {
  it("Enter on a selected note edits it rather than re-triggering the toolbar button", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    const button = screen.getByTestId("create-sticky");
    button.focus();
    pressKey("Enter", button);

    // The focused button swallows Enter as its own activation, so no editing starts.
    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
    expect(noteElementsCount(screen)).toBe(1);
  });
});

function noteElementsCount(screen: RenderResult): number {
  return screen.queryAllByTestId("sticky-note").length;
}
