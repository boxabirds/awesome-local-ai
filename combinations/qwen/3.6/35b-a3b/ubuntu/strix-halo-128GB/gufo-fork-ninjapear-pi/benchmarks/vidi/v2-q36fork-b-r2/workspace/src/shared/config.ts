// Zoom settings
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Grid settings
export const GRID_SPACING_WORLD = 24;

// Test extent
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Snap epsilon for step zoom to avoid float drift
export const SNAP_EPSILON = 1e-9;

// Wheel delta mode conversion (pixels per line/page)
export const LINE_TO_PIXELS = 20;
export const PAGE_TO_PIXELS = 400;

// Navigation hint text
export const NAV_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

// Live collaboration settings (story 3)
export const MAX_CONCURRENT_EDITORS = 5;              // soft capacity target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;    // PRD live.propagate budget
export const RECONNECT_MAX_BACKOFF_MS = 10_000;       // WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000;        // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;        // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;        // functional wait in e2e across stories

// Handle and selection settings
export const HANDLE_SIZE_PX = 8;
export const STICKY_MIN_SIZE_WORLD = 50;
export const MAX_OBJECT_SIZE_WORLD = 20_000;
export const NUDGE_STEP_WORLD = 1;
export const NUDGE_LARGE_STEP_WORLD = 10;

// Sticky note settings
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// Board sharing settings (story 5)
export const CREATE_BUDGET_MS = 2000;             // PRD share.create
export const LINK_COPIED_MS = 2000;
export const BOARD_CHECK_RETRY_BASE_MS = 1000;    // backoff doubles up to RECONNECT_MAX_BACKOFF_MS

// Undo settings (story 8)
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
export const UNDO_MAX_STEPS = 200;

// Text object settings (story 9)
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
export const TEXT_MIN_WIDTH_WORLD = 40;
export const TEXT_MAX_CHARS = 5000;
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// Shape settings (story 10)
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
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

// Connector settings (story 10)
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;

// Persistence settings (story 4)
export const COMPACTION_UPDATE_COUNT = 500;
export const COMPACTION_BYTES = 4 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
export const PERSIST_TESTED_NOTES = 2000;
export const BOARD_LOAD_BUDGET_MS = 3000;
export const STORAGE_SCHEMA_VERSION = 1;
