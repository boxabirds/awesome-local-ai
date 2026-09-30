// Named product settings. Stories 2–5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel / pinch zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE (Firefox mouse wheels). */
export const WHEEL_LINE_HEIGHT_PX = 16;
