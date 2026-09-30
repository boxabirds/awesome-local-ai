// Named product settings. Stories 2–5 add to this file.

/** Minimum zoom (screen px per world unit). 0.1 = 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom. 4 = 400%. */
export const ZOOM_MAX = 4;
/** Multiplier for one zoom step (buttons and Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin the board is verified to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Step zoom snaps to ZOOM_STEP_FACTOR^n when within this relative tolerance. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Percentage conversion for the zoom label. */
export const PERCENT = 100;
/** Wheel deltaMode LINE → pixels. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Dot grid spacing doubles when zoomed out until dots are at least this far apart on screen. */
export const GRID_MIN_SCREEN_SPACING_PX = 8;

// Story 2 — sticky notes.

/** Sticky note width and height in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size (px at 100% zoom); below this text is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) after which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** Inner padding of a sticky note in world units. */
export const STICKY_PADDING_WORLD = 16;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
/** Current board document schema version (meta.schemaVersion). */
export const BOARD_SCHEMA_VERSION = 1;
