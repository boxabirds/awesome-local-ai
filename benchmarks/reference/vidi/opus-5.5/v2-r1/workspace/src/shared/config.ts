// Named product settings. Later stories add to this file.

/** Minimum zoom (screen px per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons, Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd-wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the starting point that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Side length of a sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in a sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; text beyond what fits at this size is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) after which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
