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

// Story 9 — free text.

/** Auto-width text grows to its longest line up to this width, then wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest fixed width a side handle can give a text object. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters in one text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets (font size in world units). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Extra width added to an auto-width line so the caret and sub-pixel rounding never force a wrap. */
export const TEXT_CARET_ALLOWANCE_WORLD = 4;
/** Estimated average glyph width as a fraction of the font size, used when text cannot be measured. */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.55;

// Story 10 — shapes and connectors.

/** Shape kinds offered by the Shape tool's menu. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Width and height of a shape dropped with a click (or a too-small drag). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Smallest dragged shape; a drag below this on either axis counts as a click. Also the resize minimum. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum number of characters in a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Shape outline width in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
export const SHAPE_FILL_COLORS = {
  none: 'transparent', white: '#FFFFFF', blue: '#BBDEFB', green: '#C8E6C9',
  yellow: '#FFF9C4', pink: '#F8BBD0', grey: '#E0E0E0',
} as const;
export const SHAPE_STROKE_COLORS = {
  dark: '#263238', blue: '#1E88E5', green: '#43A047', orange: '#FB8C00', red: '#E53935', grey: '#9E9E9E',
} as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Shorter arrows are not created (accidental clicks). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** A click within this many screen pixels of an arrow's line selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead length in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of the connection dots shown by the Connector tool, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Colour of arrows (story 10 has no arrow styling). */
export const CONNECTOR_COLOR = '#263238';
/** Font size of shape labels in world units. */
export const SHAPE_LABEL_FONT_PX = 16;
/** Inner padding of a shape's label box in world units. */
export const SHAPE_LABEL_PADDING_WORLD = 8;

// Story 11 — freehand pen.

/** The six pen colours offered by the pen toolbar. */
export const PEN_COLORS = { black: '#212121', blue: '#1E88E5', red: '#E53935', green: '#43A047', orange: '#FB8C00', purple: '#8E24AA' } as const;
/** Pen line thicknesses in world units (strokes scale with zoom like everything else). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
/** A finished stroke stays within this many screen pixels (at the drawing zoom) of the drawn path. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** A stroke being drawn is finished and continued as a new stroke at this many recorded points. */
export const STROKE_MAX_POINTS = 5000;
/** A click within this many screen pixels of a stroke's line (or half its thickness) selects it. */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest width/height a stroke can be resized to, in world units. */
export const STROKE_MIN_SIZE_WORLD = 4;
