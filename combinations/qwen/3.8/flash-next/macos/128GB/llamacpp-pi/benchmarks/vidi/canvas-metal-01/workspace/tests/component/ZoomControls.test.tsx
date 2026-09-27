// ZoomControls component tests: TC-19, TC-20, TC-21, TC-32.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PERCENT, ZOOM_MAX, ZOOM_MIN } from "../../src/shared/config";
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
} from "../../src/client/canvas/camera";
import { ZoomControls } from "../../src/client/canvas/ZoomControls";

function cameraAt(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function renderAt(
  zoom: number,
  handlers: Partial<Parameters<typeof ZoomControls>[0]> = {},
) {
  const props = {
    zoomPercent: zoomPercent(cameraAt(zoom)),
    canZoomIn: canZoomIn(cameraAt(zoom)),
    canZoomOut: canZoomOut(cameraAt(zoom)),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...handlers,
  };
  render(<ZoomControls {...props} />);
  return props;
}

function zoomOutButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement;
}

function zoomInButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement;
}

function label(): HTMLElement {
  return screen.getByTestId("zoom-percent");
}

describe("at ZOOM_MIN (TC-19)", () => {
  it("disables Zoom out, keeps Zoom in enabled and shows 10%", () => {
    renderAt(ZOOM_MIN);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * PERCENT)}%`);
    expect(label().textContent).toBe("10%");
    expect(zoomOutButton().disabled).toBe(true);
    expect(zoomInButton().disabled).toBe(false);
  });
});

describe("at ZOOM_MAX (TC-20)", () => {
  it("disables Zoom in and shows 400%", () => {
    renderAt(ZOOM_MAX);
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * PERCENT)}%`);
    expect(label().textContent).toBe("400%");
    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
  });
});

describe("fractional zoom (TC-21)", () => {
  it("shows the zoom rounded to a whole percent", () => {
    renderAt(1.5625);
    expect(label().textContent).toBe("156%");
  });
});

describe("disabled buttons (TC-32)", () => {
  it("does not call the callback of a disabled button", () => {
    const props = renderAt(ZOOM_MAX);
    fireEvent.click(zoomInButton());
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();

    // The enabled counterpart still works.
    fireEvent.click(zoomOutButton());
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("calls the callbacks of enabled buttons", () => {
    const props = renderAt(1);
    fireEvent.click(zoomInButton());
    fireEvent.click(zoomOutButton());
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});

describe("accessible names", () => {
  it("labels the zoom label as a live region so changes are announced", () => {
    renderAt(1);
    expect(label().getAttribute("aria-live")).toBe("polite");
    expect(label().tagName.toLowerCase()).toBe("output");
  });
});
