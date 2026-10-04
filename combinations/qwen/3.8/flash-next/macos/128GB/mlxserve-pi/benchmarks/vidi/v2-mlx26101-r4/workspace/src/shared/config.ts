/**
 * Product settings for the board. Every tunable number lives here so it can be
 * changed in one place without a redesign (stories 2-5 add to this file).
 */

/** Smallest zoom level the board can be scaled to (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom level the board can be scaled to. */
export const ZOOM_MAX = 4;

/** Multiplier applied by one zoom step (a zoom step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = Math.exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one line unit of a wheel event (`deltaMode === LINES`). */
export const WHEEL_LINE_PX = 16;

/** Fraction of the viewport one page unit of a wheel event represents. */
export const WHEEL_PAGE_VIEWPORT_FRACTION = 1;

/** `WheelEvent.deltaMode` values, named so the conversion reads clearly. */
export const WHEEL_DELTA_MODE_PIXELS = 0;
export const WHEEL_DELTA_MODE_LINES = 1;
export const WHEEL_DELTA_MODE_PAGES = 2;

/* ------------------------------------------------------------- sticky notes -- */

/** Width and height of a sticky note in world units (it is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Longest note text the board accepts; characters beyond it are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows and is faded out. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Space between a note's edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 12;

/** The six note colours, keyed by the name used in the document and in labels. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
