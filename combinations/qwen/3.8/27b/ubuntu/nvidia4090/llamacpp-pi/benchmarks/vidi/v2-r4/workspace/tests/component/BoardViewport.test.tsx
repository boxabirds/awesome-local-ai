/**
 * viewport.input component tests (story 1): TC-13 to TC-18, TC-29, TC-30.
 *
 * Uses fake timers so rAF-coalesced camera updates flush deterministically
 * (advanceFrame advances one 16 ms frame).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZOOM_MAX } from "../../src/shared/config";
import { type Camera } from "../../src/client/canvas/camera";
import { advanceFrame, TestBoard } from "./testBoard";

const INITIAL: Camera = { x: -640, y: -400, zoom: 1 };

function cameraOf(): Camera {
  const snapshot = screen.getByTestId("camera-snapshot").textContent ?? "{}";
  return JSON.parse(snapshot) as Camera;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("viewport.input", () => {
  it("TC-13: pointerdown/move/up drags the board; the world layer transform matches the camera and the mode goes Idle→Panning→Idle", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");
    const world = screen.getByTestId("board-world");

    expect(root.getAttribute("data-mode")).toBe("idle");

    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 640, clientY: 400 });
    expect(root.getAttribute("data-mode")).toBe("panning");

    fireEvent.pointerMove(root, { pointerId: 1, clientX: 840, clientY: 500 });
    await advanceFrame();

    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(root.getAttribute("data-mode")).toBe("idle");

    expect(cameraOf()).toEqual({ x: -840, y: -500, zoom: 1 });
    expect(world.style.transform).toBe("scale(1) translate(840px, 500px)");
  });

  it("TC-14: a drag interrupted by pointercancel freezes the camera; later moves are ignored", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");

    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 640, clientY: 400 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 740, clientY: 450 });
    await advanceFrame();
    const cameraAtCancel = cameraOf();
    expect(cameraAtCancel).toEqual({ x: -740, y: -450, zoom: 1 });

    fireEvent.pointerCancel(root, { pointerId: 1 });
    expect(root.getAttribute("data-mode")).toBe("idle");

    fireEvent.pointerMove(root, { pointerId: 1, clientX: 940, clientY: 600 });
    await advanceFrame();
    expect(cameraOf()).toEqual(cameraAtCancel);
  });

  it("TC-15: a plain wheel pans the board and the event is default-prevented", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");

    const event = new WheelEvent("wheel", {
      deltaMode: 0,
      deltaX: 0,
      deltaY: 100,
      cancelable: true,
    });
    root.dispatchEvent(event);
    await advanceFrame();

    expect(event.defaultPrevented).toBe(true);
    // camera y increases by deltaY/zoom (scrolling down moves content up).
    expect(cameraOf()).toEqual({ x: -640, y: -300, zoom: 1 });
  });

  it("TC-16: a Ctrl wheel zooms in and the event is default-prevented", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");

    const event = new WheelEvent("wheel", {
      deltaMode: 0,
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
      cancelable: true,
    });
    root.dispatchEvent(event);
    await advanceFrame();

    expect(event.defaultPrevented).toBe(true);
    const camera = cameraOf();
    // factor = exp(-(-100) * 0.01) = e
    expect(camera.zoom).toBeCloseTo(Math.E, 9);
    expect(camera.zoom).toBeLessThan(ZOOM_MAX);
  });

  it("TC-17: a Safari gesturechange with scale 2 doubles the zoom and is default-prevented", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");

    const event = new Event("gesturechange", { cancelable: true });
    Object.defineProperty(event, "scale", { value: 2 });
    root.dispatchEvent(event);
    await advanceFrame();

    expect(event.defaultPrevented).toBe(true);
    expect(cameraOf().zoom).toBe(2);
  });

  it("TC-18: Ctrl+= , Ctrl+- and Ctrl+0 zoom in, zoom out and reset; each is default-prevented", async () => {
    render(<TestBoard />);

    const press = async (key: string) => {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true });
      window.dispatchEvent(event);
      await advanceFrame();
      return event;
    };

    expect((await press("=")).defaultPrevented).toBe(true);
    expect(cameraOf().zoom).toBe(1.25);

    expect((await press("-")).defaultPrevented).toBe(true);
    expect(cameraOf().zoom).toBe(1);

    expect((await press("0")).defaultPrevented).toBe(true);
    expect(cameraOf()).toEqual(INITIAL);
  });

  it("TC-29: clicking empty space without moving leaves the camera unchanged and the hint is not dismissed", async () => {
    render(<TestBoard />);
    const root = screen.getByTestId("board-viewport");

    expect(screen.getByTestId("navigation-hint")).not.toBeNull();

    fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 640, clientY: 400 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    await advanceFrame();

    expect(cameraOf()).toEqual(INITIAL);
    expect(screen.getByTestId("navigation-hint")).not.toBeNull();
  });

  it("TC-30: a Ctrl wheel over the zoom controls does not zoom the board and is not default-prevented", async () => {
    render(<TestBoard />);
    const controls = screen.getByTestId("zoom-controls");

    const event = new WheelEvent("wheel", {
      deltaMode: 0,
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    controls.dispatchEvent(event);
    await advanceFrame();

    expect(event.defaultPrevented).toBe(false);
    expect(cameraOf()).toEqual(INITIAL);
  });
});
