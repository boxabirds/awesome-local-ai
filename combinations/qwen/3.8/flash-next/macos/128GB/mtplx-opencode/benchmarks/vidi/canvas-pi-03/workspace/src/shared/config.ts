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
// --- Sticky notes (story 2) -------------------------------------------------

/** Sticky note size in world units (a square STICKY_SIZE_WORLD x STICKY_SIZE_WORLD). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters kept in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter is shown when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest sticky-note font size (px, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest sticky-note font size (px, at 100% zoom); below this text overflows. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) beyond which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky-note colours (accessible by name, not only by colour). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
