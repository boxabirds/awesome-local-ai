// Shared product settings for vidi6.
// Stories 2-5 add further settings to this file.
//
// Story 1 (Pan and zoom around an infinite board) owns the camera / grid settings.

/** Minimum zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit). 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative size of a single zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Pan distance (world units) the board must handle without edges or distortion. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ─── Story 2: Sticky notes ───────────────────────────────────────────────────

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters allowed in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Maximum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Minimum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;

/** Distance in screen pixels before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset colours for sticky notes. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour applied to newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
