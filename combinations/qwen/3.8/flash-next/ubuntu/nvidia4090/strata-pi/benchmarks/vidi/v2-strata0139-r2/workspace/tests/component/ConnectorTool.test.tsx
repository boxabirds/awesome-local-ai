import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { snapshot } from "../../src/shared/board-model";
import { createShape } from "../../src/shared/objects/shape";
import { createConnector, connectorLine, type ConnectorSnap } from "../../src/shared/objects/connector";
import { CONNECTOR_DOT_RADIUS_PX, CONNECTOR_HIT_TOLERANCE_PX, SHAPE_DEFAULT_SIZE_WORLD } from "../../src/shared/config";
import type { Point } from "../../src/shared/geometry";
import {
  boardSpace,
  changeModel,
  objectById,
  pointer,
  pressKey,
  readCamera,
  renderBoard,
  runAnimationFramesSynchronously,
  screenOf,
  selectedIds,
  type RenderHandle,
} from "./boardFixture";

/**
 * Story 10, task 13 (TC-18 to TC-21) — the Connector tool and the arrow it makes.
 *
 * The tool's own geometry is what is under test here: the four dots are the side
 * midpoints of the object the pointer is over, the highlighted dot is the one the
 * arrow would land on, and an arrow is picked up by its end rather than by its
 * box. Board state is read from the Y.Doc; the tool's drawing is read from the
 * elements it leaves behind.
 */

interface Placed {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function addShape(board: RenderHandle, x: number, y: number, width = SHAPE_DEFAULT_SIZE_WORLD, height = 120): Placed {
  let id = "";
  changeModel(() => {
    const created = createShape(board.doc, { kind: "rect", rect: { x, y, width, height }, at: { x, y } });
    if (typeof created !== "string") throw new Error("createShape rejected the rectangle");
    id = created;
  });
  return { id, x, y, width, height };
}

function connect(board: RenderHandle, fromId: string, toId: string): string {
  let id = "";
  changeModel(() => {
    const created = createConnector(
      board.doc,
      { kind: "attached", objectId: fromId },
      { kind: "attached", objectId: toId },
    );
    if (typeof created !== "string") throw new Error("createConnector rejected the pair");
    id = created;
  });
  return id;
}

function connectorById(board: RenderHandle, id: string): { from: unknown; to: unknown } {
  const object = snapshot(board.doc).find((entry) => entry.id === id);
  if (!object || object.from === undefined || object.to === undefined) throw new Error(`no connector ${id}`);
  return { from: object.from, to: object.to };
}

function attachedTo(end: unknown): string | undefined {
  return typeof end === "object" && end !== null && "objectId" in end ? (end as { objectId: string }).objectId : undefined;
}

function freeEnd(end: unknown): Point | undefined {
  return typeof end === "object" && end !== null && "x" in end ? (end as Point) : undefined;
}

/** The ends of an arrow on screen, in the pixels a pointer would be placed at. */
function lineOf(board: RenderHandle, id: string): { from: Point; to: Point } {
  const objects = snapshot(board.doc);
  const connector = objects.find((entry) => entry.id === id);
  if (!connector) throw new Error(`no connector ${id}`);
  return connectorLine(connector as ConnectorSnap, objects);
}

function hover(board: RenderHandle, world: Point): void {
  const at = screenOf(world);
  fireEvent.pointerMove(document, { clientX: at.x, clientY: at.y, pointerType: "mouse" });
}

function dots(board: RenderHandle): HTMLElement[] {
  return Array.from(board.screen.container.querySelectorAll<HTMLElement>('[data-testid="connector-endpoint-dot"]'));
}

function setZoom(zoom: number): void {
  act(() => {
    window.__vidi6?.setCamera({ ...readCamera(), zoom });
  });
}

describe("connector.ui: the Connector tool", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-18 hovering a shape with the Connector tool shows four dots at its side midpoints", () => {
    const board = renderBoard();
    const shape = addShape(board, -200, -60, 160, 120);

    pressKey("l");
    expect(board.screen.getByTestId("board-viewport").dataset.tool).toBe("connector");

    hover(board, { x: shape.x + 80, y: shape.y + 60 });

    const shown = dots(board);
    expect(shown.length).toBe(4);
    const expected = {
      left: { x: shape.x, y: shape.y + 60 },
      right: { x: shape.x + 160, y: shape.y + 60 },
      top: { x: shape.x + 80, y: shape.y },
      bottom: { x: shape.x + 80, y: shape.y + 120 },
    };
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const el = shown.find((dot) => dot.dataset.side === side);
      expect(el).toBeTruthy();
      const screen = screenOf(expected[side]);
      expect(Number.parseFloat(el!.style.left)).toBeCloseTo(screen.x - CONNECTOR_DOT_RADIUS_PX, 3);
      expect(Number.parseFloat(el!.style.top)).toBeCloseTo(screen.y - CONNECTOR_DOT_RADIUS_PX, 3);
    }

    // Hovering empty board space shows nothing.
    hover(board, { x: 600, y: 400 });
    expect(dots(board).length).toBe(0);
  });

  it("TC-19 dragging from A over B highlights B's nearest dot and releases an attached arrow", () => {
    const board = renderBoard();
    const a = addShape(board, -300, -60, 160, 120);
    const b = addShape(board, 120, -60, 160, 120);

    pressKey("l");
    const space = boardSpace(board.screen);
    const from = screenOf({ x: a.x + 80, y: a.y + 60 });
    const to = screenOf({ x: b.x + 80, y: b.y + 60 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, (from.x + to.x) / 2, from.y);
    pointer("pointerMove", space, to.x, to.y);

    // The tool draws the arrow it is about to make, and marks the dot it lands on.
    expect(board.screen.getByTestId("connector-preview")).toBeTruthy();
    const highlighted = dots(board).filter((dot) => dot.dataset.highlighted === "true");
    expect(highlighted.length).toBe(1);
    expect(highlighted[0].dataset.side).toBe("left");

    pointer("pointerUp", space, to.x, to.y);

    const connectors = snapshot(board.doc).filter((entry) => entry.type === "connector");
    expect(connectors.length).toBe(1);
    expect(attachedTo(connectors[0].from)).toBe(a.id);
    expect(attachedTo(connectors[0].to)).toBe(b.id);
    expect(selectedIds(board.screen)).toEqual([connectors[0].id]);
    expect(board.screen.getByTestId("board-viewport").dataset.tool).toBe("select");
  });

  it("an arrow dragged to empty board space is created with a free end at the release point", () => {
    const board = renderBoard();
    const a = addShape(board, -300, -60, 160, 120);

    pressKey("l");
    const space = boardSpace(board.screen);
    const from = screenOf({ x: a.x + 80, y: a.y + 60 });
    const to = screenOf({ x: 120, y: 60 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, to.x, to.y);
    expect(board.screen.getByTestId("connector-preview")).toBeTruthy();
    pointer("pointerUp", space, to.x, to.y);

    const connectors = snapshot(board.doc).filter((entry) => entry.type === "connector");
    expect(connectors.length).toBe(1);
    expect(attachedTo(connectors[0].from)).toBe(a.id);
    const free = freeEnd(connectors[0].to);
    expect(free).toBeTruthy();
    expect(free!.x).toBeCloseTo(120, 3);
    expect(free!.y).toBeCloseTo(60, 3);
  });

  it("an arrow dragged back onto the object it started from is refused, and the tool stays", () => {
    const board = renderBoard();
    const a = addShape(board, -300, -60, 160, 120);

    pressKey("l");
    const space = boardSpace(board.screen);
    const from = screenOf({ x: a.x + 80, y: a.y + 60 });
    const to = screenOf({ x: a.x + 80, y: a.y + 100 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, to.x, to.y);
    pointer("pointerUp", space, to.x, to.y);

    expect(snapshot(board.doc).filter((entry) => entry.type === "connector").length).toBe(0);
    expect(board.screen.getByTestId("board-viewport").dataset.tool).toBe("connector");
  });

  it("a Connector press on empty board space is left to the board: it clears the selection", () => {
    const board = renderBoard();
    const shape = addShape(board, -200, -60, 160, 120);
    board.changeSelection([shape.id]);
    expect(selectedIds(board.screen)).toEqual([shape.id]);

    pressKey("l");
    const space = boardSpace(board.screen);
    const at = screenOf({ x: 500, y: 300 });
    pointer("pointerDown", space, at.x, at.y);
    pointer("pointerUp", space, at.x, at.y);

    expect(selectedIds(board.screen)).toEqual([]);
  });
});

describe("connector.select: clicking near an arrow", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases = [
    { zoom: 0.5, near: 5, far: 7 },
    { zoom: 2, near: 5, far: 7 },
  ];

  for (const { zoom, near, far } of cases) {
    it(`TC-20 at ${zoom * 100}% zoom, ${near} px from the line selects the arrow and ${far} px does not`, () => {
      const board = renderBoard();
      const a = addShape(board, -320, -60, 160, 120);
      const b = addShape(board, 160, -60, 160, 120);
      const arrow = connect(board, a.id, b.id);

      setZoom(zoom);
      const line = lineOf(board, arrow);
      const middle = { x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 };
      const space = boardSpace(board.screen);

      // A click closer than CONNECTOR_HIT_TOLERANCE_PX on screen.
      const nearPoint = screenOf(middle);
      pointer("pointerDown", space, nearPoint.x, nearPoint.y - near);
      pointer("pointerUp", space, nearPoint.x, nearPoint.y - near);
      expect(selectedIds(board.screen)).toEqual([arrow]);

      // A click just outside it: empty board space, as it always was.
      pointer("pointerDown", space, nearPoint.x, nearPoint.y - far);
      pointer("pointerUp", space, nearPoint.x, nearPoint.y - far);
      expect(selectedIds(board.screen)).toEqual([]);

      // The tolerance is measured on screen, so it is the same number of pixels
      // however big or small the board is drawn.
      expect(CONNECTOR_HIT_TOLERANCE_PX).toBeGreaterThan(far - 2);
    });
  }
});

describe("connector.reattach: an arrow's end handles", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-21 dragging a selected arrow's end onto another object attaches it there", () => {
    const board = renderBoard();
    const a = addShape(board, -420, -60, 160, 120);
    const b = addShape(board, 160, -60, 160, 120);
    const c = addShape(board, 160, 220, 160, 120);
    const arrow = connect(board, a.id, b.id);
    board.changeSelection([arrow]);

    expect(board.screen.container.querySelectorAll('[data-testid="connector-handle"]')).toHaveLength(2);

    const line = lineOf(board, arrow);
    const space = boardSpace(board.screen);
    const from = screenOf(line.to);
    const to = screenOf({ x: c.x + 80, y: c.y + 60 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, (from.x + to.x) / 2, (from.y + to.y) / 2);
    pointer("pointerUp", space, to.x, to.y);

    expect(attachedTo(connectorById(board, arrow).to)).toBe(c.id);
    expect(attachedTo(connectorById(board, arrow).from)).toBe(a.id);
  });

  it("TC-21 dragging that end onto empty board space fixes it to that point", () => {
    const board = renderBoard();
    const a = addShape(board, -420, -60, 160, 120);
    const b = addShape(board, 160, -60, 160, 120);
    const arrow = connect(board, a.id, b.id);
    board.changeSelection([arrow]);

    const line = lineOf(board, arrow);
    const space = boardSpace(board.screen);
    const from = screenOf(line.to);
    const to = screenOf({ x: 420, y: 260 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, (from.x + to.x) / 2, (from.y + to.y) / 2);
    pointer("pointerUp", space, to.x, to.y);

    const free = freeEnd(connectorById(board, arrow).to);
    expect(free).toBeTruthy();
    expect(free!.x).toBeCloseTo(420, 3);
    expect(free!.y).toBeCloseTo(260, 3);
  });

  it("releasing an end on the object at the other end is refused and the end stays where it was", () => {
    const board = renderBoard();
    const a = addShape(board, -420, -60, 160, 120);
    const b = addShape(board, 160, -60, 160, 120);
    const arrow = connect(board, a.id, b.id);
    board.changeSelection([arrow]);
    const before = connectorById(board, arrow);

    const line = lineOf(board, arrow);
    const space = boardSpace(board.screen);
    const from = screenOf(line.to);
    const to = screenOf({ x: a.x + 80, y: a.y + 60 });

    pointer("pointerDown", space, from.x, from.y);
    pointer("pointerMove", space, to.x, to.y);
    pointer("pointerUp", space, to.x, to.y);

    expect(connectorById(board, arrow)).toEqual(before);
  });

  it("an arrow's own element shows the line, the arrowhead and its ends", () => {
    const board = renderBoard();
    const a = addShape(board, -320, -60, 160, 120);
    const b = addShape(board, 160, -60, 160, 120);
    const arrow = connect(board, a.id, b.id);
    board.changeSelection([arrow]);

    const el = objectById(board.screen, arrow);
    expect(el.dataset.objectType).toBe("connector");
    expect(el.querySelector('[data-testid="connector-line"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="connector-handle"]').length).toBe(2);
  });
});
