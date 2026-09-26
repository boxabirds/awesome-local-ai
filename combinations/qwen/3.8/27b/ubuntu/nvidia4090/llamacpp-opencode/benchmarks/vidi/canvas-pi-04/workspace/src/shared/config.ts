// Named product settings for vidi6.
//
// Stories add their settings to this file so every tunable value lives in
// one place and can be changed without redesigning a component.

/** Smallest allowed zoom, as screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom, as screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + = / −. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Sensitivity of Ctrl/Cmd + scroll zooming.
 * The zoom factor for a wheel event is `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Spacing between dot grid points, in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Farthest a user may pan from the board's starting point while the board is
 * still expected to render crisply (PRD "No edges"). Used by tests to jump to
 * a distant location.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_LINE_PX = 16;

/** Pixels per wheel "page" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_PAGE_PX = 100;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note side length, in world units (the note is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when the remaining capacity is at or below this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel, in screen px, before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by name (names are the stored values). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

/** A preset note colour name. */
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration -------------------------------------------

/**
 * Soft board capacity: the design and tests target this many simultaneous
 * editors. Deliberately never enforced by the worker (live.over_capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** A change made on one client must be visible on every other within this. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** WebsocketProvider `maxBackoffTime` for reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays visible after a reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

// ---------------------------------------------------------------------------
// Story 4: persistence, compaction, load failure.
// ---------------------------------------------------------------------------

/** Story 4, design decision 2: SQLite schema version. */
export const STORAGE_SCHEMA_VERSION = 1;

/** Story 4: the update-log row count that triggers compaction (TC-17). */
export const COMPACTION_UPDATE_COUNT = 500;

/** Story 4: the update-log byte total that triggers compaction (design decision 4). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Story 4: the snapshot size that forces chunking (design decision 5). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** Story 4: minimum interval between storage SELECT retry attempts (TC-26). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** Story 4: the note count the persistence path is explicitly tested at (TC-08, TC-21). */
export const PERSIST_TESTED_NOTES = 2000;

/** Story 4: a board of PERSIST_TESTED_NOTES must render within this of navigation start. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Length of the simulated network outage in the catch-up e2e test. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
