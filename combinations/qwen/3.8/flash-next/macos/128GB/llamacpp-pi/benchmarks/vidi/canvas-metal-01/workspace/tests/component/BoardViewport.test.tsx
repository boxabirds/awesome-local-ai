// BoardViewport component tests: TC-13 .. TC-18, TC-29, TC-30.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GRID_SPACING_WORLD,
  NAVIGATION_HINT_TEXT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP_FACTOR,
} from "../../src/shared/config";
import { App } from "../../src/client/App";
import { resetCamera, zoomAt } from "../../src/client/canvas/camera";
import {
  VIEWPORT_SIZE,
  dispatchGesture,
  dispatchKey,
  dispatchWheel,
  flushFrame,
  readCamera,
} from "./helpers";

function board(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

function world(): HTMLElement {
  return screen.getByTestId("world-layer");
}

function hint(): HTMLElement | null {
  return screen.queryByTestId("navigation-hint");
}

/** Pan anchor used by the drag tests: a point on the empty board. */
const FROM = { x: 100, y: 50 };
const TO = { x: 300, y: 150 };

function drag(from = FROM, to = TO): void {
  const el = board();
  fireEvent.pointerDown(el, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(el, {
    pointerId: 1,
    pointerType: "mouse",
    buttons: 1,
    clientX: to.x,
    clientY: to.y,
  });
}

beforeEach(() => {
  render(<App />);
});

describe("drag to pan (TC-13)", () => {
  it("moves the board by exactly the pointer movement and returns to idle", async () => {
    const start = readCamera(board());
    expect(start).toEqual(resetCamera(VIEWPORT_SIZE));
    expect(board().dataset.panState).toBe("idle");

    drag();
    expect(board().dataset.panState).toBe("panning");
    await flushFrame();

    const moved = readCamera(board());
    expect(moved.x).toBeCloseTo(start.x - (TO.x - FROM.x), 6);
    expect(moved.y).toBeCloseTo(start.y - (TO.y - FROM.y), 6);
    expect(moved.zoom).toBe(1);

    // The world layer transform is the camera.
    expect(world().style.transform).toBe(
      `scale(${moved.zoom}) translate(${-moved.x}px, ${-moved.y}px)`,
    );
    // The dot grid moves with the board.
    expect(board().style.backgroundSize).toBe(
      `${GRID_SPACING_WORLD * moved.zoom}px ${GRID_SPACING_WORLD * moved.zoom}px`,
    );

    fireEvent.pointerUp(board(), { pointerId: 1, pointerType: "mouse" });
    expect(board().dataset.panState).toBe("idle");
  });
});

describe("interrupted drag (TC-14)", () => {
  it("keeps the camera frozen at the moment of pointercancel", async () => {
    drag();
    await flushFrame();
    const atCancel = readCamera(board());

    fireEvent.pointerCancel(board(), { pointerId: 1, pointerType: "mouse" });
    expect(board().dataset.panState).toBe("idle");

    // Pointer moves after the drag ended are ignored.
    fireEvent.pointerMove(board(), {
      pointerId: 1,
      pointerType: "mouse",
      buttons: 1,
      clientX: 900,
      clientY: 900,
    });
    await flushFrame();
    expect(readCamera(board())).toEqual(atCancel);
  });
});

describe("scroll to pan (TC-15)", () => {
  it("moves the board by the wheel delta and prevents the browser default", async () => {
    const start = readCamera(board());
    const event = dispatchWheel(board(), { deltaY: 100 });
    await flushFrame();

    const moved = readCamera(board());
    expect(moved.y).toBeCloseTo(start.y + 100 / start.zoom, 6);
    expect(moved.x).toBeCloseTo(start.x, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it("moves the board horizontally for a trackpad swipe", async () => {
    const start = readCamera(board());
    dispatchWheel(board(), { deltaX: 60 });
    await flushFrame();
    expect(readCamera(board()).x).toBeCloseTo(start.x + 60 / start.zoom, 6);
  });
});

describe("Ctrl/Cmd + wheel zoom (TC-16)", () => {
  it("zooms in around the pointer and prevents the browser default", async () => {
    const start = readCamera(board());
    const point = { x: 300, y: 200 };
    const event = dispatchWheel(board(), {
      deltaY: -100,
      ctrlKey: true,
      clientX: point.x,
      clientY: point.y,
    });
    await flushFrame();

    const zoomed = readCamera(board());
    expect(zoomed.zoom).toBeGreaterThan(start.zoom);
    // The world point under the pointer did not move.
    const expected = zoomAt(
      start,
      point,
      Math.exp(-100 * -WHEEL_ZOOM_SENSITIVITY),
    );
    expect(zoomed.x).toBeCloseTo(expected.x, 6);
    expect(zoomed.y).toBeCloseTo(expected.y, 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it("treats Cmd like Ctrl (macOS pinch)", async () => {
    const start = readCamera(board());
    dispatchWheel(board(), {
      deltaY: -50,
      metaKey: true,
      clientX: 10,
      clientY: 10,
    });
    await flushFrame();
    expect(readCamera(board()).zoom).toBeGreaterThan(start.zoom);
  });
});

describe("Safari pinch gesture (TC-17)", () => {
  it("doubles the zoom for gesturechange scale 2 and prevents the browser default", async () => {
    const start = readCamera(board());
    const startEvent = dispatchGesture(board(), "gesturestart", 1);
    const event = dispatchGesture(board(), "gesturechange", 2);
    await flushFrame();

    expect(readCamera(board()).zoom).toBeCloseTo(start.zoom * 2, 6);
    expect(startEvent.defaultPrevented).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("applies the incremental scale between gesturechange events", async () => {
    const start = readCamera(board());
    dispatchGesture(board(), "gesturestart", 1);
    dispatchGesture(board(), "gesturechange", 2);
    await flushFrame();
    dispatchGesture(board(), "gesturechange", 3); // 1.5x more
    await flushFrame();
    expect(readCamera(board()).zoom).toBeCloseTo(start.zoom * 3, 6);
  });
});

describe("keyboard shortcuts (TC-18)", () => {
  it("zooms in, zooms out and resets with Ctrl/Cmd + = - 0", async () => {
    const start = readCamera(board());
    expect(start.zoom).toBe(1);

    const inEvent = dispatchKey("=", { ctrlKey: true });
    expect(inEvent.defaultPrevented).toBe(true);
    await flushFrame();
    expect(readCamera(board()).zoom).toBe(ZOOM_STEP_FACTOR);

    const outEvent = dispatchKey("-", { ctrlKey: true });
    expect(outEvent.defaultPrevented).toBe(true);
    await flushFrame();
    expect(readCamera(board()).zoom).toBe(1);

    // Move away first, so reset has something to undo.
    dispatchKey("=", { metaKey: true });
    await flushFrame();
    const resetEvent = dispatchKey("0", { metaKey: true });
    expect(resetEvent.defaultPrevented).toBe(true);
    await flushFrame();
    expect(readCamera(board())).toEqual(resetCamera(VIEWPORT_SIZE));
  });
});

describe("click without moving (TC-29)", () => {
  it("leaves the camera alone and keeps the hint visible", async () => {
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    const before = readCamera(board());

    fireEvent.pointerDown(board(), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerUp(board(), {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 400,
      clientY: 400,
    });
    await flushFrame();

    expect(readCamera(board())).toEqual(before);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
  });
});

describe("gestures over the zoom control (TC-30)", () => {
  it("does not zoom the board and does not suppress the browser default", async () => {
    const before = readCamera(board());
    const controls = board()
      .closest(".vidi6-app")!
      .querySelector<HTMLElement>('[data-board-part="zoom-controls"]')!;

    const event = dispatchWheel(controls, { deltaY: -100, ctrlKey: true });
    await flushFrame();

    expect(readCamera(board())).toEqual(before);
    expect(event.defaultPrevented).toBe(false);
  });
});
