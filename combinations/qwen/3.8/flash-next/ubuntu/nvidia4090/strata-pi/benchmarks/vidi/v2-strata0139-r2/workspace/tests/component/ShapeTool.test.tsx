import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { snapshot } from "../../src/shared/board-model";
import { createShape, getShapeLabel, type ShapeSnap } from "../../src/shared/objects/shape";
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from "../../src/shared/config";
import {
  addNote,
  boardSpace,
  changeModel,
  objectById,
  pointer,
  pressKey,
  readBox,
  render,
  renderBoard,
  runAnimationFramesSynchronously,
  screenOf,
  selectedIds,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 10, task 12 (TC-15 to TC-17, TC-22, TC-28) — the Shape tool, a shape's
 * centred label and its style toolbar.
 *
 * Board state is asserted on the Y.Doc; what the tool shows is asserted on the
 * elements it draws. Screen points come from the camera the board actually has,
 * through `screenOf`, so a drag here is a drag at the pixels a person would drag.
 */

function shapesOf(board: RenderHandle): ShapeSnap[] {
  return snapshot(board.doc).filter((object): object is ShapeSnap => object.type === "shape");
}

function addShape(board: RenderHandle, rect: { x: number; y: number; width: number; height: number }): string {
  let id = "";
  changeModel(() => {
    const created = createShape(board.doc, { kind: "rect", rect, at: { x: rect.x, y: rect.y } });
    if (typeof created !== "string") throw new Error("createShape rejected the rectangle");
    id = created;
  });
  return id;
}

/** Drags the Shape tool across the board, from one world point to another. */
function drawShape(board: RenderHandle, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }, target?: HTMLElement): void {
  const from = screenOf(fromWorld);
  const to = screenOf(toWorld);
  const el = target ?? boardSpace(board.screen);
  pointer("pointerDown", el, from.x, from.y);
  pointer("pointerMove", el, (from.x + to.x) / 2, (from.y + to.y) / 2);
  pointer("pointerMove", el, to.x, to.y);
  pointer("pointerUp", el, to.x, to.y);
}

/** The tool the board is in, read where the board says it. */
function activeTool(board: RenderHandle): string | undefined {
  return board.screen.getByTestId("board-viewport").dataset.tool;
}

describe("shape.ui: the Shape tool", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-15 S, then a drag, previews the rectangle and creates the shape once, selected, and the board is back in Select", () => {
    const board = renderBoard();

    pressKey("s");
    expect(activeTool(board)).toBe("shape");

    const space = boardSpace(board.screen);
    const from = screenOf({ x: -100, y: -60 });
    const to = screenOf({ x: 100, y: 60 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, 0, 0);
    expect(board.screen.getByTestId("shape-preview")).toBeTruthy();
    pointer("pointerUp", space, to.x, to.y);

    const shapes = shapesOf(board);
    expect(shapes.length).toBe(1);
    const box = readBox(board.doc, shapes[0].id);
    expect(box.width).toBeCloseTo(200, 6);
    expect(box.height).toBeCloseTo(120, 6);
    expect(box.x).toBeCloseTo(-100, 6);
    expect(box.y).toBeCloseTo(-60, 6);

    // What the tool made is what is selected, and the tool is gone.
    expect(selectedIds(board.screen)).toEqual([shapes[0].id]);
    expect(activeTool(board)).toBe("select");
  });

  it("TC-15 a click creates the standard shape centred on the point that was clicked", () => {
    const board = renderBoard();
    pressKey("s");

    const at = screenOf({ x: 0, y: 0 });
    const space = boardSpace(board.screen);
    pointer("pointerDown", space, at.x, at.y);
    pointer("pointerUp", space, at.x, at.y);

    const shapes = shapesOf(board);
    expect(shapes.length).toBe(1);
    const box = readBox(board.doc, shapes[0].id);
    expect(box.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(box.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(box.x).toBeCloseTo(-SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(box.y).toBeCloseTo(-SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
  });

  it("TC-15 Shift makes the drag a square, and pointercancel creates nothing", () => {
    const board = renderBoard();
    pressKey("s");

    const space = boardSpace(board.screen);
    const from = screenOf({ x: -100, y: -60 });
    const to = screenOf({ x: 100, y: 60 });
    pointer("pointerDown", space, from.x, from.y, true);
    pointer("pointerMove", space, to.x, to.y, true);
    pointer("pointerUp", space, to.x, to.y, true);

    const square = readBox(board.doc, shapesOf(board)[0].id);
    expect(square.width).toBeCloseTo(square.height, 6);
    expect(square.width).toBeCloseTo(200, 6);

    pressKey("s");
    pointer("pointerDown", space, 10, 10);
    pointer("pointerCancel", space, 10, 10);
    expect(shapesOf(board).length).toBe(1);
  });

  it("TC-28 a Shape-tool drag that starts on a sticky note moves nothing that was already there", () => {
    const board = renderBoard();
    const note = addNote(board, { x: 0, y: 0 });
    const before = readBox(board.doc, note);

    pressKey("s");
    drawShape(board, { x: 0, y: 0 }, { x: 120, y: 120 }, objectById(board.screen, note));

    expect(readBox(board.doc, note)).toEqual(before);
    expect(shapesOf(board).length).toBe(1);
    // The board is back in Select, so the next click on the note selects it.
    expect(activeTool(board)).toBe("select");
  });

  it("TC-22 a created shape leaves the board in Select; Escape leaves the tool without creating anything", () => {
    const board = renderBoard();

    pressKey("s");
    expect(activeTool(board)).toBe("shape");
    pressKey("Escape");
    expect(activeTool(board)).toBe("select");
    expect(shapesOf(board).length).toBe(0);
  });

  it("the shape button in the toolbar arms the tool, and the kind menu picks the kind", () => {
    const board = render();
    const screen = board.screen;

    fireEvent.click(screen.getByLabelText("Shape (S)"));
    expect(screen.getByTestId("tool-shape").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("board-viewport").dataset.tool).toBe("shape");

    fireEvent.click(screen.getByLabelText("Diamond"));
    expect(screen.getByTestId("shape-kind-diamond").getAttribute("aria-pressed")).toBe("true");

    const at = screenOf({ x: 0, y: 0 });
    const space = screen.getByTestId("board-viewport");
    pointer("pointerDown", space, at.x, at.y);
    pointer("pointerUp", space, at.x, at.y);

    expect(shapesOf(board)[0].kind).toBe("diamond");
    expect(screen.getByTestId("board-viewport").dataset.tool).toBe("select");
  });
});

describe("shape.label: editing a shape's label", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-16 double-clicking a shape edits its label, and the label stops at SHAPE_LABEL_MAX_CHARS", () => {
    const board = renderBoard();
    const id = addShape(board, { x: -100, y: -60, width: 200, height: 120 });

    fireEvent.doubleClick(objectById(board.screen, id));

    const input = board.screen.getByTestId("shape-label-input") as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");

    fireEvent.change(input, { target: { value: "k".repeat(600) } });

    expect(getShapeLabel(board.doc, id)?.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect((shapesOf(board)[0].label ?? "").length).toBe(SHAPE_LABEL_MAX_CHARS);
    // The shape itself is untouched by typing in it.
    expect(readBox(board.doc, id)).toMatchObject({ width: 200, height: 120 });
  });

  it("a label that is already on the shape is shown without editing", () => {
    const board = renderBoard();
    changeModel(() => {
      const created = createShape(board.doc, { kind: "rect", rect: { x: 0, y: 0, width: 200, height: 120 }, at: { x: 0, y: 0 } });
      if (typeof created !== "string") throw new Error("createShape rejected the rectangle");
      getShapeLabel(board.doc, created)?.insert(0, "Checkout");
    });

    expect(board.screen.getByTestId("shape-label").textContent).toBe("Checkout");
  });
});

describe("shape.style: the shape toolbar", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-17 the fill and outline swatches change only those keys, and the selection stays", () => {
    const board = renderBoard();
    let id = "";
    changeModel(() => {
      const created = createShape(board.doc, {
        kind: "rect",
        rect: { x: -100, y: -60, width: 200, height: 120 },
        at: { x: 0, y: 0 },
        fill: "white",
        stroke: "dark",
      });
      if (typeof created !== "string") throw new Error("createShape rejected the rectangle");
      id = created;
      getShapeLabel(board.doc, created)?.insert(0, "Checkout");
    });
    board.changeSelection([id]);

    fireEvent.click(board.screen.getByLabelText("blue fill"));
    fireEvent.click(board.screen.getByLabelText("red outline"));

    const shape = shapesOf(board)[0];
    expect(shape.fill).toBe("blue");
    expect(shape.stroke).toBe("red");
    expect(shape.kind).toBe("rect");
    expect(shape.label).toBe("Checkout");
    expect(readBox(board.doc, id)).toMatchObject({ x: -100, y: -60, width: 200, height: 120 });
    expect(selectedIds(board.screen)).toEqual([id]);
  });

  it("the swatch the shape already has is the pressed one", () => {
    const board = renderBoard();
    const id = addShape(board, { x: 0, y: 0, width: 200, height: 120 });
    board.changeSelection([id]);

    const toolbar = board.screen.getByTestId("shape-toolbar");
    expect(toolbar.getAttribute("aria-pressed")).toBeNull();
    expect(board.screen.getByLabelText("white fill").getAttribute("aria-pressed")).toBe("true");
    expect(board.screen.getByLabelText("dark outline").getAttribute("aria-pressed")).toBe("true");
  });
});
