/**
 * Product settings for vidi6. Stories 2-5 add to this file; keep every tunable here.
 */

/** Smallest zoom the camera can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the camera can reach (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (button or keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start point panning is verified to still work, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom step values snap to ZOOM_STEP_FACTOR^n within this absolute tolerance, so one step in then out returns exactly the previous zoom. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a zoom ratio into a whole-number percentage. */
export const PERCENT_SCALE = 100;

/** Pixels per wheel delta unit when `WheelEvent.deltaMode === LINE` (10px per line). */
export const WHEEL_LINE_PIXELS = 10;

/** Pixels per wheel delta unit when `WheelEvent.deltaMode === PAGE` (one page). */
export const WHEEL_PAGE_PIXELS = 800;
