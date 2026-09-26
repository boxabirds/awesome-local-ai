// Product settings for the board. All navigation constants live here so they
// can be tuned in one place without touching component code (PRD "Settings").

/** Smallest allowed zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;
/** Largest allowed zoom. 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot-grid spacing measured in world units. */
export const GRID_SPACING_WORLD = 24;
/** The extent (in world units) the board is verified to pan to without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiplier converting a zoom ratio to a whole-number percentage label. */
export const ZOOM_PERCENT_SCALE = 100;
/** Zooms within this distance of a ZOOM_STEP_FACTOR^n snap to it, killing
 * floating-point drift so step-in then step-out returns exactly 1.0 (TC-09). */
export const ZOOM_SNAP_EPS = 1e-9;

/** Wheel deltaMode=LINE (DOM_DELTA_LINE) converted to CSS pixels. */
export const WHEEL_LINE_HEIGHT = 16;
/** Wheel deltaMode=PAGE (DOM_DELTA_PAGE) converted to CSS pixels. */
export const WHEEL_PAGE_HEIGHT = 600;