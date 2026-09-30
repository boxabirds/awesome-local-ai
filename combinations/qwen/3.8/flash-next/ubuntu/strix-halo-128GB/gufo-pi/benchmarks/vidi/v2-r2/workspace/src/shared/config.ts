// Product settings shared across the app. Stories 2-5 add to this file.

// Sticky note settings (story 2).
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
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

// Zoom limits and step size (PRD "Settings").
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversions (design: convert LINE/PAGE to pixels).
export const WHEEL_LINE_HEIGHT_PX = 16; // deltaMode === DOM_DELTA_LINE
export const WHEEL_PAGE_HEIGHT_PX = 800; // deltaMode === DOM_DELTA_PAGE

// Convert a raw wheel delta (in the given deltaMode) to CSS pixels.
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case DELTA_MODE_PAGE:
      return delta * WHEEL_PAGE_HEIGHT_PX;
    default:
      return delta;
  }
}
