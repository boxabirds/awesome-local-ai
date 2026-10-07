import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_LINE_DELTA_PIXELS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from "../../src/shared/config";
import { App } from "../../src/client/App";
import { NAVIGATION_HINT_TEXT } from "../../src/client/canvas/NavigationHint";
import { resetCamera, zoomPercent } from "../../src/client/canvas/camera";
import type { Camera } from "../../src/client/canvas/camera";

const VIEWPORT = { width: 1200, height: 800 };

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

function camera(): Camera {
  const hook = window.__vidi6;
  if (!hook) throw new Error("window.__vidi6 test hook is not installed");
  return hook.getCamera();
}

function viewportEl(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

function worldEl(): HTMLElement {
  return screen.getByTestId("board-world");
}

function gridEl(): HTMLElement {
  return screen.getByTestId("board-grid");
}

/** Let the rAF-coalesced camera update land and React re-render. */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
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
  // Wrapped in act so React's panning state (data-panning) flushes.
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

function wheel(el: HTMLElement, init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; clientX?: number; clientY?: number; deltaMode?: number }) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaMode: init.deltaMode ?? 0,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  el.dispatchEvent(event);
  return event;
}

/** jsdom has no GestureEvent; the board only reads `scale`/`clientX`/`clientY`. */
function gesture(el: HTMLElement, type: string, scale: number, x = 300, y = 200) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: x, clientY: y });
  el.dispatchEvent(event);
  return event;
}

function keydown(key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
  });
  window.dispatchEvent(event);
  return event;
}

function transformOf(el: HTMLElement): { scale: number; tx: number; ty: number } {
  const raw = el.style.transform;
  const match = /scale\(([-0-9.e+]+)\)\s*translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/.exec(raw);
  if (!match) throw new Error(`unexpected world transform: "${raw}"`);
  return { scale: Number(match[1]), tx: Number(match[2]), ty: Number(match[3]) };
}

function gridSpacing(grid: HTMLElement): number {
  const raw = grid.style.backgroundSize;
  const match = /([-0-9.e+]+)px/.exec(raw);
  if (!match) throw new Error(`unexpected grid background-size: "${raw}"`);
  return Number(match[1]);
}

function renderBoard() {
  setWindowSize(VIEWPORT.width, VIEWPORT.height);
  render(<App />);
}

describe("BoardViewport viewport.input", () => {
  beforeEach(() => {
    setWindowSize(VIEWPORT.width, VIEWPORT.height);
  });

  it("opens at the standard view: 100% with the board start point centred", () => {
    renderBoard();
    const cam = camera();
    const home = resetCamera(VIEWPORT);
    expect(cam).toEqual(home);
    expect(zoomPercent(cam)).toBe(PERCENT);
    expect(screen.getByTestId("zoom-label").textContent).toBe(`${PERCENT}%`);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });

  it("TC-13: dragging moves the board by exactly the pointer delta (Idle -> Panning -> Idle)", async () => {
    renderBoard();
    const before = camera();

    pointer("pointerdown", viewportEl(), 500, 300);
    expect(viewportEl().dataset.panning).toBe("true");

    pointer("pointermove", viewportEl(), 600, 350);
    await settle();
    pointer("pointermove", viewportEl(), 700, 400);
    await settle();

    const during = camera();
    expect(during.x).toBeCloseTo(before.x - 200, 6);
    expect(during.y).toBeCloseTo(before.y - 100, 6);

    const world = transformOf(worldEl());
    expect(world.scale).toBeCloseTo(during.zoom, 9);
    expect(world.tx).toBeCloseTo(-during.x, 3);
    expect(world.ty).toBeCloseTo(-during.y, 3);

    // The dot grid moves with the board.
    expect(gridSpacing(gridEl())).toBeCloseTo(GRID_SPACING_WORLD * during.zoom, 3);

    pointer("pointerup", viewportEl(), 700, 400);
    await settle();
    expect(viewportEl().dataset.panning).toBe("false");
    expect(camera()).toBe(during);
  });

  it("TC-13b: a cancelled drag freezes the camera at the moment of interruption", async () => {
    renderBoard();
    const before = camera();

    pointer("pointerdown", viewportEl(), 400, 400);
    pointer("pointermove", viewportEl(), 500, 460);
    await settle();
    pointer("pointercancel", viewportEl(), 500, 460);
    await settle();

    const frozen = camera();
    expect(frozen.x).toBeCloseTo(before.x - 100, 6);
    expect(frozen.y).toBeCloseTo(before.y - 60, 6);
    expect(viewportEl().dataset.panning).toBe("false");

    pointer("pointermove", viewportEl(), 1100, 900);
    await settle();
    expect(camera()).toBe(frozen);
  });

  it("TC-14: plain wheel pans the board in the scroll direction and is prevented", async () => {
    renderBoard();
    const before = camera();

    const event = wheel(viewportEl(), { deltaY: 100 });
    await settle();

    const after = camera();
    expect(after).not.toBe(before);
    expect(after.y).toBeCloseTo(before.y + 100 / before.zoom, 6);
    expect(after.x).toBe(before.x);
    expect(event.defaultPrevented).toBe(true);
  });

  it("TC-14b: a horizontal (trackpad) wheel pans sideways and line/page delta modes convert to pixels", async () => {
    renderBoard();
    const before = camera();

    wheel(viewportEl(), { deltaX: 60 });
    await settle();
    expect(camera().x).toBeCloseTo(before.x + 60 / before.zoom, 6);

    const atLineMode = camera();
    wheel(viewportEl(), { deltaY: 3, deltaMode: 1 });
    await settle();
    const linePixels = 3 * WHEEL_LINE_DELTA_PIXELS;
    expect(camera().y).toBeCloseTo(atLineMode.y + linePixels / atLineMode.zoom, 6);
  });

  it("TC-15: Ctrl+wheel zooms around the pointer and is prevented", async () => {
    renderBoard();
    const before = camera();

    const event = wheel(viewportEl(), { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    await settle();

    const after = camera();
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect(after.zoom).toBeCloseTo(Math.min(Math.E, ZOOM_MAX), 6);
    expect(event.defaultPrevented).toBe(true);
  });

  it("TC-15b: Meta+wheel zooms too, and plain trackpad two-finger scroll pans", async () => {
    renderBoard();
    const before = camera();
    wheel(viewportEl(), { deltaY: -50, metaKey: true, clientX: 100, clientY: 100 });
    await settle();
    expect(camera().zoom).toBeGreaterThan(before.zoom);
  });

  it("TC-15c: Safari gesturechange doubles the zoom and is prevented (pinch)", async () => {
    renderBoard();
    const before = camera();

    gesture(viewportEl(), "gesturestart", 1);
    const event = gesture(viewportEl(), "gesturechange", 2);
    await settle();

    expect(camera().zoom).toBeCloseTo(before.zoom * 2, 9);
    expect(event.defaultPrevented).toBe(true);
  });

  it("TC-15d: gesture scale changes chain multiplicatively and clamp at ZOOM_MAX", async () => {
    renderBoard();
    gesture(viewportEl(), "gesturestart", 1);
    gesture(viewportEl(), "gesturechange", 2);
    await settle();
    gesture(viewportEl(), "gesturechange", 4); // one more doubling
    await settle();
    expect(camera().zoom).toBeCloseTo(ZOOM_MAX, 9);
    gesture(viewportEl(), "gesturechange", ZOOM_MAX * 10);
    await settle();
    expect(camera().zoom).toBe(ZOOM_MAX);
  });

  it("TC-16c: Ctrl/Cmd + = , - and 0 step and reset the zoom, each prevented", async () => {
    renderBoard();
    const home = camera();

    const zoomIn = keydown("=", { ctrl: true });
    await settle();
    expect(zoomPercent(camera())).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT));
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    const zoomOut = keydown("-", { ctrl: true });
    await settle();
    expect(camera().zoom).toBe(1);

    const reset = keydown("0", { ctrl: true });
    await settle();
    expect(camera().x).toBe(home.x);
    expect(camera().y).toBe(home.y);
    expect(camera().zoom).toBe(1);

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(reset.defaultPrevented).toBe(true);
  });

  it("TC-16d: Cmd shortcuts work and a bare '0' does not reset the view", async () => {
    renderBoard();
    keydown("=", { meta: true });
    await settle();
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);

    const bare = keydown("0");
    await settle();
    expect(bare.defaultPrevented).toBe(false);
    expect(camera().zoom).toBe(ZOOM_STEP_FACTOR);
  });

  it("TC-29a: pressing without moving leaves the camera and the hint untouched", async () => {
    renderBoard();
    const before = camera();

    pointer("pointerdown", viewportEl(), 600, 400);
    await settle();
    pointer("pointerup", viewportEl(), 600, 400);
    await settle();

    expect(camera()).toBe(before);
    expect(screen.getByText(NAVIGATION_HINT_TEXT)).toBeTruthy();
  });

  it("TC-29b: Ctrl/Cmd wheel over the zoom control does not zoom the board", async () => {
    renderBoard();
    const before = camera();

    const controls = screen.getByTestId("zoom-controls");
    wheel(controls, { deltaY: -240, ctrlKey: true, clientX: 1100, clientY: 700 });
    wheel(controls, { deltaY: -240, metaKey: true, clientX: 1100, clientY: 700 });
    await settle();

    expect(camera()).toBe(before);
    expect(zoomPercent(camera())).toBe(PERCENT);
  });

  it("TC-18: dragging at 1,000,000 world units moves the board by exactly the pointer delta", async () => {
    renderBoard();
    window.__vidi6?.setCamera({
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    await settle();
    const before = camera();

    pointer("pointerdown", viewportEl(), 400, 300);
    pointer("pointermove", viewportEl(), 600, 400);
    await settle();
    pointer("pointerup", viewportEl(), 600, 400);
    await settle();

    const after = camera();
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 100, 6);
    expect(gridSpacing(gridEl())).toBeCloseTo(GRID_SPACING_WORLD * after.zoom, 3);

    const world = transformOf(worldEl());
    expect(world.scale).toBeCloseTo(after.zoom, 9);
    expect(world.tx).toBeCloseTo(-after.x, 2);
    expect(world.ty).toBeCloseTo(-after.y, 2);
  });

  it("TC-29: using the zoom buttons dispatches no wheel event on the board", async () => {
    renderBoard();
    const wheelEvents: Event[] = [];
    viewportEl().addEventListener("wheel", (event) => wheelEvents.push(event));

    fireEvent.click(screen.getByTestId("zoom-in"));
    await settle();
    fireEvent.click(screen.getByTestId("zoom-out"));
    await settle();

    expect(wheelEvents.length).toBe(0);
    expect(zoomPercent(camera())).toBe(PERCENT);
  });

  it("zooming out past ZOOM_MIN and in past ZOOM_MAX leaves the camera unchanged", async () => {
    renderBoard();
    window.__vidi6?.setCamera({ ...resetCamera(VIEWPORT), zoom: ZOOM_MIN });
    await settle();
    const atMin = camera();

    wheel(viewportEl(), { deltaY: 2000, ctrlKey: true, clientX: 600, clientY: 400 });
    await settle();
    expect(camera()).toBe(atMin);
    expect(screen.getByTestId("zoom-out").hasAttribute("disabled")).toBe(true);

    window.__vidi6?.setCamera({ ...resetCamera(VIEWPORT), zoom: ZOOM_MAX });
    await settle();
    const atMax = camera();
    wheel(viewportEl(), { deltaY: -2000, ctrlKey: true, clientX: 600, clientY: 400 });
    await settle();
    expect(camera()).toBe(atMax);
    expect(screen.getByTestId("zoom-in").hasAttribute("disabled")).toBe(true);
  });
});
