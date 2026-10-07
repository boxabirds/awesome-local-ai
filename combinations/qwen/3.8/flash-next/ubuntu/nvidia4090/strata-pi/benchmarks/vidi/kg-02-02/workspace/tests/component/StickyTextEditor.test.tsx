import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import * as Y from "yjs";
import { getStickyText, snapshot } from "../../src/shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import {
  addNoteAtOrigin,
  clickNote,
  noteEl,
  pointer,
  pressKey,
  renderBoard,
  settle,
  viewportEl,
  onlyNote,
} from "./helpers/notes";

describe("sticky note text editing", () => {
  let doc: Y.Doc;
  let id: string;

  beforeEach(async () => {
    doc = new Y.Doc();
    id = addNoteAtOrigin(doc);
    renderBoard(doc);
    await editExistingNote();
  });

  async function editExistingNote() {
    const el = noteEl(id);
    clickNote(id);
    await settle();
    pressKey("Enter", el);
    await settle();
  }

  function editor(): HTMLTextAreaElement {
    const el = document.querySelector<HTMLTextAreaElement>("[data-testid='sticky-editor']");
    if (!el) throw new Error("the note is not being edited");
    return el;
  }

  function type(text: string) {
    const el = editor();
    el.value = `${el.value}${text}`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** TC-23: Enter opens the editor focused with the caret at the end. */
  it("TC-23 Enter on a selected note opens the editor with the caret at the end", async () => {
    type("retro");
    await settle();

    const el = editor();
    expect(el).toBe(document.activeElement);
    expect(el.selectionStart).toBe(el.value.length);
    expect(el.selectionEnd).toBe(el.value.length);
    expect(el.getAttribute("aria-label")).toBe("Sticky note text");
  });

  /** TC-24: Escape ends editing, keeps the text and keeps the note selected. */
  it("TC-24 Escape keeps the typed text and keeps the note selected", async () => {
    type("retro\nnote");
    await settle();
    expect(getStickyText(doc, id)!.toString()).toBe("retro\nnote");

    const user = userEvent.setup();
    editor().focus();
    await user.keyboard("{Escape}");
    await settle();

    expect(document.querySelector("[data-testid='sticky-editor']")).toBeNull();
    expect(onlyNote(doc).text).toBe("retro\nnote");
    expect(noteEl(id).dataset.selected).toBe("true");
    expect(document.querySelector("[data-testid='sticky-text']")!.textContent).toBe("retro\nnote");
  });

  /** TC-26: shortcuts while typing belong to the text, not the note. */
  it("TC-26 Backspace while editing edits the text and never deletes the note", async () => {
    const user = userEvent.setup();
    editor().focus();
    await user.keyboard("ab");
    await settle();
    expect(onlyNote(doc).text).toBe("ab");

    await user.keyboard("{Backspace}");
    await settle();

    expect(snapshot(doc)).toHaveLength(1);
    expect(onlyNote(doc).text).toBe("a");
  });

  it("TC-26 Enter while editing inserts a new line and does not end the edit", async () => {
    const user = userEvent.setup();
    editor().focus();
    await user.keyboard("one{Enter}two");
    await settle();

    expect(onlyNote(doc).text).toBe("one\ntwo");
    expect(document.querySelector("[data-testid='sticky-editor']")).not.toBeNull();
  });

  it("text is written on every keystroke, so nothing is lost when editing ends", async () => {
    type("idea");
    await settle();
    expect(getStickyText(doc, id)!.toString()).toBe("idea");

    // Editing ends by a click outside: no further write is needed.
    const board = viewportEl();
    pointer("pointerdown", board, 800, 700);
    pointer("pointerup", board, 800, 700);
    await settle();

    expect(document.querySelector("[data-testid='sticky-editor']")).toBeNull();
    expect(onlyNote(doc).text).toBe("idea");
  });

  /** TC-38: a press outside the note ends the edit silently. */
  it("TC-38 a click outside the note ends editing and clears the selection", async () => {
    type("half typed");
    await settle();

    const board = viewportEl();
    pointer("pointerdown", board, 820, 700);
    pointer("pointermove", board, 840, 700);
    pointer("pointerup", board, 840, 700);
    await settle();

    expect(document.querySelector("[data-testid='sticky-editor']")).toBeNull();
    expect(onlyNote(doc).text).toBe("half typed");
    expect(noteEl(id).dataset.selected).toBe("false");
  });

  /** TC-31 (component level): nothing may be typed past the limit. */
  it("text is clamped to 1000 characters at the moment it is typed", async () => {
    type("x".repeat(STICKY_TEXT_MAX_CHARS + 40));
    await settle();

    expect(onlyNote(doc).text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editor().value.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it("the counter appears only for the last 50 characters and is not editable text", async () => {
    expect(document.querySelector("[data-testid='sticky-counter']")).toBeNull();

    type("y".repeat(STICKY_TEXT_MAX_CHARS - 60));
    await settle();
    expect(document.querySelector("[data-testid='sticky-counter']")).toBeNull();

    type("y".repeat(20));
    await settle();

    const counter = document.querySelector<HTMLElement>("[data-testid='sticky-counter']");
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe(`${STICKY_TEXT_MAX_CHARS - 40}/${STICKY_TEXT_MAX_CHARS}`);
    // The counter is chrome, not part of the note text.
    expect(onlyNote(doc).text).not.toContain("/");
    expect(editor().value).not.toContain("/");
  });
});
