// Named product settings. Stories 2–5 add to this file.

/** Minimum zoom (screen px per world unit). 0.1 = 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom. 4 = 400%. */
export const ZOOM_MAX = 4;
/** Multiplier for one zoom step (buttons and Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin the board is verified to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Step zoom snaps to ZOOM_STEP_FACTOR^n when within this relative tolerance. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Percentage conversion for the zoom label. */
export const PERCENT = 100;
/** Wheel deltaMode LINE → pixels. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Dot grid spacing doubles when zoomed out until dots are at least this far apart on screen. */
export const GRID_MIN_SCREEN_SPACING_PX = 8;
