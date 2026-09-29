/**
 * Product settings for vidi6. Every named setting that design/system docs call
 * "a product setting that can be changed in one place without redesign" lives
 * here. Stories 2-5 add their own settings to this file.
 */

// --- Camera / zoom -----------------------------------------------------------

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies/divides the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor produced by a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// --- Board geometry ----------------------------------------------------------

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far (in world units) the unbounded-pan guarantee is tested. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes ------------------------------------------------------------

/** A sticky note's width and height in world units (it is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on a note's text length, in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/**
 * The six selectable note colours. The key is the persisted colour name; the
 * value is the fill. Keys double as the accessible/tooltip colour names.
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

/** The colour a freshly created note gets. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
