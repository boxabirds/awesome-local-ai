import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PERCENT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from "../../src/shared/config";
import { ZoomControls } from "../../src/client/canvas/ZoomControls";
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from "../../src/client/canvas/camera";

function renderControls(cam: Camera, handlers: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onReset = vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent(cam)}
      canZoomIn={canZoomIn(cam)}
      canZoomOut={canZoomOut(cam)}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
      {...handlers}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
}

const outBtn = () => screen.getByLabelText("Zoom out");
const inBtn = () => screen.getByLabelText("Zoom in");
const label = () => screen.getByTestId("zoom-label");

describe("ZoomControls zoom.controls", () => {
  it("TC-19: at ZOOM_MIN the Zoom out button is disabled and the label reads 10%", () => {
    const cam: Camera = { x: 0, y: 0, zoom: ZOOM_MIN };
    renderControls(cam);

    expect(outBtn().hasAttribute("disabled")).toBe(true);
    expect(outBtn().getAttribute("aria-label")).toBe("Zoom out");
    expect(inBtn().hasAttribute("disabled")).toBe(false);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * PERCENT)}%`);
    expect(label().getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("button", { name: "Reset view" })).toBeTruthy();
  });

  it("TC-20: at ZOOM_MAX the Zoom in button is disabled and the label reads 400%", () => {
    const cam: Camera = { x: -1234, y: 5678, zoom: ZOOM_MAX };
    renderControls(cam);

    expect(inBtn().hasAttribute("disabled")).toBe(true);
    expect(outBtn().hasAttribute("disabled")).toBe(false);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * PERCENT)}%`);
  });

  it("TC-19b: the label reads 100%, 125% and 400% at those zoom levels", () => {
    for (const zoom of [1, ZOOM_STEP_FACTOR, ZOOM_MAX]) {
      renderControls({ x: 0, y: 0, zoom });
      expect(label().textContent).toBe(`${Math.round(zoom * PERCENT)}%`);
      cleanup();
    }
  });

  it("TC-21: the Reset view button is enabled at every zoom level and calls onReset", () => {
    for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
      const { onReset } = renderControls({ x: 999_999, y: -999_999, zoom });
      const reset = screen.getByRole("button", { name: "Reset view" });
      expect(reset.hasAttribute("disabled")).toBe(false);
      fireEvent.click(reset);
      expect(onReset).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it.each([1.5625, 1.56, 1])("TC-32b: zoom %s renders the label rounded to a whole percent", (zoom) => {
    renderControls({ x: 0, y: 0, zoom });
    expect(label().textContent).toBe(`${Math.round(zoom * PERCENT)}%`);
  });

  it("TC-20b: clicking a disabled button does nothing", () => {
    const { onZoomIn, onZoomOut, onReset } = renderControls({ x: 0, y: 0, zoom: ZOOM_MAX });

    fireEvent.click(inBtn());
    expect(onZoomIn).not.toHaveBeenCalled();
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(outBtn());
    expect(onZoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("enabled buttons call their callbacks", () => {
    const { onZoomIn, onZoomOut } = renderControls({ x: 0, y: 0, zoom: 1 });

    fireEvent.click(inBtn());
    fireEvent.click(outBtn());
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("buttons are keyboard focusable with accessible names", () => {
    renderControls({ x: 0, y: 0, zoom: 1 });
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Zoom out",
      "Zoom in",
      "Reset view",
    ]);

    inBtn().focus();
    expect(document.activeElement).toBe(inBtn());
  });
});
