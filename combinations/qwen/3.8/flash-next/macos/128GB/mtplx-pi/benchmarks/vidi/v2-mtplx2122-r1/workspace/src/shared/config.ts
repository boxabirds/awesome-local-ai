export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4
export const ZOOM_STEP_FACTOR = 1.25
export const WHEEL_ZOOM_SENSITIVITY = 0.01 // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000

// Wheel deltaMode conversion factors (line -> px, page -> px)
export const WHEEL_LINE_TO_PX = 16
export const WHEEL_PAGE_TO_PX = 800

// ── Sticky note settings ─────────────────────────────────────────────────────
export const STICKY_SIZE_WORLD = 200
export const STICKY_TEXT_MAX_CHARS = 1000
export const STICKY_COUNTER_THRESHOLD_CHARS = 50 // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24
export const STICKY_FONT_MIN_PX = 10
export const DRAG_THRESHOLD_PX = 3
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const
export type StickyColor = keyof typeof STICKY_COLORS
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow'

// ── Live collaboration settings (story 3) ────────────────────────────────────

/** Soft simultaneous-editor capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5
/** live.propagate budget: change on sender screen → change on receiver screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000
/** Passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000
/** Outage length used by the live.catch_up verification (PRD). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000
/** Generous functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000

// ── Persistence settings (story 4) ───────────────────────────────────────────

/** Compact the update log once this many rows exist. */
export const COMPACTION_UPDATE_COUNT = 500
/** …or when the log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024
/** Snapshot chunk size: keeps every row well under the platform per-row limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024
/** A LoadFailed room retries its load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000
/** Board size used by the persist.large_board verification (PRD). */
export const PERSIST_TESTED_NOTES = 2000
/** Open-time target for that board (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000
/** Version of the storage tables (not of the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1

// ── Sharing settings (story 5) ───────────────────────────────────────────────

/** Click-to-board budget for "New board" (PRD share.create, 2 s typical broadband). */
export const CREATE_BUDGET_MS = 2000
/** How long the Share panel keeps the "Link copied" confirmation. */
export const LINK_COPIED_MS = 2000
/**
 * First backoff step while a board link is being checked with an unreachable
 * service; each retry doubles it, capped at {@link RECONNECT_MAX_BACKOFF_MS}.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000
/** Board links are `https://host/b/<id>`; `id` is 22 base64url characters. */
export const BOARD_PATH_PREFIX = '/b/'
