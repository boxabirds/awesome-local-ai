import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { boardKeyCommand } from "../../src/client/board/useBoardKeys";
import { useTool } from "../../src/client/board/useTool";
import { screenToWorld } from "../../src/client/canvas/camera";
import { createSticky, snapshot } from "../../src/shared/board-model";
import { STICKY_SIZE_WORLD } from "../../src/shared/config";
import {
  boardSpace,
  pressKey,
  readCamera,
  readObjects,
  render,
  runAnimationFramesSynchronously,
} from "./boardFixture";

/**
 * Story 9, task 7 - the board's tool (TC-14 to TC-18).
 *
 * One tool state, three ways to change it (the toolbar, the keyboard, and the
 * click that consumes the Text tool), and one rule that never breaks: a board
 * this client may not write to never has the Text tool.
 */

beforeEach(() => {
  runAnimationFramesSynchronously();
});

function viewportCentre(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function toolAttribute(screen: { getByTestId(id: string): HTMLElement }): string | null {
  return screen.getByTestId("board-viewport").getAttribute("data-tool");
}

function clickAt(target: Element, at: { x: number; y: number }): void {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: at.x, clientY: at.y });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: at.x, clientY: at.y });
}

describe("text.tool_ui: the toolbar's two tools (TC-14)", () => {
  it("TC-14 Select and Text are buttons that say which key they are and which one is active", () => {
    const board = render();
    const screen = board.screen;

    const select = screen.getByTestId("tool-select");
    const text = screen.getByTestId("tool-text");

    expect(select.getAttribute("aria-label")).toBe("Select (V)");
    expect(text.getAttribute("aria-label")).toBe("Text (T)");
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(text.getAttribute("aria-pressed")).toBe("false");
    expect(toolAttribute(screen)).toBe("select");

    fireEvent.click(text);
    expect(text.getAttribute("aria-pressed")).toBe("true");
    expect(select.getAttribute("aria-pressed")).toBe("false");
    // The viewport is told too: the cursor and the click both depend on it.
    expect(toolAttribute(screen)).toBe("text");

    fireEvent.click(select);
    expect(text.getAttribute("aria-pressed")).toBe("false");
    expect(toolAttribute(screen)).toBe("select");
  });

  it("TC-14 while the Text tool waits the board is not panned by a drag", () => {
    const board = render();
    const screen = board.screen;
    fireEvent.click(screen.getByTestId("tool-text"));

    const before = readCamera();
    const target = boardSpace(screen);
    fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 200, clientY: 150 });
    fireEvent.pointerMove(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 320, clientY: 240 });
    fireEvent.pointerUp(target, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 320, clientY: 240 });

    // A press that turns into a drag is ignored: no pan, and no text either.
    const after = readCamera();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(target.getAttribute("data-panning")).toBe("false");
  });
});

describe("text.tool_ui: a board that cannot be written to (TC-15)", () => {
  it("TC-15 the Text button is disabled and T is ignored", () => {
    const board = render({ canEdit: false });
    const screen = board.screen;

    const text = screen.getByTestId("tool-text");
    expect(text.hasAttribute("disabled")).toBe(true);

    pressKey("t");
    expect(toolAttribute(screen)).toBe("select");
    expect(snapshot(board.doc)).toHaveLength(0);

    fireEvent.click(text);
    expect(screen.getByTestId("tool-text").getAttribute("aria-pressed")).toBe("false");
    expect(toolAttribute(screen)).toBe("select");
  });

  it("TC-15 useTool refuses Text without canEdit, and reverts to Select when the board stops being editable", () => {
    const { result, rerender } = renderHook(({ canEdit }) => useTool(canEdit), {
      initialProps: { canEdit: false },
    });

    act(() => result.current.setTool("text"));
    expect(result.current.tool).toBe("select");
    expect(result.current.textActive).toBe(false);

    rerender({ canEdit: true });
    act(() => result.current.setTool("text"));
    expect(result.current.tool).toBe("text");
    expect(result.current.textActive).toBe(true);

    // The board stops being editable while the Text tool is waiting.
    rerender({ canEdit: false });
    expect(result.current.tool).toBe("select");
  });
});

describe("tool.keyboard: V, T, N and Escape (TC-16, TC-18)", () => {
  it("TC-16 T while an object is being typed into stays a typed character", () => {
    const board = render();
    const screen = board.screen;

    fireEvent.click(screen.getByTestId("create-sticky"));
    const input = screen.getByTestId("sticky-note-input") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);

    pressKey("t", input);
    pressKey("T", input);
    expect(toolAttribute(screen)).toBe("select");
    expect(screen.getByTestId("sticky-note-input")).toBeTruthy();
    expect(snapshot(board.doc)).toHaveLength(1);
  });

  it("TC-16 the keyboard reducer hands nothing to the tool while editing or typing", () => {
    const editing = {
      hasSelection: true,
      isEditing: true,
      isTypingTarget: false,
      isButtonTarget: false,
      tool: "text" as const,
    };
    const typing = {
      hasSelection: false,
      isEditing: false,
      isTypingTarget: true,
      isButtonTarget: false,
      tool: "text" as const,
    };
    const plain = {
      hasSelection: false,
      isEditing: false,
      isTypingTarget: false,
      isButtonTarget: false,
      tool: "select" as const,
    };

    for (const key of ["t", "v", "n", "Escape"]) {
      const event = { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
      expect(boardKeyCommand(event, editing)).toBeNull();
      expect(boardKeyCommand(event, typing)).toBeNull();
    }

    expect(boardKeyCommand({ key: "t", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false }, plain)).toBeNull();
    expect(boardKeyCommand({ key: "t", shiftKey: false, ctrlKey: false, metaKey: true, altKey: false }, plain)).toBeNull();
    expect(boardKeyCommand({ key: "t", shiftKey: false, ctrlKey: false, altKey: true, metaKey: false }, plain)).toBeNull();
    expect(boardKeyCommand({ key: "t", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, plain)).toEqual({
      type: "tool",
      tool: "text",
    });
    expect(boardKeyCommand({ key: "v", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, plain)).toBeNull();
    expect(boardKeyCommand({ key: "n", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, plain)).toEqual({
      type: "createSticky",
    });
    // A board with no tool state keeps story 2's Escape behaviour.
    expect(
      boardKeyCommand(
        { key: "Escape", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
        { hasSelection: true, isEditing: false, isTypingTarget: false, isButtonTarget: false },
      ),
    ).toEqual({ type: "clear" });
  });

  it("TC-18 T, V and Escape switch the tool, and Escape creates nothing", () => {
    const board = render();
    const screen = board.screen;

    // `false` means the board answered the key rather than leaving it to the browser.
    expect(pressKey("t")).toBe(false);
    expect(toolAttribute(screen)).toBe("text");

    pressKey("v");
    expect(toolAttribute(screen)).toBe("select");

    pressKey("t");
    expect(toolAttribute(screen)).toBe("text");
    pressKey("Escape");
    expect(toolAttribute(screen)).toBe("select");
    expect(snapshot(board.doc)).toHaveLength(0);
  });

  it("TC-18 N creates a sticky note at the centre of the view, like the toolbar button", () => {
    const board = render();
    pressKey("n");

    const notes = snapshot(board.doc);
    expect(notes).toHaveLength(1);
    const note = notes[0];
    if (!note) throw new Error("expected a note");
    const centre = screenToWorld(readCamera(), viewportCentre());
    expect(note.type).toBe("sticky");
    expect(note.x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(board.screen.getByTestId("sticky-note")).toBeTruthy();
  });

  it("N is refused on a board this client may not write to", () => {
    const board = render({ canEdit: false });
    pressKey("n");
    expect(snapshot(board.doc)).toHaveLength(0);
  });
});

describe("text.tool_ui: the Text tool's click (TC-17)", () => {
  it("TC-17 the next click writes a text object there and opens its editor", () => {
    const board = render();
    const screen = board.screen;

    pressKey("t");
    expect(toolAttribute(screen)).toBe("text");

    const at = { x: 320, y: 210 };
    clickAt(boardSpace(screen), at);

    const objects = readObjects(board.doc);
    expect(objects).toHaveLength(1);
    const created = objects[0];
    if (!created) throw new Error("expected a text object");
    expect(created.type).toBe("text");
    const world = screenToWorld(readCamera(), at);
    // The click is the text's top-left corner, not its centre.
    expect(created.x).toBeCloseTo(world.x, 6);
    expect(created.y).toBeCloseTo(world.y, 6);

    // Straight into editing, with the caret ready.
    const input = screen.getByTestId("text-object-input") as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(input);
    expect(screen.getByTestId("text-object").getAttribute("data-note-id")).toBe(created.id);

    // The tool is left behind, so the same click cannot create a second text.
    expect(toolAttribute(screen)).toBe("select");
  });

  it("TC-17 the click works on top of an existing object, at that point", () => {
    const board = render();
    const screen = board.screen;

    const at = { x: 60, y: 40 };
    const world = screenToWorld(readCamera(), at);
    let stickyId = "";
    act(() => {
      const id = createSticky(board.doc, world);
      if (typeof id !== "string") throw new Error("createSticky rejected the point");
      stickyId = id;
    });
    expect(snapshot(board.doc)).toHaveLength(1);

    pressKey("t");
    // The press lands on the note's own element: the Text tool takes it anyway.
    clickAt(screen.getByTestId("sticky-note"), at);

    const objects = snapshot(board.doc);
    expect(objects).toHaveLength(2);
    const created = objects.find((object) => object.type === "text");
    if (!created) throw new Error("expected a text object");
    expect(created.x).toBeCloseTo(world.x, 6);
    expect(created.y).toBeCloseTo(world.y, 6);

    // The note underneath was neither selected nor moved by that press. It is
    // centred on the point, which is what `createSticky` does.
    const note = objects.find((object) => object.id === stickyId);
    if (!note) throw new Error("the sticky note is gone");
    expect(note.x).toBeCloseTo(world.x - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(world.y - STICKY_SIZE_WORLD / 2, 6);
    expect(screen.getByTestId("sticky-note").getAttribute("data-selected")).toBe("false");
  });

  it("the click that wrote text does not also create a sticky note", () => {
    const board = render();
    const screen = board.screen;
    pressKey("t");

    const at = { x: 150, y: 150 };
    const target = boardSpace(screen);
    // A real double-click: two presses and releases, then the dblclick.
    clickAt(target, at);
    clickAt(target, at);
    fireEvent.doubleClick(target, { clientX: at.x, clientY: at.y });

    // One text object and no sticky note: story 2's double-click creation is off
    // while the Text tool is waiting, and the click that wrote text is not a
    // double-click that creates a note.
    const objects = snapshot(board.doc);
    expect(objects.filter((object) => object.type === "text")).toHaveLength(1);
    expect(objects.filter((object) => object.type === "sticky")).toHaveLength(0);
  });
});
