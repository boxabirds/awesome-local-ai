/**
 * Product settings shared by the client and (later) the worker.
 * Stories 2-5 add to this file. Every tunable value the design names lives here.
 */

/** Minimum zoom level (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the unbounded board is tested, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiply a zoom by this to get a whole-number percentage label. */
export const PERCENT = 100;

/** Wheel deltaMode: one delta unit is one line of text. */
export const WHEEL_DELTA_MODE_LINE = 1;

/** Wheel deltaMode: one delta unit is one page. */
export const WHEEL_DELTA_MODE_PAGE = 2;

/** Pixels per wheel "line" delta unit (matches Chrome's default line height). */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Pixels per wheel "page" delta unit (a typical viewport height). */
export const WHEEL_PAGE_HEIGHT_PX = 800;

/**
 * Step zoom snaps to the nearest power of ZOOM_STEP_FACTOR when within this
 * distance, so 1.25 followed by 0.8 returns exactly 1.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/* Sticky notes (story 2) -------------------------------------------------- */

/** A sticky note is a square of this many world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters of text kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (px at 100% zoom; scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size before the overflow fades out. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky note colours. */
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
