/**
 * nav.hint_display component tests (story 1): TC-22.
 *
 * The hint is driven by the real useCamera hasNavigated latch: visible on
 * first render, hidden after the first camera change, and never shown again
 * during the visit.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceFrame, TestBoard } from "./testBoard";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("nav.hint_display", () => {
  it("TC-22: the hint is visible initially, hidden after the first camera change, and stays hidden after another", async () => {
    render(<TestBoard />);

    expect(screen.getByTestId("navigation-hint")).not.toBeNull();

    // First navigation: click the zoom-in button (a real camera change).
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await advanceFrame();
    expect(screen.queryByTestId("navigation-hint")).toBeNull();

    // Second navigation: the hint must not come back.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await advanceFrame();
    expect(screen.queryByTestId("navigation-hint")).toBeNull();
  });
});
