import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/client/App";
import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from "../../src/client/canvas/NavigationHint";

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function pointer(type: string, el: HTMLElement, x: number, y: number) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}

function dragBy(dx: number, dy: number) {
  const board = screen.getByTestId("board-viewport");
  pointer("pointerdown", board, 400, 300);
  pointer("pointermove", board, 400 + dx, 300 + dy);
  pointer("pointerup", board, 400 + dx, 300 + dy);
}

function hint() {
  return screen.queryByTestId("navigation-hint");
}

describe("NavigationHint nav.hint_display", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1200 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
  });

  it("renders the exact hint text when visible and nothing when not", () => {
    const { unmount } = render(<NavigationHint visible />);
    const element = hint();
    expect(element).toBeTruthy();
    expect(element?.textContent).toBe(NAVIGATION_HINT_TEXT);
    unmount();

    render(<NavigationHint visible={false} />);
    expect(hint()).toBeNull();
  });

  it("TC-22: visible on open, hidden after the first camera change, still hidden after the second", async () => {
    render(<App />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    dragBy(120, -40);
    await settle();
    expect(hint()).toBeNull();

    dragBy(-300, 220);
    await settle();
    expect(hint()).toBeNull();
  });

  it("TC-22b: any kind of navigation dismisses the hint (keyboard zoom)", async () => {
    render(<App />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await settle();
    expect(hint()).toBeNull();
  });

  it("TC-22c: a press without movement does not dismiss the hint", async () => {
    render(<App />);
    const board = screen.getByTestId("board-viewport");
    pointer("pointerdown", board, 500, 400);
    pointer("pointerup", board, 500, 400);
    await settle();
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it("a zoom already at a limit does not dismiss the hint", async () => {
    render(<App />);
    window.__vidi6?.setCamera({ x: -600, y: -400, zoom: 4 });
    await settle();
    expect(hint()).toBeTruthy();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await settle();
    expect(hint()).toBeTruthy();
  });
});
