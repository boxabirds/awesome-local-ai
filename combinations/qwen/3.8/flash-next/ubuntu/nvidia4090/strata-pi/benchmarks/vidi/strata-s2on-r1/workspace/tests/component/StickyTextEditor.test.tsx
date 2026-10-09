import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { snapshot } from "../../src/shared/board-model";
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import { PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from "../fixtures/texts";
import {
  clickEmptyBoard,
  countUpdates,
  createNoteAt,
  dblclick,
  editorEl,
  firstNote,
  hasEditor,
  keydownOnFocused,
  noteCentreOnScreen,
  pasteIntoEditor,
  pressNote,
  renderBoard,
  settle,
} from "./helpers/board";

/**
 * sticky.text, ui-component level: the editor's start and end, the character
 * limit and the counter. Font fit itself needs real layout and is checked in
 * e2e (TC-33).
 */
describe("StickyTextEditor", () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    renderBoard(doc);
  });

  /** Selected but not editing: the state the Enter shortcut works on. */
  async function createSelectedNote() {
    createNoteAt({ x: 600, y: 400 });
    await settle();
    keydownOnFocused("Escape");
    await settle();
    expect(firstNote().dataset.selected).toBe("true");
    expect(hasEditor()).toBe(false);
  }

  it("TC-23: Enter on a selected note starts editing with the caret at the end", async () => {
    await createSelectedNote();

    const enter = keydownOnFocused("Enter");
    await settle();

    expect(enter.defaultPrevented).toBe(true);
    expect(firstNote().dataset.editing).toBe("true");
    const area = editorEl();
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe(0);
  });

  it("TC-23b: Enter re-opens the text with the caret after the existing text", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await user.type(editorEl(), SHORT_PHRASE);
    await settle();
    keydownOnFocused("Escape");
    await settle();
    expect(hasEditor()).toBe(false);

    keydownOnFocused("Enter");
    await settle();

    const area = editorEl();
    expect(area.value).toBe(SHORT_PHRASE);
    expect(area.selectionStart).toBe(SHORT_PHRASE.length);
    expect(area.selectionEnd).toBe(SHORT_PHRASE.length);
    expect(document.activeElement).toBe(area);
  });

  it("TC-24: Escape ends editing, keeps the note selected and preserves the text", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await user.type(editorEl(), RETRO_ITEM);
    await settle();

    const escape = keydownOnFocused("Escape");
    await settle();

    expect(escape.defaultPrevented).toBe(true);
    expect(hasEditor()).toBe(false);
    expect(firstNote().dataset.editing).toBe("false");
    expect(firstNote().dataset.selected).toBe("true");
    expect(snapshot(doc)[0].text).toBe(RETRO_ITEM);
    expect(firstNote().textContent).toContain(RETRO_ITEM.slice(0, 12));
  });

  it("TC-26: Backspace while editing edits the text and never deletes the note", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await user.type(editorEl(), "ab");
    await settle();
    expect(snapshot(doc)[0].text).toBe("ab");

    await user.keyboard("{Backspace}");
    await settle();

    expect(notesPresent()).toBe(1);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].text).toBe("a");
    expect(hasEditor()).toBe(true);
  });

  it("TC-38: a click outside ends editing, keeps typed text and clears selection", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await user.type(editorEl(), "abc");
    await settle();

    clickEmptyBoard(90, 90);
    await settle();

    expect(hasEditor()).toBe(false);
    expect(snapshot(doc)[0].text).toBe("abc");
    expect(firstNote().dataset.selected).toBe("false");
    expect(firstNote().dataset.editing).toBe("false");
  });

  it("editing writes to the document on every input event, not only on exit", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();

    const updates = await countUpdates(doc, async () => {
      await user.type(editorEl(), "written while editing");
      await settle();
    });
    expect(updates).toBeGreaterThan(1);
    expect(snapshot(doc)[0].text).toBe("written while editing");

    // Leaving editing writes nothing more.
    const exitUpdates = await countUpdates(doc, async () => {
      keydownOnFocused("Escape");
      await settle();
    });
    expect(exitUpdates).toBe(0);
  });

  it("Enter inside the note adds a line instead of ending editing", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await user.type(editorEl(), "two{Enter}lines");
    await settle();

    expect(snapshot(doc)[0].text).toBe("two\nlines");
    expect(hasEditor()).toBe(true);
    expect(firstNote().dataset.editing).toBe("true");
  });

  it("a 1,200 character paste is clamped to 1,000 and the caret is restored", async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();

    await pasteIntoEditor(PROSE_1200);
    await settle();

    expect(snapshot(doc)[0].text).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(snapshot(doc)[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);
    const area = editorEl();
    expect(area.value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(area.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId("sticky-char-counter").textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it("typing at the limit adds nothing, Backspace then frees room", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    await pasteIntoEditor("x".repeat(STICKY_TEXT_MAX_CHARS));
    await settle();

    await user.type(editorEl(), "abc");
    await settle();
    expect(snapshot(doc)[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);

    await user.keyboard("{Backspace}");
    await settle();
    expect(snapshot(doc)[0].text.length).toBe(STICKY_TEXT_MAX_CHARS - 1);

    await user.type(editorEl(), "abc");
    await settle();
    expect(snapshot(doc)[0].text.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it(`the counter appears when ${STICKY_COUNTER_THRESHOLD_CHARS} or fewer characters remain`, async () => {
    createNoteAt({ x: 600, y: 400 });
    await settle();

    const boundary = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    for (const length of [boundary - 1, boundary, boundary + 1]) {
      await pasteIntoEditor("y".repeat(length));
      await settle();
      const counter = screen.queryByTestId("sticky-char-counter");
      expect(snapshot(doc)[0].text.length).toBe(length);
      if (length >= boundary) {
        expect(counter?.textContent).toBe(`${length}/${STICKY_TEXT_MAX_CHARS}`);
      } else {
        expect(counter).toBeNull();
      }
    }
  });

  it("editing a note never creates another one and never moves it", async () => {
    const user = userEvent.setup({ delay: null });
    createNoteAt({ x: 600, y: 400 });
    await settle();
    const position = { ...snapshot(doc)[0] };

    await user.type(editorEl(), "typing does not move or multiply notes");
    await settle();
    dblclick(firstNote(), noteCentreOnScreen(firstNote()).x, noteCentreOnScreen(firstNote()).y);
    await settle();
    pressNote(firstNote());
    await settle();

    expect(notesPresent()).toBe(1);
    expect(snapshot(doc)[0].x).toBeCloseTo(position.x, 9);
    expect(snapshot(doc)[0].y).toBeCloseTo(position.y, 9);
    expect(snapshot(doc)[0].z).toBe(position.z);
  });

  function notesPresent(): number {
    return document.querySelectorAll(".sticky-note").length;
  }
});
