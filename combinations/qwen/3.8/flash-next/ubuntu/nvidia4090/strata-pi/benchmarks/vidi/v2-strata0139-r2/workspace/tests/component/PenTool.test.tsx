import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render as renderInJsdom } from "@testing-library/react";
import {
  PEN_COLORS,
  PEN_COLOR_NAMES,
  PEN_THICKNESS_NAMES,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
} from "../../src/shared/config";
import { scaledPoints } from "../../src/shared/objects/stroke";
import { PenToolbar } from "../../src/client/tools/PenToolbar";
import { handwrittenLoop, spiralPath, straightPath, underlinePath } from "../fixtures/pen-paths";
import {
  act,
  boardSpace,
  pointer,
  pressKey,
  readBox,
  renderBoard,
  runAnimationFramesSynchronously,
  selectedIds,
} from "./boardFixture";
import {
  armPen,
  activeTool,
  drawPen,
  dropAnimationFrames,
  queueAnimationFrames,
  screenXY,
  strokeOf,
  strokesOf,
  tapPen,
} from "./penFixture";

/**
 * Story 11, task 3 (TC-09 to TC-14) — the Pen tool and its colour and thickness
 * options.
 *
 * Board state is asserted on the Y.Doc, the tool's own drawing on the elements it
 * renders. Drags are fired on the board viewport, so a press travels the route a
 * real press travels: the Pen tool claims it at `document`, before the pan, the
 * marquee or any board object can have it.
 */

describe("pen.tool: drawing with the Pen", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-09 P, Red and Thick chosen, then a drag: one red thick stroke, the pen still armed, nothing selected", () => {
    const board = renderBoard();
    armPen(board);

    act(() => {
      board.screen.getByTestId("pen-color-red").click();
      board.screen.getByTestId("pen-thickness-thick").click();
    });

    drawPen(board, underlinePath(120));

    const strokes = strokesOf(board);
    expect(strokes.length).toBe(1);
    const stroke = strokes[0]!;
    expect(stroke.color).toBe("red");
    expect(stroke.thickness).toBe("thick");
    expect(stroke.width).toBeGreaterThan(300);
    // 120 raw points, simplified at one screen pixel: far fewer, and not all of them.
    expect(scaledPoints(stroke).length).toBeGreaterThan(2);
    expect(scaledPoints(stroke).length).toBeLessThan(120);

    // Drawing is a mode: the tool is still the Pen and nothing is selected.
    expect(activeTool(board)).toBe("pen");
    expect(selectedIds(board.screen)).toEqual([]);

    // The preview is gone with the stroke.
    expect(board.screen.queryByTestId("pen-preview")).toBeNull();
  });

  it("TC-09 the pen's own swatches swallow the press: a drag that starts on a swatch draws nothing", () => {
    const board = renderBoard();
    armPen(board);

    const swatch = board.screen.getByTestId("pen-color-blue");
    act(() => {
      pointer("pointerDown", swatch, 140, 400);
      pointer("pointerMove", swatch, 300, 500);
      pointer("pointerUp", swatch, 300, 500);
    });

    expect(strokesOf(board).length).toBe(0);
    expect(activeTool(board)).toBe("pen");
  });

  it("TC-10 a click with the pen is a dot: one point, a box the size of the thickness", () => {
    const board = renderBoard();
    armPen(board);

    tapPen(board, { x: 120, y: 90 });

    const strokes = strokesOf(board);
    expect(strokes.length).toBe(1);
    const drawn = scaledPoints(strokes[0]!);
    expect(drawn.length).toBe(1);
    expect(drawn[0]).toEqual({ x: 120, y: 90 });

    // The box is the dot plus its own thickness, and it is big enough to grab.
    const pad = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_MIN_SIZE_WORLD / 2);
    expect(strokes[0]!.width).toBeCloseTo(pad * 2, 6);
    expect(strokes[0]!.height).toBeCloseTo(pad * 2, 6);
    expect(strokes[0]!.width).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);

    // It is drawn as a filled circle, not as a path.
    expect(board.screen.getByTestId("stroke-dot").getAttribute("r")).toBe(
      String(PEN_THICKNESS_WORLD.medium / 2),
    );
  });

  it("TC-11 pointercancel mid-drag keeps the drawing: the points so far are a stroke", () => {
    const board = renderBoard();
    armPen(board);

    const path = underlinePath(40);
    const space = boardSpace(board.screen);
    act(() => {
      pointer("pointerDown", space, ...screenXY(path[0]!));
      for (const point of path.slice(1, 21)) pointer("pointerMove", space, ...screenXY(point));
      pointer("pointerCancel", space, ...screenXY(path[20]!));
    });

    const strokes = strokesOf(board);
    expect(strokes.length).toBe(1);
    expect(scaledPoints(strokes[0]!).length).toBeGreaterThan(2);
    expect(activeTool(board)).toBe("pen");

    // The press is over: a further move adds nothing to it.
    act(() => {
      pointer("pointerMove", space, ...screenXY(path[30]!));
      pointer("pointerUp", space, ...screenXY(path[39]!));
    });
    expect(strokesOf(board).length).toBe(1);
  });

  it("TC-12 a drag longer than STROKE_MAX_POINTS becomes two strokes that share their join point", () => {
    const board = renderBoard();
    dropAnimationFrames();
    armPen(board);

    drawPen(board, spiralPath(STROKE_MAX_POINTS + 10));

    const strokes = strokesOf(board);
    expect(strokes.length).toBe(2);
    const firstPoints = scaledPoints(strokes[0]!);
    const secondPoints = scaledPoints(strokes[1]!);
    // The whole spiral is there: 5,010 recorded points, simplified, cut in two.
    expect(firstPoints.length + secondPoints.length).toBeLessThanOrEqual(STROKE_MAX_POINTS + 10);
    expect(firstPoints.length).toBeGreaterThan(1_000);

    const endOfFirst = firstPoints[firstPoints.length - 1]!;
    const startOfSecond = secondPoints[0]!;
    expect(startOfSecond.x).toBeCloseTo(endOfFirst.x, 9);
    expect(startOfSecond.y).toBeCloseTo(endOfFirst.y, 9);

    // Two parts, and the drag is still one drawing: the boxes overlap where they meet.
    const boxes = [readBox(board.doc, strokes[0]!.id), readBox(board.doc, strokes[1]!.id)];
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x + boxes[1]!.width);
  });

  it("TC-13 Escape and V leave the pen, drawing nothing; in Select a drag draws nothing either", () => {
    const board = renderBoard();
    armPen(board);

    // A press in progress, then Escape: no stroke.
    const space = boardSpace(board.screen);
    act(() => {
      pointer("pointerDown", space, 60, 60);
      pointer("pointerMove", space, 200, 160);
    });
    // `false` is the board calling preventDefault: Escape belongs to the board here.
    expect(pressKey("Escape")).toBe(false);
    act(() => {
      pointer("pointerUp", space, 260, 200);
    });

    expect(strokesOf(board).length).toBe(0);
    expect(activeTool(board)).toBe("select");

    // The Pen is inert now: the same drag pans, it does not draw.
    drawPen(board, underlinePath(60));
    expect(strokesOf(board).length).toBe(0);

    // V arms Select, P arms the Pen again, and a stroke drawn after that survives.
    pressKey("v");
    expect(activeTool(board)).toBe("select");
    armPen(board);
    tapPen(board, { x: 300, y: 300 });
    expect(strokesOf(board).length).toBe(1);
  });

  it("TC-14 the preview path exists only while the drag is going", () => {
    const board = renderBoard();
    armPen(board);

    expect(board.screen.queryByTestId("pen-preview")).toBeNull();

    const space = boardSpace(board.screen);
    act(() => {
      pointer("pointerDown", space, 100, 100);
      pointer("pointerMove", space, 160, 140);
    });

    const preview = board.screen.getByTestId("pen-preview");
    const d = preview.getAttribute("d") ?? "";
    expect(d.startsWith("M 100 100")).toBe(true);
    expect(d).toContain("L 160 140");
    // The preview is drawn in screen pixels at the pen's thickness.
    expect(preview.getAttribute("stroke-width")).toBe(String(PEN_THICKNESS_WORLD.medium));

    act(() => {
      pointer("pointerUp", space, 200, 180);
    });
    expect(board.screen.queryByTestId("pen-preview")).toBeNull();
    expect(strokesOf(board).length).toBe(1);
  });

  it("TC-14 a hundred pointer points refresh the preview at most once per animation frame", () => {
    const board = renderBoard();
    const frames = queueAnimationFrames();
    armPen(board);

    const space = boardSpace(board.screen);
    act(() => {
      pointer("pointerDown", space, 100, 100);
    });
    act(() => frames.flush());
    expect(board.screen.getByTestId("pen-preview").getAttribute("d")).toBe("M 100 100 L 100 100");

    act(() => {
      for (let index = 1; index <= 100; index += 1) pointer("pointerMove", space, 100 + index * 3, 100 + index);
    });
    // One refresh is pending, not a hundred.
    expect(frames.queued()).toBe(1);

    act(() => frames.flush());
    const d = board.screen.getByTestId("pen-preview").getAttribute("d") ?? "";
    expect(d).toContain("L 400 200");
  });

  it("TC-14 the cursor circle follows the pointer between strokes, and the overlay is never a hit target", () => {
    const board = renderBoard();
    armPen(board);

    const space = boardSpace(board.screen);
    act(() => {
      pointer("pointerMove", space, 220, 240);
    });

    const cursor = board.screen.getByTestId("pen-cursor");
    expect(cursor.getAttribute("cx")).toBe("220");
    expect(cursor.getAttribute("cy")).toBe("240");
    const overlay = board.screen.getByTestId("pen-overlay");
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.getAttribute("style")).toContain("pointer-events: none");
  });

  it("TC-14 changing the pen's options changes the next stroke, not the one already drawn", () => {
    const board = renderBoard();
    armPen(board);
    drawPen(board, underlinePath(40));

    const first = strokeOf(board, strokesOf(board)[0]!.id);
    expect(first.color).toBe("black");
    expect(first.thickness).toBe("medium");

    act(() => {
      board.screen.getByTestId("pen-color-purple").click();
      board.screen.getByTestId("pen-thickness-thin").click();
    });

    // The stroke already on the board is untouched by the new choice.
    expect(strokeOf(board, first.id).color).toBe("black");
    expect(strokeOf(board, first.id).thickness).toBe("medium");
    expect(strokeOf(board, first.id).points).toEqual(first.points);

    drawPen(board, straightPath({ x: 420, y: 380 }, { x: 480, y: 420 }, 9));
    const second = strokesOf(board).find((stroke) => stroke.id !== first.id)!;
    expect(second.color).toBe("purple");
    expect(second.thickness).toBe("thin");
  });

  it("pen.smooth: a hand-drawn loop is one stroke, hit where it was drawn and not inside", () => {
    const board = renderBoard();
    armPen(board);
    const loop = handwrittenLoop(400);
    drawPen(board, loop);

    const strokes = strokesOf(board);
    expect(strokes.length).toBe(1);
    expect(scaledPoints(strokes[0]!).length).toBeLessThan(400);
  });

  it("pen.stroke: two drags are two strokes", () => {
    const board = renderBoard();
    armPen(board);
    drawPen(board, underlinePath(30));
    drawPen(board, straightPath({ x: 400, y: 400 }, { x: 460, y: 430 }, 8));
    expect(strokesOf(board).length).toBe(2);
  });

  it("stroke.undo: a drawn stroke is one undo step", () => {
    const board = renderBoard();
    armPen(board);
    drawPen(board, underlinePath(60));
    expect(strokesOf(board).length).toBe(1);

    act(() => {
      expect(board.undo().undo()).toBe(true);
    });
    expect(strokesOf(board).length).toBe(0);
  });
});

describe("pen.toolbar: the pen's options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows six colours and three thicknesses, marks the chosen one, and reports the choice", () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const screen = renderInJsdom(
      createElement(PenToolbar, { color: "blue", thickness: "thin", onColor, onThickness }),
    );

    expect(screen.getAllByRole("button", { name: / pen$/ })).toHaveLength(6);
    expect(screen.getByTestId("pen-color-blue").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("pen-color-black").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Thin" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Thick" }).getAttribute("aria-pressed")).toBe("false");
    // A thick pen looks thicker in its own button.
    expect(screen.getByRole("button", { name: "Thick" }).querySelector(".pen-thickness-glyph")?.getAttribute("style")).toContain(
      "height: 8px",
    );

    screen.getByTestId("pen-color-green").click();
    screen.getByRole("button", { name: "Thick" }).click();
    expect(onColor).toHaveBeenCalledWith("green");
    expect(onThickness).toHaveBeenCalledWith("thick");

    // The names the options use are the names the model stores.
    expect(PEN_COLOR_NAMES).toHaveLength(6);
    expect(PEN_THICKNESS_NAMES).toHaveLength(3);
    expect(PEN_COLORS.black).toBeDefined();
  });

  it("swallows a press so arming the pen can never start a drag on the board", () => {
    const reached = vi.fn();
    document.addEventListener("pointerdown", reached);
    try {
      const screen = renderInJsdom(
        createElement(PenToolbar, { color: "black", thickness: "medium", onColor: vi.fn(), onThickness: vi.fn() }),
      );
      pointer("pointerDown", screen.getByTestId("pen-color-red"), 10, 10);
      expect(reached).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", reached);
    }
  });
});
