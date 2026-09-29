import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoomControls } from "@client/canvas/ZoomControls";
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from "@client/canvas/camera";
import { ZOOM_MIN, ZOOM_MAX } from "@shared/config";

const propsFor = (cam: Camera, over: Partial<Parameters<typeof ZoomControls>[0]> = {}) => ({
  zoomPercent: zoomPercent(cam),
  canZoomIn: canZoomIn(cam),
  canZoomOut: canZoomOut(cam),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onReset: vi.fn(),
  ...over,
});

describe("zoom.controls", () => {
  // TC-19
  it("TC-19 at ZOOM_MIN the Zoom-out button is disabled and the label is 10%", () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: ZOOM_MIN })} />);
    const out = screen.getByRole("button", { name: "Zoom out" });
    const inBtn = screen.getByRole("button", { name: "Zoom in" });
    expect(out).toBeDisabled();
    expect(inBtn).toBeEnabled();
    expect(screen.getByTestId("zoom-label")).toHaveTextContent("10%");
  });

  // TC-20
  it("TC-20 at ZOOM_MAX the Zoom-in button is disabled and the label is 400%", () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: ZOOM_MAX })} />);
    const inBtn = screen.getByRole("button", { name: "Zoom in" });
    expect(inBtn).toBeDisabled();
    expect(screen.getByTestId("zoom-label")).toHaveTextContent("400%");
  });

  // TC-21
  it("TC-21 renders a rounded percentage label", () => {
    render(<ZoomControls {...propsFor({ x: 0, y: 0, zoom: 1.5625 })} />);
    expect(screen.getByTestId("zoom-label")).toHaveTextContent("156%");
  });

  // TC-32 (negative)
  it("TC-32 a disabled button does not fire its callback", () => {
    const props = propsFor({ x: 0, y: 0, zoom: ZOOM_MAX });
    render(<ZoomControls {...props} />);
    const inBtn = screen.getByRole("button", { name: "Zoom in" });
    fireEvent.click(inBtn);
    expect(props.onZoomIn).not.toHaveBeenCalled();
    // the enabled Zoom-out button does fire.
    const out = screen.getByRole("button", { name: "Zoom out" });
    fireEvent.click(out);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("Reset view button has an accessible name and fires", () => {
    const props = propsFor({ x: 0, y: 0, zoom: 1 });
    render(<ZoomControls {...props} />);
    const reset = screen.getByRole("button", { name: "Reset view" });
    fireEvent.click(reset);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});
