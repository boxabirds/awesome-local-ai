import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { createSticky, getStickyText, snapshot } from "../../src/shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import {
  IME_COMPOSITION_SEQUENCE,
  PASTE_TEXT_1200,
  REPEATED_WORD_TEXT,
  SHORT_NOTE_TEXT,
  TEXT_900,
  TEXT_960,
} from "../fixtures/texts";

/**
 * ui-component tests for sticky.text_editing (TC-13, TC-23, TC-26, TC-38 and the
 * character-limit behaviour).
 *
 * The notes start as `SHORT_NOTE_TEXT` (17 characters), so anything typed on
 * top of it produces a measurable length change, as the test plan asks.
 */

const VIEWPORT = { width: 1200, height: 800 };
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

function addNote(x: number, y: number, text?: string): string {
  let id = "";
  act(() => {
    id = createSticky(doc, { x, y });
    if (text !== undefined) getStickyText(doc, id)?.insert(0, text);
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

function textarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Sticky note text" }) as HTMLTextAreaElement;
}

async function startEditing(id: string) {
  fireEvent.doubleClick(noteEl(id));
  await settle();
}

/** What the browser does when a key is pressed: the value changes, then input fires. */
function typeInto(el: HTMLTextAreaElement, value: string) {
  fireEvent.change(el, { target: { value } });
}

function documentText(id = noteIds()[0]): string {
  const note = snapshot(doc).find((candidate) => candidate.id === id);
  return note ? note.text : "";
}

function noteIds(): string[] {
  return snapshot(doc).map((note) => note.id);
}

function counterText(id: string): string | null {
  const el = noteEl(id).querySelector("[data-testid='sticky-counter']");
  return el ? el.textContent : null;
}

beforeEach(() => {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  doc = new Y.Doc();
  render(<App doc={doc} />);
});

describe("typing in a sticky note", () => {
  it("TC-13: typing appends to the text and never duplicates it", async () => {
    const id = addNote(0, 0, "Design ");
    await startEditing(id);

    typeInto(textarea(), "Design better");
    await settle();

    expect(documentText(id)).toBe("Design better");
    // A remote observer sees one append, not a rewrite of the whole text.
    expect(getStickyText(doc, id)!.toString()).toBe("Design better");
  });

  it("TC-13 (repeated word): a pasted repetition lands in the document once", async () => {
    const id = addNote(0, 0, SHORT_NOTE_TEXT);
    await startEditing(id);

    typeInto(textarea(), SHORT_NOTE_TEXT + REPEATED_WORD_TEXT);
    await settle();

    expect(documentText(id)).toBe(SHORT_NOTE_TEXT + REPEATED_WORD_TEXT);
  });

  it("TC-23: Enter on a selected note starts editing with the caret at the end", async () => {
    const id = addNote(0, 0, SHORT_NOTE_TEXT);
    fireEvent.pointerDown(noteEl(id), { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 300 });
    fireEvent.pointerUp(noteEl(id), { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 300 });

    fireEvent.keyDown(document.body, { key: "Enter" });
    await settle();

    const el = textarea();
    expect(el.value).toBe(SHORT_NOTE_TEXT);
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(SHORT_NOTE_TEXT.length);
    expect(el.selectionEnd).toBe(SHORT_NOTE_TEXT.length);
    // While editing, the floating toolbar is hidden.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
  });

  it("TC-26: Backspace while editing edits the text and never deletes the note", async () => {
    const id = addNote(0, 0, "ab");
    await startEditing(id);

    fireEvent.keyDown(textarea(), { key: "Backspace" });
    expect(snapshot(doc)).toHaveLength(1);
    expect(documentText(id)).toBe("ab");

    // What a Backspace key actually does to the field.
    typeInto(textarea(), "a");
    await settle();

    expect(snapshot(doc)).toHaveLength(1);
    expect(documentText(id)).toBe("a");
  });

  it("TC-38: typing then clicking outside writes the text and ends editing", async () => {
    const id = addNote(0, 0, SHORT_NOTE_TEXT);
    await startEditing(id);

    typeInto(textarea(), SHORT_NOTE_TEXT + "abc");
    await settle();

    const viewport = screen.getByTestId("board-viewport");
    fireEvent.pointerDown(viewport, { pointerId: 2, pointerType: "mouse", clientX: 900, clientY: 700 });
    fireEvent.pointerUp(viewport, { pointerId: 2, pointerType: "mouse", clientX: 900, clientY: 700 });
    await settle();

    expect(documentText(id)).toBe(SHORT_NOTE_TEXT + "abc");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(noteEl(id).getAttribute("data-selected")).toBe("false");
  });

  it("IME composition writes the text as it is committed and stays in Editing", async () => {
    const id = addNote(0, 0, SHORT_NOTE_TEXT);
    await startEditing(id);
    const el = textarea();

    fireEvent.compositionStart(el);
    typeInto(el, IME_COMPOSITION_SEQUENCE);
    fireEvent.compositionEnd(el);
    await settle();

    expect(documentText(id)).toBe(IME_COMPOSITION_SEQUENCE);
    expect(screen.getByRole("textbox", { name: "Sticky note text" })).toBeTruthy();
  });

  it("an in-app undo does not roll back the collaborative text", async () => {
    const id = addNote(0, 0, SHORT_NOTE_TEXT);
    // A remote peer's undo manager, i.e. one that undoes only *remote* changes.
    const remoteUndo = new Y.UndoManager(getStickyText(doc, id)!, { captureTimeout: 0 });
    const undoableBefore = remoteUndo.undoStack.length;

    await startEditing(id);
    typeInto(textarea(), SHORT_NOTE_TEXT + " fast");
    await settle();

    expect(documentText(id)).toBe(SHORT_NOTE_TEXT + " fast");
    // The local typing is not in the remote undo stack, so undo cannot roll it back.
    expect(remoteUndo.undoStack.length).toBe(undoableBefore);
    remoteUndo.undo();
    expect(documentText(id)).toBe(SHORT_NOTE_TEXT + " fast");
    remoteUndo.destroy();
  });
});

describe("the 1000 character limit", () => {
  it("clamps typed input to STICKY_TEXT_MAX_CHARS and shows the counter", async () => {
    expect(STICKY_TEXT_MAX_CHARS).toBe(1000);
    const id = addNote(0, 0, "");
    await startEditing(id);

    typeInto(textarea(), PASTE_TEXT_1200);
    await settle();

    expect(documentText(id).length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(textarea().value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(counterText(id)).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it("the counter appears within 50 characters of the limit and not before", async () => {
    const near = addNote(0, 0, TEXT_960);
    const short = addNote(600, 0, SHORT_NOTE_TEXT);

    await startEditing(near);
    expect(counterText(near)).toBe(`${TEXT_960.length}/${STICKY_TEXT_MAX_CHARS}`);

    fireEvent.keyDown(textarea(), { key: "Escape" });
    await settle();

    await startEditing(short);
    expect(counterText(short)).toBeNull();
  });

  it("the counter shows in the read state too, before any typing happens", () => {
    addNote(0, 0, TEXT_960);
    addNote(600, 0, TEXT_900);
    const counters = document.querySelectorAll("[data-testid='sticky-counter']");
    // Only the note that is within 50 characters of the limit shows one.
    expect(counters.length).toBe(1);
    expect(counters[0].textContent).toBe(`${TEXT_960.length}/${STICKY_TEXT_MAX_CHARS}`);
  });
});
