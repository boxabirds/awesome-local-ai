/**
 * zoom.controls component tests (story 1): TC-19, TC-20, TC-21, TC-32.
 *
 * Expected values are derived from the named settings in src/shared/config.ts
 * (ZOOM_MIN, ZOOM_MAX) via the camera helpers, never from literals.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZOOM_MAX, ZOOM_MIN } from "../../src/shared/config";
import { type Camera, zoomPercent } from "../../src/client/canvas/camera";
import { ZoomControls } from "../../src/client/canvas/ZoomControls";

function cameraAt(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

// No fake timers here: user-event drives the pointer sequence with real
// timers, and these tests involve no rAF-coalesced updates.
afterEach(() => {
  cleanup();
});

describe("zoom.controls", () => {
  it("TC-19: at the minimum zoom the Zoom out button is disabled and the label shows the minimum", () => {
    render(
      <ZoomControls
        zoomPercent={zoomPercent(cameraAt(ZOOM_MIN))}
        canZoomIn
        canZoomOut={false}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    expect(screen.getByTestId("zoom-label").textContent).toBe(
      `${zoomPercent(cameraAt(ZOOM_MIN))}%`,
    );
  });

  it("TC-20: at the maximum zoom the Zoom in button is disabled and the label shows the maximum", () => {
    render(
      <ZoomControls
        zoomPercent={zoomPercent(cameraAt(ZOOM_MAX))}
        canZoomIn={false}
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
    expect(screen.getByTestId("zoom-label").textContent).toBe(
      `${zoomPercent(cameraAt(ZOOM_MAX))}%`,
    );
  });

  it("TC-21: the label shows the zoom rounded to the nearest whole percent", () => {
    render(
      <ZoomControls
        zoomPercent={zoomPercent(cameraAt(1.5625))}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(zoomPercent(cameraAt(1.5625))).toBe(156);
    expect(screen.getByTestId("zoom-label").textContent).toBe("156%");
  });

  it("TC-32: clicking a disabled zoom button does not call its callback", async () => {
    const onZoomIn = vi.fn();
    const user = userEvent.setup();
    render(
      <ZoomControls
        zoomPercent={zoomPercent(cameraAt(ZOOM_MAX))}
        canZoomIn={false}
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomIn).not.toHaveBeenCalled();
  });
});
