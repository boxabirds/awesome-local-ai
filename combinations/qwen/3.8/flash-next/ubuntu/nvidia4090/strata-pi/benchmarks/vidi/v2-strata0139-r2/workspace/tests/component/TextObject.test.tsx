import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { createSticky, deleteObjects, snapshot } from "../../src/shared/board-model";
import { createText } from "../../src/shared/objects/text";
import { getTextContent } from "../../src/shared/objects/text";
import { TEXT_LINE_HEIGHT, TEXT_SIZES } from "../../src/shared/config";
import { remeasureTextBox } from "../../src/client/objects/useTextBoxSync";
import type { ObjectSnapshot } from "../../src/shared/board-model";
import {
  changeModel,
  dragHandle,
  objectById,
  pressKey,
  readBox,
  readObjects,
  render,
  runAnimationFramesSynchronously,
  selectedIds,
} from "./boardFixture";


/**
 * Story 9, task 9 - editing, the editor and the text's own toolbar (TC-19 to
 * TC-25).
 *
 * A text object is the board's only object that is being typed into the moment
 * it is created, and the only one that writes its own box.
 */

beforeEach(() => {
  runAnimationFramesSynchronously();
});

type Board = ReturnType<typeof render>;

/** The box of an object, read from the document (never optional numbers). */
function boxOf(board: Board, id: string): { x: number; y: number; width: number; height: number } {
  return readBox(board.doc, id);
}

function textById(board: Board, id: string): ObjectSnapshot | undefined {
  return readObjects(board.doc).find((object) => object.id === id);
}

function addText(board: Board, at: { x: number; y: number }, text = ""): string {
  let id = "";
  changeModel(() => {
    const created = createText(board.doc, at);
    if (typeof created !== "string") throw new Error("createText rejected the point");
    id = created;
    if (text) {
      const field = getTextContent(board.doc, id);
      if (!field) throw new Error("the text object has no content field");
      field.insert(0, text);
    }
    // The creating client measures the box it just wrote, exactly as it does in
    // the browser.
    remeasureTextBox(board.doc, id);
  });
  return id;
}

/** A sticky note centred on a world point. */
function addSticky(board: Board, at: { x: number; y: number }): string {
  let id = "";
  changeModel(() => {
    const created = createSticky(board.doc, at);
    if (typeof created !== "string") throw new Error("createSticky rejected the point");
    id = created;
  });
  return id;
}

function selectObject(board: Board, id: string, additive = false): void {
  const element = objectById(board.screen, id);
  const shift = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100, shiftKey: additive };
  fireEvent.pointerDown(element, shift);
  fireEvent.pointerUp(element, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
}

function startEditing(board: Board, id: string): HTMLTextAreaElement {
  selectObject(board, id);
  fireEvent.doubleClick(objectById(board.screen, id));
  return board.screen.getByTestId("text-object-input") as HTMLTextAreaElement;
}

function typeInto(input: HTMLTextAreaElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("text.edit.begin: caret and newlines (TC-19)", () => {
  it("TC-19 the caret goes to the end, Enter is a newline, and Escape leaves the text selected", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 50, y: 50 }, "hello");

    const input = startEditing(board, id);
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.value).toBe("hello");
    // The caret is at the end of the existing content, ready to continue.
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);

    // Enter belongs to the field: the board neither swallows it nor leaves the
    // object because of it.
    expect(fireEvent.keyDown(input, { key: "Enter", code: "Enter" })).toBe(true);
    typeInto(input, "hello\nworld");

    const afterNewline = textById(board, id);
    expect(afterNewline?.text).toBe("hello\nworld");
    // The box grew to two lines without touching the position.
    expect(afterNewline?.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);
    expect(afterNewline?.x).toBeCloseTo(50, 6);
    expect(afterNewline?.y).toBeCloseTo(50, 6);

    pressKey("Escape", input);
    expect(screen.queryByTestId("text-object-input")).toBeNull();
    // The text is finished but still selected: the next Escape clears it.
    expect(selectedIds(screen)).toEqual([id]);
    expect(textById(board, id)?.text).toBe("hello\nworld");
  });
});

describe("text.edit.begin: the first Escape on empty text (TC-20)", () => {
  it("TC-20 Escape with no characters removes the object and clears the selection", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 200, y: 120 });

    const input = startEditing(board, id);
    expect(input.value).toBe("");
    expect(selectedIds(screen)).toEqual([id]);

    pressKey("Escape", input);

    expect(screen.queryByTestId("text-object-input")).toBeNull();
    expect(screen.queryByTestId("text-object")).toBeNull();
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(selectedIds(screen)).toEqual([]);
  });

  it("text that only holds spaces is content, so the object stays on the board", () => {
    const board = render();
    const id = addText(board, { x: 20, y: 20 });

    const input = startEditing(board, id);
    typeInto(input, "   \n ");
    expect(textById(board, id)?.text).toBe("   \n ");

    pressKey("Escape", input);
    expect(snapshot(board.doc)).toHaveLength(1);
    expect(textById(board, id)?.text).toBe("   \n ");
    // The object is finished and still selected, like any other finished text.
    expect(selectedIds(board.screen)).toEqual([id]);
  });
});

describe("text.size: the Text toolbar (TC-21)", () => {
  it("TC-21 S M L XL, the current one pressed, and choosing XL keeps the text where it is", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 120, y: 90 }, "Status board");

    selectObject(board, id);
    const toolbar = screen.getByTestId("text-toolbar");
    const small = screen.getByTestId("text-size-S");
    const medium = screen.getByTestId("text-size-M");
    const large = screen.getByTestId("text-size-L");
    const extra = screen.getByTestId("text-size-XL");
    expect(toolbar).toBeTruthy();
    expect(small.getAttribute("aria-pressed")).toBe("false");
    expect(medium.getAttribute("aria-pressed")).toBe("true");
    expect(large.getAttribute("aria-pressed")).toBe("false");
    expect(extra.getAttribute("aria-pressed")).toBe("false");

    const before = textById(board, id);
    fireEvent.click(extra);

    const after = textById(board, id);
    expect(after?.size).toBe("XL");
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 6);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 6);
    expect(after?.text).toBe("Status board");
    // The size is pressed, and the object is drawn at the preset's font size.
    expect(screen.getByTestId("text-size-XL").getAttribute("aria-pressed")).toBe("true");
    const object = objectById(screen, id);
    expect(object.style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    // Height followed the new size.
    expect(after?.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);
  });

  it("the Text toolbar is not shown while the text is being typed into", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 120, y: 90 }, "Status board");

    startEditing(board, id);
    expect(screen.queryByTestId("text-toolbar")).toBeNull();
    expect(screen.getByTestId("text-object-input")).toBeTruthy();
  });

  it("the Text toolbar's Delete removes the text object", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 10, y: 10 }, "temporary");

    selectObject(board, id);
    fireEvent.click(screen.getByTestId("text-delete"));
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(selectedIds(screen)).toEqual([]);
  });
});

describe("text.resize: only the two sides (TC-22)", () => {
  it("TC-22 one text selected shows only the west and east handles", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 100, y: 100 }, "A long enough line of text to be wider than it is tall");

    selectObject(board, id);
    const handles = Array.from(screen.container.querySelectorAll("[data-handle]")).map(
      (element) => (element as HTMLElement).dataset.handle,
    );
    expect(handles.sort()).toEqual(["e", "w"]);
  });

  it("dragging the east handle fixes the width, wraps the text and grows the height", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 0, y: 0 }, "alpha beta gamma delta epsilon zeta eta theta");

    selectObject(board, id);
    const before = textById(board, id);
    if (!before) throw new Error("the text object is gone");
    expect(before.widthMode).toBe("auto");

    dragHandle(screen, "e", { x: 500, y: 300 }, { x: 140, y: 300 });

    const after = textById(board, id);
    if (!after) throw new Error("the text object is gone");
    expect(after.widthMode).toBe("fixed");
    // The screen delta is the width delta at zoom 1, and the minimum width holds.
    // The screen delta is the width delta at zoom 1, and the minimum width holds.
    expect(after.width ?? 0).toBeCloseTo((before.width ?? 0) - 360, 6);
    expect(after.height ?? 0).toBeGreaterThan(before.height ?? 0);
    expect(after.text).toBe("alpha beta gamma delta epsilon zeta eta theta");
  });

  it("dragging the west handle keeps the east edge still", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 300, y: 300 }, "alpha beta gamma delta epsilon zeta");

    selectObject(board, id);
    const before = textById(board, id);
    if (!before) throw new Error("the text object is gone");
    const east = (before.x ?? 0) + (before.width ?? 0);

    dragHandle(screen, "w", { x: 400, y: 300 }, { x: 460, y: 300 });

    const after = textById(board, id);
    if (!after) throw new Error("the text object is gone");
    expect(after.widthMode).toBe("fixed");
    expect((after.x ?? 0) + (after.width ?? 0)).toBeCloseTo(east, 6);
    expect(after.width ?? 0).toBeLessThan(before.width ?? 0);
  });
});

describe("selection.overlay.resize.mixed: text with a sticky note (TC-23)", () => {
  it("TC-23 a mixed selection shows every handle, moves the text proportionally and never changes its size", () => {
    const board = render();
    const screen = board.screen;

    const stickyId = addSticky(board, { x: 0, y: 0 });
    const textId = addText(board, { x: 300, y: 300 }, "quick brown fox jumps");

    selectObject(board, textId);
    selectObject(board, stickyId, true);

    const handles = Array.from(screen.container.querySelectorAll("[data-handle]")).map(
      (element) => (element as HTMLElement).dataset.handle,
    );
    expect(handles.sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);

    const stickyBefore = boxOf(board, stickyId);
    const textBefore = boxOf(board, textId);
    if (!stickyBefore || !textBefore) throw new Error("a selected object is gone");
    const boxBefore = unionOf([stickyBefore, textBefore]);

    dragHandle(screen, "se", { x: 700, y: 700 }, { x: 600, y: 600 });

    const stickyAfter = boxOf(board, stickyId);
    const textAfter = boxOf(board, textId);
    if (!stickyAfter || !textAfter) throw new Error("a selected object is gone");

    // The scale the whole group moved by, read off the sticky note.
    const scale = stickyAfter.width / stickyBefore.width;
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0);

    // The text moved by the same proportion, from the same corner of the box.
    expect(textAfter.x).toBeCloseTo(boxBefore.x + (textBefore.x - boxBefore.x) * scale, 6);
    expect(textAfter.y).toBeCloseTo(boxBefore.y + (textBefore.y - boxBefore.y) * scale, 6);

    // Its font size is untouched, and so is the width its content chose.
    const text = textById(board, textId);
    expect(text?.size).toBe("M");
    expect(objectById(screen, textId).style.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(textAfter.width).toBeCloseTo(textBefore.width, 6);
  });
});

describe("presence.cursor.conflict: remote deletion during editing (TC-24)", () => {
  it("TC-24 a remote delete while editing closes the editor and does not bring the object back", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 100, y: 100 }, "written by someone else");

    const input = startEditing(board, id);
    typeInto(input, "written by someone else and then edited here");

    // The delete arrives as a remote change.
    changeModel(() => {
      deleteObjects(board.doc, [id]);
    });

    expect(screen.queryByTestId("text-object-input")).toBeNull();
    expect(screen.queryByTestId("text-object")).toBeNull();
    expect(snapshot(board.doc)).toHaveLength(0);

    // Nothing re-creates it: not the end of editing, not a further render.
    pressKey("Escape");
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(screen.queryByTestId("text-object")).toBeNull();
    expect(input.isConnected).toBe(false);
  });
});

describe("undo.sticky: text and box undo as one step (TC-25)", () => {
  it("TC-25 one Ctrl+Z reverts the text and the stored box together", () => {
    const board = render();
    const screen = board.screen;
    const id = addText(board, { x: 0, y: 0 }, "short");

    const before = textById(board, id);
    if (!before) throw new Error("the text object is gone");

    const input = startEditing(board, id);
    typeInto(input, "a considerably longer line of text that needs several lines to fit");

    const during = textById(board, id);
    if (!during) throw new Error("the text object is gone");
    expect(during.text).toBe("a considerably longer line of text that needs several lines to fit");
    expect(during.height ?? 0).toBeGreaterThan(before.height ?? 0);

    // The keystroke that undoes is typed inside the editor, like anywhere else.
    fireEvent.keyDown(input, { key: "z", code: "z", ctrlKey: true });

    const after = textById(board, id);
    if (!after) throw new Error("the text object is gone");
    expect(after.text).toBe("short");
    // Text and box are one undo step: the box is back where it was too.
    expect(after.width).toBeCloseTo(before.width ?? 0, 6);
    expect(after.height).toBeCloseTo(before.height ?? 0, 6);
    expect(screen.getByTestId("text-object-input")).toBeTruthy();
  });
});

// ---- helpers --------------------------------------------------------------

function unionOf(rects: Array<{ x: number; y: number; width: number; height: number } | null>) {
  const known = rects.filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== null);
  const left = Math.min(...known.map((rect) => rect.x));
  const top = Math.min(...known.map((rect) => rect.y));
  const right = Math.max(...known.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...known.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
