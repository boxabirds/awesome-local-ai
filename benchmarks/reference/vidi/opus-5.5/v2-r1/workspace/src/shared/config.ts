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

/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other connected screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify catch-up of offline edits (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e tests (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Compact the board's update log once it has this many rows... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once its rows total this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot row size: far below the platform's per-row size limit (2 MB for SQLite-backed Durable Objects). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A board that failed to load retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size a saved board is verified to open with (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** Time to show a saved board of PERSIST_TESTED_NOTES notes (PRD persist.large_board); logged in e2e. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (not of the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

/** Click on New board to the new board being shown (PRD share.create); logged in e2e. */
export const CREATE_BUDGET_MS = 2000;
/** How long Copy link shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First wait before re-checking a board link the service could not answer; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
