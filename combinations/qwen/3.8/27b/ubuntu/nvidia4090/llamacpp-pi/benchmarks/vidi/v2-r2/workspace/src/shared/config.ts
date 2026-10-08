/**
 * Product settings for vidi6.
 *
 * All named settings live in this file so they can be changed in one place
 * without redesign. Stories 2-5 add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit): 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + =/−. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom factor is exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), where
 * deltaY is in CSS pixels (positive = scroll down / pinch out on most OSes).
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * The board must pan at least this many world units from the starting point
 * in any direction without an edge or visible grid distortion.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Maximum allowed deviation when snapping a step zoom to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Percent value shown per 1.0 of zoom (zoom 1 → "100%"). */
export const PERCENT_PER_ZOOM = 100;

/** Pixels per delta unit for wheel events reported in LINE delta mode. */
export const WHEEL_LINE_DELTA_PX = 16;

// --- Sticky notes (story 2) ---------------------------------------------------

/** Sticky note size in board (world) units: square, width = height. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may contain. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/**
 * The character counter is visible while this many characters or fewer
 * remain until STICKY_TEXT_MAX_CHARS.
 */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size, in board units at 100% zoom (scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size, in board units at 100% zoom. */
export const STICKY_FONT_MIN_PX = 10;

/**
 * Screen pixels a pointer may move after pressing a note before the press
 * becomes a drag. Below this the press is a plain click (selects the note).
 */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky note colour presets. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

/** Name of one of the six sticky note colour presets. */
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Blue outline drawn around the selected note. */
export const STICKY_SELECTION_OUTLINE = '#1a73e8';

/** Padding inside a note around its text, in board units. */
export const STICKY_TEXT_PADDING = 12;
