import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { App } from "@client/App";
import { type Camera } from "@client/canvas/camera";

const getCam = (): Camera => {
  const h = (globalThis as unknown as { __vidi6?: { getCamera(): Camera } }).__vidi6;
  if (!h) throw new Error("test hook not registered");
  return h.getCamera();
};

const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

beforeEach(() => {
  document.body.innerHTML = "";
  render(<App />);
});

const surface = () => screen.getByTestId("board-surface");
const world = () => screen.getByTestId("world-layer");

// jsdom's PointerEvent omits clientX/clientY; define them so the handler reads pixels.
// jsdom has no PointerEvent global and its MouseEvent may omit clientX; build a
// mouse event with the pointer* type name and define client coords explicitly.
const pointer = (type: string, x: number, y: number, init: MouseEventInit = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(e, "clientX", { value: x });
  Object.defineProperty(e, "clientY", { value: y });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
};
const send = (el: HTMLElement, e: Event) => {
  let notCancelled = true;
  act(() => {
    notCancelled = el.dispatchEvent(e);
  });
  return notCancelled;
};

describe("viewport.input", () => {
  // TC-13
  it("TC-13 drag moves the board by the pointer delta and cycles Idle→Panning→Idle", () => {
    const before = getCam();
    expect(surface().getAttribute("data-mode")).toBe("idle");
    send(surface(), pointer("pointerdown", 500, 400));
    expect(surface().getAttribute("data-mode")).toBe("panning");
    send(surface(), pointer("pointermove", 700, 500));
    send(surface(), pointer("pointerup", 700, 500));
    expect(surface().getAttribute("data-mode")).toBe("idle");
    const after = getCam();
    expect(near(after.x, before.x - 200)).toBe(true);
    expect(near(after.y, before.y - 100)).toBe(true);
    expect(world().style.transform).toContain("scale(1)");
  });

  // TC-14
  it("TC-14 pointercancel freezes the camera; later moves are ignored", () => {
    send(surface(), pointer("pointerdown", 500, 400));
    send(surface(), pointer("pointermove", 540, 420));
    const atCancel = getCam();
    send(surface(), pointer("pointercancel", 540, 420));
    expect(getCam()).toEqual(atCancel);
    send(surface(), pointer("pointermove", 900, 900));
    expect(getCam()).toEqual(atCancel);
  });

  // TC-15
  it("TC-15 plain wheel scrolls content opposite the scroll and preventDefaults", () => {
    const before = getCam();
    const ev = new WheelEvent("wheel", {
      deltaY: 100,
      clientX: 640,
      clientY: 400,
      bubbles: true,
      cancelable: true,
    });
    send(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    const after = getCam();
    expect(near(after.y, before.y + 100 / before.zoom)).toBe(true);
  });

  // TC-16
  it("TC-16 Ctrl wheel zooms in around the pointer and preventDefaults", () => {
    const before = getCam();
    const ev = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 300,
      clientY: 200,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    send(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(getCam().zoom).toBeGreaterThan(before.zoom);
  });

  // TC-17
  it("TC-17 synthetic gesturechange doubles the zoom and preventDefaults", () => {
    const ev = new Event("gesturechange", { bubbles: true, cancelable: true });
    Object.assign(ev, { scale: 2, clientX: 640, clientY: 400 });
    send(surface(), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(near(getCam().zoom, 2)).toBe(true);
  });

  // TC-18
  it("TC-18 keyboard Ctrl + = / - / 0 steps zoom and reset, each preventDefault", () => {
    const key = (k: string) => {
      const ev = new KeyboardEvent("keydown", {
        key: k,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
      return getCam().zoom;
    };
    expect(getCam().zoom).toBe(1);
    expect(key("=")).toBeCloseTo(1.25, 6);
    expect(key("-")).toBeCloseTo(1, 6);
    expect(key("0")).toBe(1);
  });

  // TC-29 (negative)
  it("TC-29 a zero-length drag does not change the camera and does not dismiss the hint", () => {
    expect(screen.getByTestId("navigation-hint")).toBeInTheDocument();
    const before = getCam();
    send(surface(), pointer("pointerdown", 400, 400));
    send(surface(), pointer("pointerup", 400, 400));
    expect(getCam()).toEqual(before);
    expect(screen.getByTestId("navigation-hint")).toBeInTheDocument();
  });

  // TC-30 (negative)
  it("TC-30 Ctrl/Cmd wheel over the zoom control does not change the camera", () => {
    const before = getCam();
    const controls = screen.getByTestId("zoom-controls");
    const ev = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: 1200,
      clientY: 700,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    send(controls, ev);
    expect(getCam()).toEqual(before);
  });
});
