/**
 * Product settings shared across the app. Stories 2-5 add to this file.
 */

/** Minimum board zoom: 10% of the default (100%) scale. */
export const ZOOM_MIN = 0.1;

/** Maximum board zoom: 400% of the default (100%) scale. */
export const ZOOM_MAX = 4;

/** Multiplicative step applied by the zoom buttons and Ctrl/Cmd +/- shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a Ctrl/Cmd+wheel event = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Farthest distance (in world units) that navigation is verified to stay exact. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
