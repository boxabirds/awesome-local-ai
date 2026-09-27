// Product / navigation settings. Stories 2-5 add to this file.
// Changing these must not require a redesign elsewhere.

// Zoom limits (screen pixels per world unit).
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

// One zoom step multiplies/divides the zoom by this factor (buttons + Ctrl/Cmd +/-).
export const ZOOM_STEP_FACTOR = 1.25;

// Wheel/pinch zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Dot grid spacing in world units (screen spacing = GRID_SPACING_WORLD * zoom).
export const GRID_SPACING_WORLD = 24;

// How far a test pans from the start to prove the board is effectively unbounded.
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// zoomPercent = Math.round(zoom * ZOOM_PERCENT_SCALE).
export const ZOOM_PERCENT_SCALE = 100;

// A zoom value this close to ZOOM_STEP_FACTOR^n snaps exactly to that power,
// so a step in then out returns to exactly 1.0 (avoids float drift).
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Wheel deltaMode unit conversions to CSS pixels (named to avoid magic numbers).
export const WHEEL_DELTA_LINE_PX = 16; // one "line" unit in pixels
export const WHEEL_DELTA_PAGE_PX = 800; // one "page" unit in pixels
