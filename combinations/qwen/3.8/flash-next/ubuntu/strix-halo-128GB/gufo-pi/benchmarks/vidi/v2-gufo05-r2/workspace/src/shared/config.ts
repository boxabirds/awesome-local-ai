/**
 * Product settings for vidi6. Every tunable number in the app lives here.
 * Stories 2-5 add their own settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step: the zoom multiplier used by the + / - buttons and keys. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is verified to still work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
