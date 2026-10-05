import { describe, expect, it } from "vitest";
import { fireEvent, render, type RenderResult } from "@testing-library/react";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { getStickyText } from "../../src/shared/board-model";
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import { PROSE_1000, PROSE_1200, SHORT_PHRASE } from "../fixtures/texts";
import {
  boardSpace,
  changeModel,
  newNote,
  noteById,
  noteOf,
  pointer,
  pressKey,
  readNotes,
  selectNote,
  selectedIds,
} from "./boardFixture";

/**
 * Story 2, task 7 (part 2) - the note editor (TC-23, TC-24, TC-26, TC-38) and
 * the length limit / counter rules behind it.
 *
 * jsdom has no font metrics, so the auto-fit sizes themselves are covered by
 * the unit tests with a fake measuring element (TC-16, TC-17) and by the e2e
 * test with real layout (TC-33). What is checked here is the editor's own
 * behaviour: focus and caret placement, Escape, the character limit, the
 * counter and the write-through to the shared Y.Text.
 */

function editNote(screen: RenderResult, id: string): HTMLTextAreaElement {
  fireEvent.doubleClick(noteById(screen, id));
  return screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
}

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.change(textarea, { target: { value } });
}

describe("sticky.text: start and end editing", () => {
  it("TC-23 Enter on a selected note starts editing with the caret at the end", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", SHORT_PHRASE);
    const screen = render(<App doc={doc} />);

    selectNote(screen, id);
    pressKey("Enter");

    const textarea = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe(SHORT_PHRASE);
    expect(textarea.selectionStart).toBe(SHORT_PHRASE.length);
    expect(textarea.selectionEnd).toBe(SHORT_PHRASE.length);
    expect(textarea.getAttribute("aria-label")).toBe("Sticky note text");
    // Editing keeps the note selected, and the display text is replaced by the
    // editor rather than duplicated.
    expect(selectedIds(screen)).toEqual([id]);
    expect(screen.queryByTestId("sticky-note-text")).toBeNull();
  });

  it("TC-24 Escape ends editing: the note stays selected and the text is preserved", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "draft text");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    typeInto(textarea, "draft text edited");

    pressKey("Escape", textarea);

    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
    expect(selectedIds(screen)).toEqual([id]);
    expect(screen.getByTestId("note-toolbar")).toBeTruthy();
    expect(noteOf(doc, id).text).toBe("draft text edited");
    expect(screen.getByTestId("sticky-note-text").textContent).toBe("draft text edited");
  });

  it("TC-26 Backspace while editing does not delete the note", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "ab");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    pressKey("Backspace", textarea);

    // The note survives, editing continues, and the key reached the textarea
    // rather than the board (jsdom does not itself remove a character; the
    // character-level result is e2e TC-30).
    expect(readNotes(doc).map((note) => note.id)).toEqual([id]);
    expect(screen.getByTestId("sticky-note-input")).toBeTruthy();
    expect(noteOf(doc, id).text).toBe("ab");
  });

  it("TC-38 typing then clicking outside commits the text and unselects", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    typeInto(textarea, "abc");

    pointer("pointerDown", boardSpace(screen), 600, 500);

    expect(screen.queryByTestId("sticky-note-input")).toBeNull();
    expect((getStickyText(doc, id) as Y.Text).toString()).toBe("abc");
    expect(selectedIds(screen)).toEqual([]);
    expect(screen.getByTestId("sticky-note-text").textContent).toBe("abc");
  });

  it("Enter inside the note inserts a newline instead of leaving editing", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "one");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    // The browser inserts the newline; the app must not end editing here.
    pressKey("Enter", textarea);

    expect(screen.getByTestId("sticky-note-input")).toBeTruthy();
    expect(selectedIds(screen)).toEqual([id]);
  });

  it("a text change from outside the editor is kept and shown once editing ends", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "hello");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    // Story 3 will push remote edits into the same Y.Text; story 2 only has to
    // keep them and show them, which happens when the note leaves Editing.
    changeModel(() => {
      getStickyText(doc, id)?.insert(0, "remote ");
    });

    expect(notedText(doc, id)).toBe("remote hello");

    pressKey("Escape", textarea);
    expect(screen.getByTestId("sticky-note-text").textContent).toBe("remote hello");
  });
});

describe("story 3: typing while someone else types in the same note", () => {
  it("text that arrives mid-edit is pulled into the field and survives the next keystroke", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "green");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    typeInto(textarea, "green red");

    // Someone else types into the same note. The field must follow the shared
    // text, because the next keystroke is diffed against it.
    changeModel(() => {
      (getStickyText(doc, id) as Y.Text).insert(9, " blue");
    });

    expect(textarea.value).toBe("green red blue");
    // The caret stays where the local typist left it, before the arriving text.
    expect(textarea.selectionStart).toBe(9);

    // Typing on now has to keep what the other person wrote.
    typeInto(textarea, `${textarea.value}!`);

    expect(notedText(doc, id)).toBe("green red blue!");
    expect(screen.getByTestId("sticky-note-input")).toBeTruthy();
  });

  it("a note being edited elsewhere still shows the shared text once editing ends", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 }, "yellow", "hello");
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    typeInto(textarea, "hello there");
    changeModel(() => {
      (getStickyText(doc, id) as Y.Text).insert(5, " world");
    });
    pressKey("Escape", textarea);

    expect(screen.getByTestId("sticky-note-text").textContent).toBe("hello world there");
    expect(notedText(doc, id)).toBe("hello world there");
  });
});

describe("sticky.text: length limit and counter", () => {
  it("typing past the limit keeps exactly STICKY_TEXT_MAX_CHARS characters", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);
    typeInto(textarea, PROSE_1200);

    expect(textarea.value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(textarea.value).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(notedText(doc, id)).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(textarea.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it("the counter appears only within STICKY_COUNTER_THRESHOLD_CHARS of the limit", () => {
    const doc = new Y.Doc();
    const id = newNote(doc, { x: 0, y: 0 });
    const screen = render(<App doc={doc} />);

    const textarea = editNote(screen, id);

    typeInto(textarea, PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1));
    expect(screen.queryByTestId("sticky-note-counter")).toBeNull();

    typeInto(textarea, PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS));
    const counter = screen.getByTestId("sticky-note-counter");
    expect(counter.textContent).toBe(`${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    typeInto(textarea, PROSE_1200);
    expect(screen.getByTestId("sticky-note-counter").textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });
});

function notedText(doc: Y.Doc, id: string): string {
  return noteOf(doc, id).text;
}
