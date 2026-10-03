/**
 * Product settings for vidi6. Every tunable number in the app lives here.
 * Stories 2-5 add their own settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step: the zoom multiplier used by the + / - buttons and keys. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is verified to still work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------------ * *
 * Story 2: sticky notes                                                *
 * ------------------------------------------------------------------ */

/** Width and height of a new sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on characters kept in a single note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest auto-fit font size (board units, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest auto-fit font size; below this text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Screen pixels a pointer must move after pointerdown to start a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Inner padding of a sticky note, in world units (text never touches edges). */
export const STICKY_PADDING_WORLD = 16;

/** The six sticky-note colours. Keys are the stored names. */
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
