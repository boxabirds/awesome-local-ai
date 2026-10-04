/**
 * Product settings for the board. Every tunable number lives here so it can be
 * changed in one place without a redesign (stories 2-5 add to this file).
 */

/** Smallest zoom level the board can be scaled to (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom level the board can be scaled to. */
export const ZOOM_MAX = 4;

/** Multiplier applied by one zoom step (a zoom step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = Math.exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one line unit of a wheel event (`deltaMode === LINES`). */
export const WHEEL_LINE_PX = 16;

/** Fraction of the viewport one page unit of a wheel event represents. */
export const WHEEL_PAGE_VIEWPORT_FRACTION = 1;

/** `WheelEvent.deltaMode` values, named so the conversion reads clearly. */
export const WHEEL_DELTA_MODE_PIXELS = 0;
export const WHEEL_DELTA_MODE_LINES = 1;
export const WHEEL_DELTA_MODE_PAGES = 2;
