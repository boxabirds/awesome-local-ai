// All named product settings live here. Later stories add to this file.

/** Minimum board zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + =/−). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Radius of a grid dot in screen pixels. */
export const GRID_DOT_RADIUS_PX = 1;
/** Below this on-screen spacing (px) the grid dots fade out proportionally, so a dense grid does not turn into a grey wash. */
export const GRID_FADE_BELOW_SPACING_PX = 12;
