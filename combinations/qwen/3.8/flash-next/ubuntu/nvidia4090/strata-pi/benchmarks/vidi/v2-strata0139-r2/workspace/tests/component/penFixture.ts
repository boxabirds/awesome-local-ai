import { vi } from "vitest";
import { snapshot } from "../../src/shared/board-model";
import { createStroke, type StrokeSnap } from "../../src/shared/objects/stroke";
import type { PenColor, PenThickness } from "../../src/shared/config";
import type { Point } from "../../src/shared/geometry";
import {
  act,
  boardSpace,
  changeModel,
  pointer,
  pressKey,
  screenOf,
  type RenderHandle,
} from "./boardFixture";

/**
 * Shared helpers for story 11's component tests (`PenTool.test.tsx` and
 * `StrokeObject.test.tsx`): strokes read from the document, strokes written
 * through the model, and drags expressed in **board** points.
 */

/** The board's strokes, in the order the document has them. */
export function strokesOf(board: RenderHandle): StrokeSnap[] {
  return snapshot(board.doc).filter((object): object is StrokeSnap => object.type === "stroke");
}

export function strokeOf(board: RenderHandle, id: string): StrokeSnap {
  const found = strokesOf(board).find((object) => object.id === id);
  if (!found) throw new Error(`no stroke ${id} in the model`);
  return found;
}

/** The tool the board is in, read where the board says it. */
export function activeTool(board: RenderHandle): string | undefined {
  return board.screen.getByTestId("board-viewport").dataset.tool;
}

export function armPen(board: RenderHandle): void {
  pressKey("p");
  if (activeTool(board) !== "pen") throw new Error("the board did not arm the Pen");
}

/** `pointer(...)` wants x and y as separate arguments; these are board points. */
export function screenXY(point: Point): [number, number] {
  const at = screenOf(point);
  return [at.x, at.y];
}

/** Drags the pen through board points, in one `act`, so React keeps up. */
export function drawPen(board: RenderHandle, worldPoints: readonly Point[]): void {
  const space = boardSpace(board.screen);
  const points = worldPoints.map((point) => screenOf(point));
  act(() => {
    const first = points[0]!;
    pointer("pointerDown", space, first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index]!;
      pointer("pointerMove", space, point.x, point.y);
    }
    const last = points[points.length - 1]!;
    pointer("pointerUp", space, last.x, last.y);
  });
}

/** A pen press that lets go without moving. */
export function tapPen(board: RenderHandle, at: Point): void {
  drawPen(board, [at]);
}

/** A stroke written through the model rather than drawn, for the rendering tests. */
export function addStroke(
  board: RenderHandle,
  points: readonly Point[],
  options: { color?: PenColor; thickness?: PenThickness } = {},
): string {
  let id = "";
  changeModel(() => {
    const created = createStroke(board.doc, {
      points,
      color: options.color ?? "black",
      thickness: options.thickness ?? "medium",
    });
    if (typeof created !== "string") throw new Error("createStroke rejected the stroke");
    id = created;
  });
  return id;
}

/** Moves the board's camera, through story 1's test-only hook. */
export function setCamera(camera: { x: number; y: number; zoom: number }): void {
  const api = window.__vidi6;
  if (!api) throw new Error("window.__vidi6 test hook is not installed");
  act(() => {
    api.setCamera(camera);
  });
}

/** A frame mock that queues callbacks without running them, for long drags. */
export function queueAnimationFrames(): { queued(): number; flush(): void } {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id: number): void => {
    callbacks.delete(id);
  });
  return {
    queued: () => callbacks.size,
    flush() {
      const batch = Array.from(callbacks.values());
      callbacks.clear();
      for (const callback of batch) callback(0);
    },
  };
}

/** Frames are never run at all: a 5,000-point drag then costs no renders. */
export function dropAnimationFrames(): void {
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((): void => undefined);
}
