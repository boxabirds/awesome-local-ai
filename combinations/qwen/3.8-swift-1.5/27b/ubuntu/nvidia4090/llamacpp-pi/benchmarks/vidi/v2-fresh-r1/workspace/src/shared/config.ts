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

// --- Story 3: Live collaboration ---

/** Soft capacity: design + test target for simultaneous editors; never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** 1-second budget for live change delivery (PRD live.propagate). Logged, not asserted, in e2e. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Maximum reconnection backoff, passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify offline catch-up (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional (eventual) wait timeout for e2e tests; latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
