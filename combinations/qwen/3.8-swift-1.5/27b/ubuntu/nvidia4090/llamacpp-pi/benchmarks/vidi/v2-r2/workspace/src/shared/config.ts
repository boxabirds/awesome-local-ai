export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Story 2: sticky notes
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

// Story 3: live collaboration
export const MAX_CONCURRENT_EDITORS = 5;            // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;   // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000;      // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000;       // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;       // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;       // functional wait in e2e (all stories); latency is logged, not asserted

// Story 4: persistence
export const COMPACTION_UPDATE_COUNT = 500;          // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024;     // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;      // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;      // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000;            // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000;            // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;

// Story 7: multi-selection, group move/resize/delete
export const HANDLE_SIZE_PX = 8;
export const STICKY_MIN_SIZE_WORLD = 50;
export const MAX_OBJECT_SIZE_WORLD = 20_000;
export const NUDGE_STEP_WORLD = 1;
export const NUDGE_LARGE_STEP_WORLD = 10;

// Story 5: sharing boards
export const CREATE_BUDGET_MS = 2000;                // PRD share.create
export const LINK_COPIED_MS = 2000;                  // PRD share.copy
export const BOARD_CHECK_RETRY_BASE_MS = 1000;       // backoff doubles up to RECONNECT_MAX_BACKOFF_MS (story 3)

// Story 8: undo and redo
export const UNDO_CAPTURE_TIMEOUT_MS = 500;   // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;

// Story 9: free text
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600; // auto width caps here, then wraps
export const TEXT_MIN_WIDTH_WORLD = 40;       // minimum fixed width (side handle)
export const TEXT_MAX_CHARS = 5000;           // hard character limit per text object
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// Story 10: shapes and connectors
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;
export const SHAPE_FILL_COLORS = { none: 'transparent', white: '#FFFFFF', blue: '#BBDEFB', green: '#C8E6C9', yellow: '#FFF9C4', pink: '#F8BBD0', grey: '#E0E0E0' } as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export const SHAPE_STROKE_COLORS = { dark: '#263238', blue: '#1E88E5', green: '#43A047', orange: '#FB8C00', red: '#E53935', grey: '#9E9E9E' } as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;
