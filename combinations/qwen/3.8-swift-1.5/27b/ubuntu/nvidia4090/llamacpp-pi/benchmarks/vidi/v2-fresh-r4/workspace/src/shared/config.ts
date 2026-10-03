// Product settings shared across the app. Stories 2-5 add to this file.

/** Minimum board zoom, in screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

// --- Story 2: Sticky notes ---

/** Size of a sticky note in world units (square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note can hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Counter shows when remaining characters <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Maximum font size in px (at 100% zoom, board units). */
export const STICKY_FONT_MAX_PX = 24;

/** Minimum font size in px (at 100% zoom, board units). */
export const STICKY_FONT_MIN_PX = 10;

/** Minimum pointer movement in screen px before a drag starts. */
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

/** Maximum board zoom, in screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied per zoom step (button or Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a wheel with Ctrl/Cmd held = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** Minimum panning extent (world units from the starting point) that must stay usable. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 3: Live collaboration ---

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1 second change delivery budget. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
