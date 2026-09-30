// Product settings shared across the app. Stories 2-5 add to this file.

// Zoom limits and step size (PRD "Settings").
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversions (design: convert LINE/PAGE to pixels).
export const WHEEL_LINE_HEIGHT_PX = 16; // deltaMode === DOM_DELTA_LINE
export const WHEEL_PAGE_HEIGHT_PX = 800; // deltaMode === DOM_DELTA_PAGE

// Convert a raw wheel delta (in the given deltaMode) to CSS pixels.
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case DELTA_MODE_PAGE:
      return delta * WHEEL_PAGE_HEIGHT_PX;
    default:
      return delta;
  }
}
