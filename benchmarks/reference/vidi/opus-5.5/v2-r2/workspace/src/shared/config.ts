// Named product settings. Stories 2–5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel / pinch zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE (Firefox mouse wheels). */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Side length of a sticky note in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows while editing when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest sticky note font size (board units, i.e. px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest sticky note font size; text that does not fit at this size is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) after which a press on an object becomes a drag. */
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
/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change must reach every other screen within this time. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the PRD live.catch_up verification. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e tests (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Compact a board's update log into a snapshot when this many log rows exist… */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when the log's bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size; keeps every row far below the platform's per-row size limit (2 MB). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose board failed to load retries the load at most this often (on a new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: the board size that must open within BOARD_LOAD_BUDGET_MS. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target for a PERSIST_TESTED_NOTES board (logged, not asserted). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (the Yjs document schema is versioned separately). */
export const STORAGE_SCHEMA_VERSION = 1;

/** PRD share.create: click New board → empty board visible (logged in e2e, not asserted). */
export const CREATE_BUDGET_MS = 2000;
/** How long Copy link shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
