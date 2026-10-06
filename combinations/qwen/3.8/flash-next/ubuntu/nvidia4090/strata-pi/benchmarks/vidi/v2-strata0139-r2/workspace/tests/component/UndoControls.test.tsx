import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type * as Y from "yjs";
import { getStickyText, snapshot } from "../../src/shared/board-model";
import {
  addNote,
  changeModel,
  objectCount,
  pressKey,
  readBox,
  render,
  renderBoard,
  runAnimationFramesSynchronously,
  type RenderHandle,
} from "./boardFixture";
import type { UndoController } from "../../src/client/board/undo";

/**
 * Story 8, task 11 (TC-18 to TC-21) — the shortcuts and the toolbar buttons.
 *
 * The buttons and the keyboard are two doors to the same room: this tab's own
 * history. TC-18 is the real `App`, whose buttons show what its own controller
 * holds. TC-19 to TC-21 run against a spy history, which is the only way to
 * name the calls the keyboard makes — and to prove the ones it must not make.
 *
 * `pressKey` returns `false` exactly when the board called `preventDefault`, so
 * every case below says both *what was called* and *what the browser was left to
 * do on its own*.
 */

interface FakeHistory extends UndoController {
  readonly calls: { undo: number; redo: number; boundary: number };
  setStacks(undoSteps: number, redoSteps: number): void;
}

function fakeHistory(start: { undo: number; redo: number } = { undo: 0, redo: 0 }): FakeHistory {
  const stacks = { ...start };
  const listeners = new Set<() => void>();
  const calls = { undo: 0, redo: 0, boundary: 0 };
  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const controller: FakeHistory = {
    calls,
    setStacks(undoSteps: number, redoSteps: number) {
      stacks.undo = undoSteps;
      stacks.redo = redoSteps;
      emit();
    },
    undo: vi.fn(() => {
      calls.undo += 1;
      if (stacks.undo === 0) return false;
      stacks.undo -= 1;
      stacks.redo += 1;
      emit();
      return true;
    }),
    redo: vi.fn(() => {
      calls.redo += 1;
      if (stacks.redo === 0) return false;
      stacks.redo -= 1;
      stacks.undo += 1;
      emit();
      return true;
    }),
    boundary: vi.fn(() => {
      calls.boundary += 1;
    }),
    canUndo: () => stacks.undo > 0,
    canRedo: () => stacks.redo > 0,
    addScope: vi.fn(),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy: vi.fn(),
  };
  return controller;
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement;
}

describe("undo.controls: shortcuts and toolbar buttons", () => {
  let board: RenderHandle | undefined;
  let history: FakeHistory | undefined;

  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    board?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("TC-18 with nothing to undo, both buttons are disabled", () => {
    // The real board: its history holds only what this tab has done, and it has
    // done nothing.
    board = render();

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().getAttribute("aria-disabled")).toBe("true");
    expect(redoButton().getAttribute("aria-disabled")).toBe("true");

    // The tooltips are where the shortcut is written down.
    expect(undoButton().title).toContain("Ctrl/Cmd+Z");
    expect(redoButton().title).toContain("Ctrl/Cmd+Shift+Z");

    // A change this tab makes enables Undo, and nothing else.
    addNote(board, { x: 100, y: 100 });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it("TC-19 Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; each one is prevented", () => {
    history = fakeHistory({ undo: 2, redo: 2 });
    board = renderBoard({ undo: history });

    expect(pressKey("z", document.body, { ctrlKey: true })).toBe(false);
    expect(history.calls.undo).toBe(1);
    expect(history.calls.redo).toBe(0);

    expect(pressKey("z", document.body, { metaKey: true })).toBe(false);
    expect(history.calls.undo).toBe(2);

    expect(pressKey("z", document.body, { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(history.calls.redo).toBe(1);

    expect(pressKey("z", document.body, { metaKey: true, shiftKey: true })).toBe(false);
    expect(history.calls.redo).toBe(2);

    expect(pressKey("y", document.body, { ctrlKey: true })).toBe(false);
    expect(history.calls.redo).toBe(3);
    expect(history.calls.undo).toBe(2);

    // Cmd+Y is not the board's: the browser keeps it.
    expect(pressKey("y", document.body, { metaKey: true })).toBe(true);
    expect(history.calls.redo).toBe(3);
  });

  it("TC-18 the button state follows the history, and the keyboard reaches the same one", () => {
    board = render();
    addNote(board, { x: 100, y: 100 });

    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    expect(pressKey("z", document.body, { ctrlKey: true })).toBe(false);
    expect(objectCount(board.doc)).toBe(0);
    // The buttons re-render when the stacks change, because the controller says so.
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    expect(pressKey("y", document.body, { ctrlKey: true })).toBe(false);
    expect(objectCount(board.doc)).toBe(1);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it("TC-20 a board this client may not write to cannot be undone, and its buttons say so", () => {
    board = render({ canEdit: false });

    // A step this tab made, so the buttons would be enabled on a board it may edit.
    addNote(board, { x: 100, y: 100 });
    const before = readBox(board.doc, onlyNoteId(board.doc));

    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    // Refused means refused: the board does not even take the key over.
    expect(pressKey("z", document.body, { ctrlKey: true })).toBe(true);
    expect(pressKey("z", document.body, { ctrlKey: true, shiftKey: true })).toBe(true);

    // Nothing moved: the undo keys were refused, and the note stayed put.
    expect(readBox(board.doc, onlyNoteId(board.doc))).toEqual(before);
    expect(objectCount(board.doc)).toBe(1);
  });

  it("TC-20 the keyboard refuses undo on a board it may not write to", () => {
    history = fakeHistory({ undo: 3, redo: 3 });
    board = renderBoard({ canEdit: false, undo: history });

    pressKey("z", document.body, { ctrlKey: true });
    pressKey("z", document.body, { ctrlKey: true, shiftKey: true });
    pressKey("y", document.body, { ctrlKey: true });

    expect(history.calls.undo).toBe(0);
    expect(history.calls.redo).toBe(0);
  });

  it("TC-21 Ctrl+Z while focus is in an ordinary field is left to that field", () => {
    history = fakeHistory({ undo: 3, redo: 3 });
    board = renderBoard({ undo: history });

    const field = document.createElement("input");
    field.setAttribute("aria-label", "Board link");
    field.value = "https://board.example/b/abc";
    document.body.append(field);
    field.focus();

    expect(pressKey("z", field, { ctrlKey: true })).toBe(true);
    expect(pressKey("z", field, { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(pressKey("y", field, { ctrlKey: true })).toBe(true);

    expect(history.calls.undo).toBe(0);
    expect(history.calls.redo).toBe(0);

    // The field still has its own text to undo, and the board has its own focus.
    expect(field.value).toBe("https://board.example/b/abc");
    field.remove();
  });

  it("TC-21 Ctrl+Z while a note is being typed into belongs to that note", () => {
    history = fakeHistory({ undo: 3, redo: 0 });
    const handle = renderBoard({ undo: history });
    board = handle;
    const id = addNote(handle, { x: 100, y: 100 }, "yellow", "hello");
    changeModel(() => {
      handle.selection().startEdit(id);
    });

    const field = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "hello world" } });
    field.focus();

    // The editor answers the key itself (see `undo.boundaries` TC-16) and the
    // board's keyboard stays out of it: exactly one undo, not two.
    expect(pressKey("z", field, { ctrlKey: true })).toBe(false);
    expect(history.calls.undo).toBe(1);
    expect(getStickyText(handle.doc, id)?.toString()).toBe("hello world");
  });

  it("the keyboard still answers the board when focus is on the board itself", () => {
    history = fakeHistory({ undo: 1, redo: 0 });
    const handle = renderBoard({ undo: history });
    board = handle;
    addNote(handle, { x: 100, y: 100 });

    expect(pressKey("z", handle.screen.getByTestId("board-viewport"), { ctrlKey: true })).toBe(false);
    expect(history.calls.undo).toBe(1);
  });
});

function onlyNoteId(doc: Y.Doc): string {
  const first = (snapshot(doc)[0] as { id: string } | undefined)?.id;
  if (!first) throw new Error("the board has no note");
  return first;
}
