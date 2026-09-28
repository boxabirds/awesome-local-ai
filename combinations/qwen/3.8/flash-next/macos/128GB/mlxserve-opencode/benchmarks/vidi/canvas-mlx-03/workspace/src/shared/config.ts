// All named product/settings constants for vidi6 live here.
// Stories 2-5 add to this file.

/** Minimum zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom level. */
export const ZOOM_MAX = 4;
/** Each zoom step multiplies/divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Pan distance (world units) that must remain reachable per PRD "No edges". */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Helper: clamp a value between min and max inclusive. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Number of percentage points per unit of zoom (100 for percent display). */
export const PERCENT_PER_UNIT = 100;

/**
 * Epsilon for snapping zoom steps to the nearest ZOOM_STEP_FACTOR^n.
 * Keeps "in then out" exact despite float drift.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/**
 * deltaMode conversion: pixels per unit for WHEEL deltaMode LINE.
 * One "line" is treated as a typical mouse-line scroll in CSS pixels.
 */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** deltaMode PAGE conversion: pixels per page unit. */
export const WHEEL_PAGE_HEIGHT_PX = 800;
