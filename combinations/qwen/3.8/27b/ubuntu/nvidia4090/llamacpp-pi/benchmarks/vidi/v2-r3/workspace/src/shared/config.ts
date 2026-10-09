/**
 * Named product settings.
 *
 * Story 1 — camera and grid
 * Story 2 — sticky notes
 * Story 3 — live collaboration
 * Story 4 — persistence
 * Story 5 — sharing a board by link
 * Story 7 — multi-select, move, resize, delete
 * Story 8 — per-user undo and redo
 * Story 9 — free text objects
 * Story 10 — shapes and connectors
 * Story 11 — pen (freehand sketching)
 */

// Story 1
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Story 2
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

// Story 3
export const MAX_CONCURRENT_EDITORS = 5; // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000; // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000; // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000; // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000; // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000; // functional wait in e2e (all stories); latency is logged, not asserted

// Story 4
export const COMPACTION_UPDATE_COUNT = 500; // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024; // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024; // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000; // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000; // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000; // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;

// Story 5
export const CREATE_BUDGET_MS = 2000; // PRD share.create: click to board visible
export const LINK_COPIED_MS = 2000; // "Link copied" confirmation duration
export const BOARD_CHECK_RETRY_BASE_MS = 1000; // backoff doubles up to RECONNECT_MAX_BACKOFF_MS

// Story 7
export const HANDLE_SIZE_PX = 8; // resize handle size in screen pixels (any zoom)
export const STICKY_MIN_SIZE_WORLD = 50; // sticky notes cannot be resized below this (board units)
export const MAX_OBJECT_SIZE_WORLD = 20_000; // no object may be resized above this (board units)
export const NUDGE_STEP_WORLD = 1; // arrow-key nudge (board units)
export const NUDGE_LARGE_STEP_WORLD = 10; // Shift+arrow-key nudge (board units)

// Story 8
export const UNDO_CAPTURE_TIMEOUT_MS = 500; // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;

// Story 9
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600; // auto-width text wraps beyond this (board units)
export const TEXT_MIN_WIDTH_WORLD = 40; // fixed-width text cannot be narrower than this (board units)
export const TEXT_MAX_CHARS = 5000; // text length limit
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const; // font sizes in board units
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3; // line height as a multiple of the font size
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// Story 10
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export const DEFAULT_SHAPE_FILL = 'white';
export const DEFAULT_SHAPE_STROKE = 'dark';
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;

// Story 11

/** Pen colours. The keys are the saved `color` values on a stroke. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

/**
 * Pen thicknesses in *world* units (they do not scale with zoom). The keys
 * are the saved `thickness` values on a stroke.
 */
export const PEN_THICKNESS_WORLD = {
  thin: 2,
  medium: 4,
  thick: 8,
} as const;

/** Default pen colour (session state, story 11 `pen.options`). */
export const DEFAULT_PEN_COLOR: keyof typeof PEN_COLORS = 'black';

/** Default pen thickness (session state, story 11 `pen.options`). */
export const DEFAULT_PEN_THICKNESS: keyof typeof PEN_THICKNESS_WORLD = 'medium';

/**
 * RDP simplify tolerance in *screen* pixels at the current zoom (story 11
 * `stroke.model`): a 1 px tolerance at the zoom you drew with.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * A stroke records at most this many points; at the limit the part drawn so
 * far is committed and the rest continues as the next stroke (story 11
 * `pen.tool`).
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * The minimum world distance from the drawn line for a stroke to accept a
 * click/tap/drag on it (story 11 `stroke.object`).
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/**
 * Minimum world size of a stroke's bbox while resizing (story 11
 * `stroke.object`).
 */
export const STROKE_MIN_SIZE_WORLD = 4;

// Story 12

/** The image MIME types vidi6 accepts for board images (sel 12). */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** Maximum upload size: 10 MB. */
export const IMAGE_MAX_BYTES: number = 10 * 1024 * 1024;

/** Maximum number of image files accepted per drop / paste / picker action. */
export const IMAGE_MAX_FILES_PER_ADD: number = 20;

/**
 * A dropped image is placed at its natural size unless its longest side
 * exceeds this many world units, in which case it is scaled down
 * proportionally to it.
 */
export const IMAGE_MAX_PLACE_SIZE_WORLD: number = 800;

/** Neither side of an image may be resized below this many world units. */
export const IMAGE_MIN_SIZE_WORLD: number = 16;

/** Horizontal gap between the placeholder boxes of one add action. */
export const IMAGE_LAYOUT_GAP_WORLD: number = 24;

/**
 * An 'uploading' image whose uploadStartedAt is older than this is shown as
 * 'unfinished' (the uploader's tab closed or the network died mid-upload).
 */
export const IMAGE_UPLOAD_STALE_MS: number = 5 * 60 * 1000;

/** Images never change: one year of immutable caching. */
export const ASSET_CACHE_MAX_AGE_SECONDS: number = 365 * 24 * 60 * 60;

/** How many leading bytes the worker reads to sniff the image format. */
export const IMAGE_SNIFF_BYTES: number = 12;
