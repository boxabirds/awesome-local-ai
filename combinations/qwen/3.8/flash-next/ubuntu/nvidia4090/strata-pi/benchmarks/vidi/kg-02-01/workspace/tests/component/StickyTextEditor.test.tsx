import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import {
  clickNote,
  createNoteAt,
  doubleClickBoard,
  doubleClickNote,
  mountBoard,
  noteElement,
  notesOf,
  pointerDown,
  pointerUp,
  pressKey,
  setWindowSize,
  viewportElement,
} from "./helpers";
import { getStickyText } from "../../src/shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import { PROSE_1200, RETRO_TEXT } from "../fixtures/texts";

/**
 * TC-23, TC-24, TC-26, TC-38: editing a note's text. The assertion that
 * matters everywhere is the same one: what the user typed is in the `Y.Text`
 * and in no other place.
 */

const VIEWPORT = { width: 1200, height: 800 };

let doc: Y.Doc;
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
  user = userEvent.setup();
});

function textarea(): HTMLTextAreaElement {
  return screen.getByTestId("sticky-textarea") as HTMLTextAreaElement;
}

function textOf(id: string): string {
  return getStickyText(doc, id)?.toString() ?? "<missing>";
}

describe("start editing with Enter (TC-23)", () => {
  it("Enter on a selected note focuses the textarea with the caret at the end", () => {
    const id = createNoteAt(doc, 0, 0);
    modelInsert(id, RETRO_TEXT);
    mountBoard(doc);
    clickNote(id, { x: 2, y: 2 });

    pressKey("Enter");

    expect(noteElement(id).dataset.editing).toBe("true");
    const area = textarea();
    expect(area).toBe(document.activeElement);
    expect(area.value).toBe(RETRO_TEXT);
    expect(area.selectionStart).toBe(RETRO_TEXT.length);
    expect(area.selectionEnd).toBe(RETRO_TEXT.length);
  });

  it("the caret starts at the end, so typing appends", async () => {
    const id = createNoteAt(doc, 0, 0);
    modelInsert(id, "ab");
    mountBoard(doc);
    clickNote(id, { x: 2, y: 2 });
    pressKey("Enter");

    await user.keyboard("c");

    expect(textOf(id)).toBe("abc");
  });
});

describe("typing and Escape (TC-24)", () => {
  it("each keystroke is in the Y.Text before editing ends", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    doubleClickNote(id);

    await user.type(textarea(), "hello world");

    // Written as typed, not on close.
    expect(textOf(id)).toBe("hello world");

    pressKey("Escape", textarea());

    expect(screen.queryByTestId("sticky-textarea")).toBeNull();
    expect(noteElement(id).dataset.selected).toBe("true");
    expect(textOf(id)).toBe("hello world");
  });

  it("Escape inside the note does not delete it (negative)", () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    clickNote(id, { x: 1, y: 1 });
    pressKey("Enter");

    pressKey("Escape", textarea());

    expect(notesOf(doc)).toHaveLength(1);
    expect(screen.queryByTestId("sticky-textarea")).toBeNull();
  });
});

describe("the 1,000 character limit (TC-24)", () => {
  it("keeps the first 1,000 characters and refuses the rest", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    doubleClickNote(id);

    await user.paste(PROSE_1200);

    expect(textOf(id)).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(textarea().value).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(screen.getByTestId("sticky-counter").textContent).toBe("1000/1000");
  });

  it("editing to 999 then adding 10 more ends at 1,000", async () => {
    const id = createNoteAt(doc, 0, 0);
    modelInsert(id, "x".repeat(999));
    mountBoard(doc);
    doubleClickNote(id);

    await user.paste("yyyyyyyyyy");

    expect(textOf(id).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(textOf(id).startsWith("x".repeat(999))).toBe(true);
    expect(textOf(id).endsWith("y")).toBe(true);
  });

  it("shows the counter only when the note is within 50 characters of the limit", async () => {
    const id = createNoteAt(doc, 0, 0);
    mountBoard(doc);
    doubleClickNote(id);

    await user.paste("a".repeat(949));
    expect(screen.queryByTestId("sticky-counter")).toBeNull();

    await user.paste("a");
    expect(screen.getByTestId("sticky-counter").textContent).toBe("950/1000");
  });
});

describe("keys while editing go to the text (TC-26)", () => {
  it("Backspace while editing 'ab' gives 'a' and keeps the note", async () => {
    const id = createNoteAt(doc, 0, 0);
    modelInsert(id, "ab");
    mountBoard(doc);
    doubleClickNote(id);

    await user.keyboard("{Backspace}");

    expect(notesOf(doc)).toHaveLength(1);
    expect(textOf(id)).toBe("a");
    expect(noteElement(id).dataset.editing).toBe("true");
  });

  it("Delete while editing never removes the note", async () => {
    const id = createNoteAt(doc, 0, 0);
    modelInsert(id, RETRO_TEXT);
    mountBoard(doc);
    doubleClickNote(id);

    pressKey("Delete", textarea());

    expect(notesOf(doc)).toHaveLength(1);
    expect(textOf(id)).toBe(RETRO_TEXT);
  });
});

describe("clicking outside the note (TC-38)", () => {
  it("ends editing, commits nothing extra, and leaves the note Unselected", async () => {
    mountBoard(doc);
    doubleClickBoard(600, 400);
    expect(notesOf(doc)).toHaveLength(1);

    const created = notesOf(doc)[0]!;
    await user.type(textarea(), "abc");

    const board = viewportElement();
    pointerDown(board, 200, 200);
    pointerUp(board, 200, 200);

    expect(screen.queryByTestId("sticky-textarea")).toBeNull();
    expect(textOf(created.id)).toBe("abc");
    expect(noteElement(created.id).dataset.selected).toBe("false");
  });
});

function modelInsert(id: string, text: string): void {
  getStickyText(doc, id)?.insert(0, text);
}
