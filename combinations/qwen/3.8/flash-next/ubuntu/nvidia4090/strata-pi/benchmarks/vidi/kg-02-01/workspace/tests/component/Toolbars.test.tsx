import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import {
  clickNote,
  createNoteAt,
  doubleClickNote,
  mountBoard,
  noteElement,
  notesOf,
  setWindowSize,
} from "./helpers";
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from "../../src/shared/config";
import { STICKY_BUTTON_LABEL, STICKY_BUTTON_TOOLTIP } from "../../src/client/board/Toolbar";
import { DELETE_BUTTON_LABEL } from "../../src/client/objects/NoteToolbar";

/**
 * TC-27 - TC-29: the Sticky note button, the named colour swatches and the
 * delete button, checked by accessible name (PRD F3/F4/F5) and by what they
 * change in the document - and only that.
 */

const VIEWPORT = { width: 1200, height: 800 };
const NOTE_ORIGIN = -STICKY_SIZE_WORLD / 2;

let doc: Y.Doc;
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
  user = userEvent.setup();
});

describe("the Sticky note button (TC-28)", () => {
  it("adds one note centred on the centre of the visible board and starts editing it", async () => {
    mountBoard(doc);

    const button = screen.getByRole("button", { name: STICKY_BUTTON_LABEL });
    await user.click(button);

    const notes = notesOf(doc);
    expect(notes).toHaveLength(1);
    // Default camera centres the world origin in the viewport, so the note is
    // centred on the world origin: its top-left is -size/2.
    expect(notes[0]).toMatchObject({ x: NOTE_ORIGIN, y: NOTE_ORIGIN, color: "yellow", z: 1 });

    // Ready to type immediately.
    expect(screen.getByTestId("sticky-textarea")).toBeTruthy();
    expect(noteElement(notes[0]!.id).dataset.editing).toBe("true");
    expect(noteElement(notes[0]!.id).dataset.selected).toBe("true");
  });

  it("shows the PRD tooltip and accessible name", () => {
    mountBoard(doc);

    const button = screen.getByRole("button", { name: "Sticky note" });
    expect(button.getAttribute("title")).toBe("Sticky note – or double-click the board");
    expect(STICKY_BUTTON_TOOLTIP).toBe("Sticky note – or double-click the board");
    expect(STICKY_BUTTON_LABEL).toBe("Sticky note");
  });

  it("adds a second note without changing the first", async () => {
    const first = createNoteAt(doc, 300, 300, "blue");
    mountBoard(doc);

    await user.click(screen.getByRole("button", { name: STICKY_BUTTON_LABEL }));

    const notes = notesOf(doc);
    expect(notes).toHaveLength(2);
    const kept = notes.find((note) => note.id === first)!;
    expect(kept).toMatchObject({ x: 200, y: 200, color: "blue", z: 1 });
  });
});

describe("colour swatches (TC-27)", () => {
  it("clicking Pink changes only the colour in the document", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 3, y: 3 });
    const before = notesOf(doc)[0]!;

    await user.click(screen.getByRole("button", { name: "Pink colour" }));

    const after = notesOf(doc)[0]!;
    expect(after.color).toBe("pink");
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(after.text).toBe(before.text);
    expect(notesOf(doc)).toHaveLength(1);

    // The note stays selected and its toolbar stays open.
    expect(noteElement(id).dataset.selected).toBe("true");
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(noteElement(id).dataset.color).toBe("pink");
  });

  it("renders all six named swatches, each labelled and coloured", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 3, y: 3 });

    const names = ["Yellow", "Orange", "Green", "Blue", "Pink", "Violet"];
    expect(names).toEqual(
      (Object.keys(STICKY_COLORS) as StickyColor[]).map(
        (color) => color[0]!.toUpperCase() + color.slice(1),
      ),
    );

    for (const name of names) {
      const swatch = screen.getByRole("button", { name: `${name} colour` });
      const key = name.toLowerCase() as StickyColor;
      expect(swatch.getAttribute("title")).toBe(`${name} colour`);
      expect(getComputedStyle(swatch).backgroundColor).toBe(rgbOf(STICKY_COLORS[key]));
      expect(swatch.getAttribute("aria-pressed")).toBe(key === "yellow" ? "true" : "false");
    }
  });
});

describe("the delete button (TC-29)", () => {
  it("removes the note from the document and clears the selection", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 3, y: 3 });

    await user.click(screen.getByRole("button", { name: DELETE_BUTTON_LABEL }));

    expect(notesOf(doc)).toHaveLength(0);
    expect(screen.queryAllByTestId("sticky-note")).toHaveLength(0);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("deleting one note leaves the others and their order alone", async () => {
    const doomed = createNoteAt(doc, 0, 0);
    const kept = createNoteAt(doc, 400, 400, "green");
    mountBoard(doc);
    clickNote(doomed, { x: 3, y: 3 });

    await user.click(screen.getByRole("button", { name: DELETE_BUTTON_LABEL }));

    expect(notesOf(doc).map((note) => note.id)).toEqual([kept]);
  });
});

describe("the note toolbar is for the selected note only", () => {
  it("is absent with nothing selected, present when selected, absent while editing", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);

    expect(screen.queryByTestId("note-toolbar")).toBeNull();

    clickNote(id, { x: 3, y: 3 });
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();

    doubleClickNote(id);
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });
});

function rgbOf(hex: string): string {
  const value = hex.replace("#", "");
  const parts = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((pair) =>
    Number.parseInt(pair, 16),
  );
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}
