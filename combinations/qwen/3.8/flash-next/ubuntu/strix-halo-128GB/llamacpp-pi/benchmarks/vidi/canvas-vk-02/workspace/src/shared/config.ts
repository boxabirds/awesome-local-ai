/**
 * vidi6 product settings.
 *
 * Every tunable number in the app lives in this file so it can be changed in
 * one place without a redesign. Stories 2-5 add their own sections here.
 */

// ---------------------------------------------------------------------------
// Story 1 — pan and zoom around an infinite board
// ---------------------------------------------------------------------------

/** Smallest zoom (screen pixels per world unit). Label shows 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom (screen pixels per world unit). Label shows 400%. */
export const ZOOM_MAX = 4;

/** Multiplication factor of one zoom step (the + / - buttons and keys). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/**
 * Exponent clamp for the wheel zoom factor, so an absurd wheel delta still
 * produces a finite factor (and therefore clamps at a zoom limit) instead of
 * overflowing to Infinity and being ignored.
 */
export const WHEEL_ZOOM_MAX_EXPONENT = 700;

/** Dot grid pitch in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is verified to still work, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiplier turning a zoom factor into a whole-number percentage label. */
export const ZOOM_PERCENT_SCALE = 100;

/**
 * A stepped zoom snaps to the nearest exact power of ZOOM_STEP_FACTOR when it
 * is within this distance, so a step in followed by a step out returns to
 * exactly the value it started from.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Conversion factor from wheel `deltaMode === LINE` to CSS pixels. */
export const WHEEL_DELTA_MODE_LINE_PX = 16;

/** Dot radius in screen pixels (the grid stays a fixed size on screen). */
export const GRID_DOT_RADIUS_PX = 1;
