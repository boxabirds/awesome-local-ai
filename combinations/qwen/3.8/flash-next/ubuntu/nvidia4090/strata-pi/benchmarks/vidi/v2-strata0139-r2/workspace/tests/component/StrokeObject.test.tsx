import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import { deleteObjects } from "../../src/shared/board-model";
import { scaledPoints } from "../../src/shared/objects/stroke";
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from "../../src/shared/config";
import { getObjectType } from "../../src/client/objects/registry";
import { straightPath } from "../fixtures/pen-paths";
import {
  act,
  addNote,
  boardSpace,
  changeModel,
  dragObject,
  objectById,
  objectCount,
  pointer,
  readBox,
  renderBoard,
  runAnimationFramesSynchronously,
  screenOf,
  selectedIds,
} from "./boardFixture";
import { addStroke, screenXY, setCamera, strokeOf, strokesOf } from "./penFixture";

/**
 * Story 11, task 4 (TC-15, TC-16, TC-21) — how a stroke is drawn, hit and cleared
 * away.
 *
 * A stroke is an ordinary resizable object with one difference: what a press has to
 * reach is its **line**, not its box. These tests go through the board — the click
 * is a click on the board, the hit rule is the registry's — because that is the
 * route a real click takes.
 */

describe("stroke.hit: pressing near a stroke", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-15 a press 5 pixels off the line selects the stroke, 7 pixels off does not, at 50% and at 200%", () => {
    for (const zoom of [0.5, 2]) {
      const board = renderBoard();
      setCamera({ x: 0, y: 0, zoom });
      const id = addStroke(board, straightPath({ x: -100, y: 0 }, { x: 100, y: 0 }, 21), {
        thickness: "thin",
      });

      // 5 screen pixels off a horizontal line is 5 / zoom board units off it.
      const near = screenXY({ x: 0, y: 5 / zoom });
      act(() => {
        pointer("pointerDown", boardSpace(board.screen), near[0], near[1]);
        pointer("pointerUp", boardSpace(board.screen), near[0], near[1]);
      });
      expect(selectedIds(board.screen)).toEqual([id]);

      act(() => {
        board.selection().clear();
      });

      // 7 screen pixels off is outside the target at either zoom.
      const far = screenXY({ x: 0, y: 7 / zoom });
      act(() => {
        pointer("pointerDown", boardSpace(board.screen), far[0], far[1]);
        pointer("pointerUp", boardSpace(board.screen), far[0], far[1]);
      });
      expect(selectedIds(board.screen)).toEqual([]);

      // The rule the board used, stated where it lives.
      const tolerance = Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX / zoom);
      board.unmount();
    }
  });

  it("TC-16 a press inside a stroke's box but far from its line, over a sticky note, selects the note", () => {
    const board = renderBoard();
    const noteId = addNote(board, { x: 110, y: 110 });
    // A diagonal whose box contains the note, with the press point far from the line.
    const strokeId = addStroke(board, [
      { x: 0, y: 0 },
      { x: 260, y: 260 },
    ]);

    const noteBox = readBox(board.doc, noteId);
    const strokeBox = readBox(board.doc, strokeId);
    expect(strokeBox.x).toBeLessThan(noteBox.x);
    expect(strokeBox.y).toBeLessThan(noteBox.y);
    expect(strokeBox.x + strokeBox.width).toBeGreaterThan(noteBox.x + noteBox.width);
    expect(strokeBox.y + strokeBox.height).toBeGreaterThan(noteBox.y + noteBox.height);

    const pressed = { x: 30, y: 150 };
    const hit = getObjectType("stroke")!.hitTest;
    expect(hit(strokeOf(board, strokeId), pressed, 1)).toBe(false);
    // On the line itself the same stroke is hit.
    expect(hit(strokeOf(board, strokeId), { x: 150, y: 150 }, 1)).toBe(true);

    const at = screenXY(pressed);
    act(() => {
      const note = objectById(board.screen, noteId);
      pointer("pointerDown", note, at[0], at[1]);
      pointer("pointerUp", note, at[0], at[1]);
    });

    expect(selectedIds(board.screen)).toEqual([noteId]);
  });

  it("a click on the board at the line selects it, and a click on the box's empty corner clears the selection", () => {
    const board = renderBoard();
    const id = addStroke(board, straightPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 11));

    const on = screenXY({ x: 100, y: 1 });
    act(() => {
      pointer("pointerDown", boardSpace(board.screen), on[0], on[1]);
      pointer("pointerUp", boardSpace(board.screen), on[0], on[1]);
    });
    expect(selectedIds(board.screen)).toEqual([id]);

    // The box's top-right corner is 100 units from the line: nothing is there.
    const off = screenXY({ x: 200, y: 100 });
    act(() => {
      pointer("pointerDown", boardSpace(board.screen), off[0], off[1]);
      pointer("pointerUp", boardSpace(board.screen), off[0], off[1]);
    });
    expect(selectedIds(board.screen)).toEqual([]);
  });
});

describe("stroke.object: the StrokeObject", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws a smoothed path in the pen colour at the pen's world thickness", () => {
    const board = renderBoard();
    const id = addStroke(board, straightPath({ x: 100, y: 100 }, { x: 300, y: 180 }, 9), {
      color: "purple",
      thickness: "thick",
    });

    const el = objectById(board.screen, id);
    expect(el.dataset.objectType).toBe("stroke");
    expect(el.dataset.penColor).toBe("purple");
    expect(el.dataset.penThickness).toBe("thick");
    expect(el.dataset.noteId).toBe(id);

    const path = board.screen.getByTestId("stroke-path");
    expect(path.getAttribute("stroke")).toBe(PEN_COLORS.purple);
    expect(path.getAttribute("stroke-width")).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(path.getAttribute("stroke-linecap")).toBe("round");
    expect(path.getAttribute("stroke-linejoin")).toBe("round");
    // Curves, not a polyline: smoothing rounds the corners (`stroke.smooth`).
    expect(path.getAttribute("d")).toContain("Q ");
  });

  it("draws every point through scaledPoints, so a resized stroke draws resized", () => {
    const board = renderBoard();
    const id = addStroke(board, straightPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 3));
    const stroke = strokeOf(board, id);

    const before = scaledPoints(stroke);
    changeModel(() => {
      const objects = board.doc.getMap<Y.Map<unknown>>("objects");
      const entry = objects.get(id);
      if (!entry) throw new Error("the stroke is not in the document");
      entry.set("width", stroke.width * 2);
      entry.set("height", stroke.height * 2);
    });

    const after = scaledPoints(strokeOf(board, id));
    // The path scales about the box's own origin: the span doubles, and every point
    // moves away from the origin by the same factor.
    expect(after[1]!.x - after[0]!.x).toBeCloseTo(2 * (before[1]!.x - before[0]!.x), 6);
    expect(after[0]!.x).toBeCloseTo(stroke.x + (before[0]!.x - stroke.x) * 2, 6);
    expect(after[1]!.x).toBeCloseTo(stroke.x + (before[1]!.x - stroke.x) * 2, 6);
  });

  it("gives a stroke a hit path wider than the line, and never one narrower than the click tolerance", () => {
    const board = renderBoard();
    addStroke(board, straightPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 5), { thickness: "thin" });
    const hit = board.screen.getByTestId("stroke-hit");
    const expectedWidth = Math.max(PEN_THICKNESS_WORLD.thin * 2, STROKE_HIT_TOLERANCE_PX * 2);
    expect(Number(hit.getAttribute("stroke-width"))).toBeCloseTo(expectedWidth, 6);
    expect(hit.getAttribute("pointer-events")).toBe("stroke");
    expect(board.screen.getByTestId("stroke-path").getAttribute("pointer-events")).toBe("none");
    // The box itself answers nothing: only the hit path does.
    expect(objectById(board.screen, strokesOf(board)[0]!.id).style.pointerEvents).toBe("none");
  });

  it("a press on the hit path moves the stroke: the generic gesture works from an SVG part of an object", () => {
    const board = renderBoard();
    const id = addStroke(board, straightPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 11));
    const before = readBox(board.doc, id);

    const hit = board.screen.getByTestId("stroke-hit");
    const from = screenOf({ x: 100, y: 0 });
    dragObject(hit, from, { x: from.x + 60, y: from.y + 30 }, { n: 4 });

    const after = readBox(board.doc, id);
    expect(after.x - before.x).toBeCloseTo(60, 3);
    expect(after.y - before.y).toBeCloseTo(30, 3);
    // The same press also selects it, exactly as a press on a sticky note does.
    expect(selectedIds(board.screen)).toEqual([id]);
  });

  it("registers stroke as a resizable object with locked proportions and the resize minimum", () => {
    const spec = getObjectType("stroke");
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
  });
});

describe("stroke.remove: a stroke that is deleted while selected", () => {
  beforeEach(() => {
    runAnimationFramesSynchronously();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-21 deleting a selected stroke clears the selection and leaves nothing behind", () => {
    const board = renderBoard();
    const id = addStroke(board, straightPath({ x: 40, y: 40 }, { x: 240, y: 140 }, 12));
    act(() => {
      board.selection().click(id);
    });
    expect(selectedIds(board.screen)).toEqual([id]);
    expect(board.screen.queryAllByTestId("resize-handle-nw")).toHaveLength(1);

    // What story 3 does to a selection: the object goes away underneath it.
    changeModel(() => {
      deleteObjects(board.doc, [id]);
    });

    expect(strokesOf(board).length).toBe(0);
    expect(selectedIds(board.screen)).toEqual([]);
    expect(board.screen.queryByTestId("stroke-object")).toBeNull();
    expect(board.screen.queryByTestId("resize-handle-nw")).toBeNull();
    expect(objectCount(board.doc)).toBe(0);
  });
});
