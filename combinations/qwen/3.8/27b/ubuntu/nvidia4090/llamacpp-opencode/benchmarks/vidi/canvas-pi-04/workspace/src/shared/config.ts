// Named product settings for vidi6.
//
// Stories add their settings to this file so every tunable value lives in
// one place and can be changed without redesigning a component.

/** Smallest allowed zoom, as screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom, as screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + = / −. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Sensitivity of Ctrl/Cmd + scroll zooming.
 * The zoom factor for a wheel event is `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Spacing between dot grid points, in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Farthest a user may pan from the board's starting point while the board is
 * still expected to render crisply (PRD "No edges"). Used by tests to jump to
 * a distant location.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_LINE_PX = 16;

/** Pixels per wheel "page" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_PAGE_PX = 100;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note side length, in world units (the note is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when the remaining capacity is at or below this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel, in screen px, before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by name (names are the stored values). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

/** A preset note colour name. */
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
