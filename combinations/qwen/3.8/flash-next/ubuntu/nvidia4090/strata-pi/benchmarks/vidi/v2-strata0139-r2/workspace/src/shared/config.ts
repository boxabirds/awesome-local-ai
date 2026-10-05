/**
 * Product settings for vidi6.
 *
 * All magic numbers live here so they can be changed in one place without a
 * redesign. Stories 2+ add their settings to this file.
 */

// ---- Board camera (story 1) ----------------------------------------------

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative step used by the +/- buttons and Ctrl/Cmd +/- keys. */
export const ZOOM_STEP_FACTOR = 1.25;
/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Epsilon used when a stepped zoom is snapped to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Camera zoom -> percentage label multiplier. */
export const PERCENT = 100;

/** Wheel deltaMode=LINE (DOM lines) converted to CSS pixels. */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Wheel deltaMode=PAGE (one page) converted to CSS pixels. */
export const WHEEL_PAGE_DELTA_PIXELS = 800;

// ---- Rendering (story 1) -------------------------------------------------

/** Radius of a dot-grid dot, in CSS pixels (screen space). */
export const GRID_DOT_RADIUS_SCREEN = 1.5;
/** Dot-grid dot colour. */
export const GRID_DOT_COLOR = "#c3c8cf";
/** Size of the origin crosshair marker, in world units. */
export const ORIGIN_MARKER_SIZE_WORLD = 16;
