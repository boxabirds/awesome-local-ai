// Product settings for vidi6. Every tunable number that shapes the product
// lives here so it can be changed in one place without a redesign.
// Stories 2-5 add their own settings to this file.

// --- Board navigation (story 1) ---

/** Smallest zoom level: screen pixels per world unit. Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the unbounded-pan requirement is tested, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Pixels per wheel "line" when a wheel event reports `deltaMode === LINE`.
 * Browsers do not report pixels for line/page deltas, so we convert with this.
 */
export const WHEEL_LINE_PX = 32;
/** Pixels per wheel "page" when a wheel event reports `deltaMode === PAGE`. */
export const WHEEL_PAGE_PX = 800;

// --- Sticky notes (story 2) ---

/** Sticky note width and height in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;
/** Longest note text, in characters; further characters are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel that turns a press on a note into a drag, in screen px. */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours, as CSS colours. Keys are the stored colour names. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
