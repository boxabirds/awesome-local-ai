// Named product settings for vidi6. Stories 2-5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative zoom step for buttons and keyboard shortcuts (1.25). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a Ctrl/Cmd wheel = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) from the start that pan is tested to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" delta (WheelEvent.deltaMode === 1). */
export const WHEEL_LINE_DELTA_PX = 16;
/** Pixels per wheel "page" delta (WheelEvent.deltaMode === 2). */
export const WHEEL_PAGE_DELTA_PX = 100;

// --- Story 2: Sticky notes ---

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter shows when remaining chars <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;
/** Minimum pointer movement (screen px) before a drag starts. */
export const DRAG_THRESHOLD_PX = 3;
/** The six available sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Default colour for new sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
