/**
 * Product settings shared by the client (and, later, the Worker).
 * These are the "settings" named in the story designs: zoom limits, step size,
 * grid spacing. Changing a value here is the single place a designer can tune
 * the board without a redesign (PRD "Settings").
 */

/** Smallest zoom factor the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom factor the board can reach. */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (a step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot-grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far the unbounded-board requirement is tested (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ---- Story 2 · sticky notes (design "Named settings") --------------------
 * These are the story-2 product settings, defined once here so a designer can
 * retune notes without a redesign (PRD "Settings"). */

/** Sticky note edge length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters kept in one note; extra characters are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once the remaining budget is <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in world units (at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size before text is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by their accessible name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
