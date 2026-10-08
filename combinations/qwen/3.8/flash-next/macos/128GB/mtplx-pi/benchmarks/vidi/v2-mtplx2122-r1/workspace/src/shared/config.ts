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

// ── Shape settings (story 10) ──────────────────────────────────────────────
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const
export type ShapeKind = typeof SHAPE_KINDS[number]
export const SHAPE_DEFAULT_SIZE_WORLD = 160
export const SHAPE_MIN_SIZE_WORLD = 20
export const SHAPE_LABEL_MAX_CHARS = 500
export const SHAPE_STROKE_WIDTH_WORLD = 2
export const SHAPE_FILL_COLORS = {
  none: 'transparent', white: '#FFFFFF', blue: '#BBDEFB',
  green: '#C8E6C9', yellow: '#FFF9C4', pink: '#F8BBD0', grey: '#E0E0E0',
} as const
export const SHAPE_STROKE_COLORS = {
  dark: '#263238', blue: '#1E88E5', green: '#43A047',
  orange: '#FB8C00', red: '#E53935', grey: '#9E9E9E',
} as const
export type FillColor = keyof typeof SHAPE_FILL_COLORS
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS
export const DEFAULT_SHAPE_FILL: FillColor = 'white'
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark'

// ── Connector settings (story 10) ──────────────────────────────────────────
export const CONNECTOR_MIN_LENGTH_WORLD = 8
export const CONNECTOR_HIT_TOLERANCE_PX = 6
export const CONNECTOR_STROKE_WIDTH_WORLD = 2
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10
export const CONNECTOR_DOT_RADIUS_PX = 4

export const DRAG_THRESHOLD_PX = 3
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const
export type StickyColor = keyof typeof STICKY_COLORS
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow'

// ── Text object settings (story 9) ─────────────────────────────────────────
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600
export const TEXT_MIN_WIDTH_WORLD = 40
export const TEXT_MAX_CHARS = 5000
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const
export type TextSize = keyof typeof TEXT_SIZES
export const DEFAULT_TEXT_SIZE: TextSize = 'M'
export const TEXT_LINE_HEIGHT = 1.3
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif'

// ── Undo / redo settings (story 8) ──────────────────────────────────────────

/** Typing pause that ends a burst; also the UndoManager capture window. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500
/** Most recent steps kept in a person's personal undo history. */
export const UNDO_MAX_STEPS = 200

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
