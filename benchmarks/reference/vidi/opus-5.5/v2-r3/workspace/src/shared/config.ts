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

// Story 3 — live collaboration.

/** Soft capacity: design and test target for simultaneous editors, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change reaches every other screen within this time. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// Story 4 — persistence.

/** Compact the update log into a snapshot when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when the log's total bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size; keeps every row far below the platform's 2 MB per-row limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose board failed to load retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target (logged in e2e, not asserted). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the room's SQLite tables (not the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// Story 5 — sharing.

/** PRD share.create: click New board → board visible (logged in e2e, not asserted). */
export const CREATE_BUDGET_MS = 2000;
/** How long Copy link shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First retry of the board existence check; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// Story 7 — selection, move, resize, delete.

/** Side of a selection resize handle in screen pixels (same at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest width/height of a sticky note in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width/height of any board object in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// Story 8 — undo and redo.

/** Typing pause that ends an undo burst; local changes closer together merge into one step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Undo history length per person; the oldest step is dropped beyond this. */
export const UNDO_MAX_STEPS = 200;
