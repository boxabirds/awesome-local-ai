/**
 * Product settings shared by the client and (later) the Worker.
 * Stories 2–5 add their own named settings to this file.
 */

/** Smallest zoom (screen pixels per world unit). 10 %. */
export const ZOOM_MIN = 0.1;

/** Largest zoom (screen pixels per world unit). 400 %. */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (toolbar buttons, keyboard shortcuts). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is verified to still work, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom fraction -> percentage (1 -> 100 %). */
export const PERCENT_PER_UNIT = 100;
