import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/client/App";
import { createSticky, getStickyText, type StickySnapshot } from "../../src/shared/board-model";
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from "../../src/shared/config";
import {
  MULTILINE_RETRO_TEXT,
  PASTE_1200,
  PROSE_1000,
  SHORT_NOTE_TEXT,
  TYPED_GREETING,
} from "../fixtures/texts";

/**
 * ui-component tests for sticky note text editing (sticky.text):
 * TC-23, TC-24, TC-26, TC-38, plus the typing paths of TC-14 to TC-17.
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

function editorEl(): HTMLTextAreaElement {
  return screen.getByTestId("sticky-text-editor") as HTMLTextAreaElement;
}

function editorOrNull(): HTMLTextAreaElement | null {
  return screen.queryByTestId("sticky-text-editor") as HTMLTextAreaElement | null;
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function addNote(x = 0, y = 0, text = ""): string {
  const api = boardApi();
  const created: string[] = [];
  act(() => {
    const id = createSticky(api.doc, { x, y });
    if (id === null) return;
    if (text.length > 0) getStickyText(api.doc, id)?.insert(0, text);
    created.push(id);
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

/** Notes added through the model are ordinary notes: editing starts on double-click. */
async function startEditing() {
  fireEvent.doubleClick(noteEl());
  await settle();
}

/** What a browser does for one typed character. */
function typeInto(el: HTMLTextAreaElement, value: string) {
  fireEvent.input(el, { target: { value } });
}

describe("sticky note text editing", () => {
  beforeEach(() => {
    setWindowSize(VIEWPORT.width, VIEWPORT.height);
    render(<App />);
  });

  it("TC-23: Enter on a selected note starts editing with the caret at the end", async () => {
    addNote(0, 0, SHORT_NOTE_TEXT);
    await selectNote();

    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
    await settle();

    const editor = editorEl();
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe(SHORT_NOTE_TEXT);
    expect(editor.selectionStart).toBe(SHORT_NOTE_TEXT.length);
    expect(editor.selectionEnd).toBe(SHORT_NOTE_TEXT.length);
    // While editing there is no toolbar and no separate text element.
    expect(screen.queryByTestId("note-toolbar")).toBeNull();
    expect(screen.queryByTestId("sticky-text")).toBeNull();
  });

  it("TC-24: Escape ends editing and keeps the note selected with its text", async () => {
    const id = addNote(0, 0);
    await selectNote();
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
    await settle();

    typeInto(editorEl(), SHORT_NOTE_TEXT);
    await settle();
    expect(note().text).toBe(SHORT_NOTE_TEXT);

    fireEvent.keyDown(editorEl(), { key: "Escape", code: "Escape" });
    await settle();

    expect(editorOrNull()).toBeNull();
    expect(noteEl().dataset.selected).toBe("true");
    expect(notes().find((item) => item.id === id)!.text).toBe(SHORT_NOTE_TEXT);
    // Escape does not delete anything.
    expect(notes()).toHaveLength(1);
  });

  it("TC-26: Backspace while editing edits text and never deletes the note", async () => {
    addNote(0, 0, "ab");
    await selectNote();
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
    await settle();

    const editor = editorEl();
    fireEvent.keyDown(editor, { key: "Backspace", code: "Backspace" });
    // The browser's own edit of the value, which the editor writes to Y.Text.
    typeInto(editor, "a");
    await settle();

    expect(notes()).toHaveLength(1);
    expect(note().text).toBe("a");
    expect(editorOrNull()).toBeTruthy(); // still editing
  });

  it("TC-26: Delete while editing is text, not a note deletion", async () => {
    addNote(0, 0, "ab");
    await selectNote();
    fireEvent.doubleClick(noteEl());
    await settle();

    const editor = editorEl();
    fireEvent.keyDown(editor, { key: "Delete", code: "Delete" });
    typeInto(editor, "b");
    await settle();

    expect(notes()).toHaveLength(1);
    expect(note().text).toBe("b");
  });

  it("TC-38: typing then clicking outside keeps the text and clears the selection", async () => {
    const id = addNote(0, 0);
    await startEditing();

    typeInto(editorEl(), TYPED_GREETING);
    await settle();
    expect(note().text).toBe(TYPED_GREETING);

    pointer("pointerdown", screen.getByTestId("board-viewport"), 700, 700);
    pointer("pointerup", screen.getByTestId("board-viewport"), 700, 700);
    await settle();

    expect(editorOrNull()).toBeNull();
    expect(notes().find((item) => item.id === id)!.text).toBe(TYPED_GREETING);
    expect(noteEl().dataset.selected).toBe("false");
  });

  it("a click inside the note being edited keeps it in edit mode", async () => {
    addNote(0, 0);
    await startEditing();
    fireEvent.input(editorEl(), { target: { value: "half typed" } });
    await settle();

    pointer("pointerdown", noteEl(), 160, 160);
    await settle();

    expect(editorOrNull()).toBeTruthy();
    expect(editorEl().value).toBe("half typed");
  });

  it("text typed on separate keystrokes accumulates in the note", async () => {
    addNote(0, 0);
    await startEditing();
    let value = "";
    for (const character of "Faster") {
      value += character;
      typeInto(editorEl(), value);
    }
    await settle();
    expect(note().text).toBe("Faster");
  });

  it("Enter inside the editor adds a new line", async () => {
    addNote(0, 0);
    await startEditing();
    const editor = editorEl();
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" });
    typeInto(editor, MULTILINE_RETRO_TEXT);
    await settle();

    expect(note().text).toBe(MULTILINE_RETRO_TEXT);
    expect(note().text.split("\n")).toHaveLength(3);
    expect(editorOrNull()).toBeTruthy();
  });

  it("TC-14 typing path: a 1,200 character paste keeps exactly 1,000 characters", async () => {
    addNote(0, 0);
    await startEditing();
    typeInto(editorEl(), PASTE_1200);
    await settle();

    const editor = editorEl();
    expect(editor.value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editor.value).toBe(PROSE_1000);
    expect(note().text.length).toBe(STICKY_TEXT_MAX_CHARS);
    // Caret restored to the end of the text that was kept.
    expect(editor.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editor.selectionEnd).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId("sticky-counter").textContent).toBe("1000/1000");
  });

  it("TC-16 typing path: a character typed at the limit is dropped", async () => {
    addNote(0, 0, PROSE_1000);
    expect(editorOrNull()).toBeNull();
    await selectNote();
    fireEvent.doubleClick(noteEl());
    await settle();

    const editor = editorEl();
    typeInto(editor, `${PROSE_1000}!`);
    await settle();

    expect(editor.value).toBe(PROSE_1000);
    expect(note().text).toBe(PROSE_1000);
  });

  it("TC-17 typing path: the counter appears at 50 characters left", async () => {
    const text = PROSE_1000.slice(0, STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1);
    addNote(0, 0, text);
    await selectNote();
    fireEvent.doubleClick(noteEl());
    await settle();

    expect(screen.queryByTestId("sticky-counter")).toBeNull();

    typeInto(editorEl(), `${text}x`); // now exactly 50 characters remain
    await settle();
    expect(screen.getByTestId("sticky-counter").textContent).toBe("950/1000");
  });

  it("IME composition is written once, on compositionend", async () => {
    addNote(0, 0);
    await startEditing();
    const editor = editorEl();
    fireEvent.compositionStart(editor);
    editor.value = "x";
    fireEvent.input(editor); // ignored while composing
    editor.value = "こんにちは";
    fireEvent.input(editor); // ignored while composing
    expect(notes()[0]!.text).toBe("");

    fireEvent.compositionEnd(editor);
    await settle();

    expect(note().text).toBe("こんにちは");
  });

  it("deleting every character leaves an empty note, not a removed note", async () => {
    addNote(0, 0, SHORT_NOTE_TEXT);
    await startEditing();

    typeInto(editorEl(), "");
    await settle();

    expect(notes()).toHaveLength(1);
    expect(note().text).toBe("");
  });
});
