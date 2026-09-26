// Named product settings for vidi6.
//
// Stories add their settings to this file so every tunable value lives in
// one place and can be changed without redesigning a component.

/** Smallest allowed zoom, as screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom, as screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + = / −. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Sensitivity of Ctrl/Cmd + scroll zooming.
 * The zoom factor for a wheel event is `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Spacing between dot grid points, in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Farthest a user may pan from the board's starting point while the board is
 * still expected to render crisply (PRD "No edges"). Used by tests to jump to
 * a distant location.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_LINE_PX = 16;

/** Pixels per wheel "page" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_PAGE_PX = 100;
