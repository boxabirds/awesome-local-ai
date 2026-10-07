// Product settings for vidi6. Every tunable product value lives here so it
// can be changed in one place without redesign (story 1 "Constraints").

// --- Board navigation (story 1) -------------------------------------------

/** Minimum zoom: 10% (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** The board must remain usable at least this far from the origin. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel deltaMode LINE is converted to pixels with this factor. */
export const WHEEL_DELTA_LINE_PX = 16;
/** Wheel deltaMode PAGE is converted to pixels with this factor. */
export const WHEEL_DELTA_PAGE_PX = 100;
/** Percentage shown for a zoom of 1. */
export const PERCENT_PER_UNIT = 100;
/** Step snapping: zoom is snapped to the nearest ZOOM_STEP_FACTOR^n within this relative epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// --- Sticky notes (story 2) -------------------------------------------------

/** Sticky note side length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters of text in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter is shown when at most this many characters remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size (px at 100% zoom; in world units so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) beyond which a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * The six note colours. Keys are the colour names used in the document
 * schema; values are the fills.
 */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
