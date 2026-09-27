// NavigationHint component tests: TC-22 (and the hint half of TC-29).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NAVIGATION_HINT_TEXT } from "../../src/shared/config";
import { App } from "../../src/client/App";
import { NavigationHint } from "../../src/client/canvas/NavigationHint";
import { flushFrame } from "./helpers";

function hint(): HTMLElement | null {
  return screen.queryByTestId("navigation-hint");
}

function board(): HTMLElement {
  return screen.getByTestId("board-viewport");
}

async function panByPointer(dx: number, dy: number): Promise<void> {
  const el = board();
  fireEvent.pointerDown(el, {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 0,
    clientY: 0,
  });
  fireEvent.pointerMove(el, {
    pointerId: 1,
    pointerType: "mouse",
    buttons: 1,
    clientX: dx,
    clientY: dy,
  });
  await flushFrame();
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: "mouse" });
}

describe("NavigationHint (unit)", () => {
  it("renders the exact hint text when visible", () => {
    const { container } = render(<NavigationHint visible />);
    expect(container.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it("renders nothing when not visible", () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("first-use lifecycle (TC-22)", () => {
  it("is visible on load, hidden by the first camera change and stays hidden", async () => {
    render(<App />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    await panByPointer(100, 40);
    expect(hint()).toBeNull();

    await panByPointer(100, 40);
    expect(hint()).toBeNull();
  });

  it("is dismissed by a zoom as well as a pan", async () => {
    render(<App />);
    expect(hint()).not.toBeNull();

    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      ctrlKey: true,
      clientX: 200,
      clientY: 200,
    });
    board().dispatchEvent(event);
    await flushFrame();
    expect(hint()).toBeNull();
  });
});
