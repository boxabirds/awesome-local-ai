// Product / navigation settings. Stories 2-5 add to this file.
// Changing these must not require a redesign elsewhere.

// Zoom limits (screen pixels per world unit).
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

// One zoom step multiplies/divides the zoom by this factor (buttons + Ctrl/Cmd +/-).
export const ZOOM_STEP_FACTOR = 1.25;

// Wheel/pinch zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Dot grid spacing in world units (screen spacing = GRID_SPACING_WORLD * zoom).
export const GRID_SPACING_WORLD = 24;

// How far a test pans from the start to prove the board is effectively unbounded.
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// zoomPercent = Math.round(zoom * ZOOM_PERCENT_SCALE).
export const ZOOM_PERCENT_SCALE = 100;

// A zoom value this close to ZOOM_STEP_FACTOR^n snaps exactly to that power,
// so a step in then out returns to exactly 1.0 (avoids float drift).
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Wheel deltaMode unit conversions to CSS pixels (named to avoid magic numbers).
export const WHEEL_DELTA_LINE_PX = 16; // one "line" unit in pixels
export const WHEEL_DELTA_PAGE_PX = 800; // one "page" unit in pixels

// --- Sticky notes (story 2) -------------------------------------------------

// Sticky note size in world units (a square note).
export const STICKY_SIZE_WORLD = 200;

// Hard limit on the number of characters kept in a note's text.
export const STICKY_TEXT_MAX_CHARS = 1000;

// The character counter shows only when the remaining characters are <= this.
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

// Text auto-fit range in CSS pixels (at 100% zoom, screen px == world units).
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;

// A pointer must move more than this many screen pixels to start a drag
// (a shorter press is a select, not a drag).
export const DRAG_THRESHOLD_PX = 3;

// The six selectable note colours. Names are stable product settings; the hex
// values may change without touching components.
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

// --- Live collaboration (story 3) ------------------------------------------

// Soft simultaneous-editor capacity: the design + test target the board is
// built and verified for. It is NEVER enforced — a 6th person joins normally.
export const MAX_CONCURRENT_EDITORS = 5;

// PRD live.propagate: change must reach every other screen within this budget
// (ms), measured on the sender's DOM update to the receiver's DOM update.
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

// Passed to WebsocketProvider as maxBackoffTime: the exponential reconnect
// backoff is capped at this many milliseconds.
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

// How long the green "Connected" confirmation badge is shown after a
// reconnection before it hides.
export const CONNECTED_CONFIRMATION_MS = 2000;

// The outage length used by the live.catch_up verification (PRD): disconnect
// one participant for this long while their page stays open.
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Persistence (story 4) --------------------------------------------------

// Compaction trigger: this many update rows that are not yet folded into a
// snapshot. Cross it and the room rewrites the snapshot in one transaction.
export const COMPACTION_UPDATE_COUNT = 500;

// Compaction trigger: this many bytes of un-compacted update log.
export const COMPACTION_BYTES = 2 * 1024 * 1024;

// The snapshot payload is stored as BLOB rows of at most this many bytes, so no
// single row holds a whole large board (TC-08 asserts more than one row for a
// board over this size).
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

// A room that failed to load its board answers new connections with close code
// 4500 until this long has passed since the failed read, so a client that
// reconnects quickly cannot hammer the failing storage read.
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

// The load-duration assertion used by the tests (TC-21): a board seeded with
// PERSIST_TESTED_NOTES notes must be fully rendered within this budget.
export const BOARD_LOAD_BUDGET_MS = 3_000;

// Number of notes the tested large board is seeded with.
export const PERSIST_TESTED_NOTES = 2_000;

// The storage layout version written by BoardStore.migrate(). Not the board's
// data version (board-model's schemaVersion lives in the Y.Doc) and not the app
// version.
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing by link (story 5) ----------------------------------------------

// How many boards ONE visitor may create per BOARD_CREATE_PERIOD_SECONDS.
// These two values are the product rule; `wrangler.jsonc`'s `ratelimits`
// binding must mirror them (TC-03 asserts the equality, because a drift would
// silently change the product rule while every test still passed).
export const BOARD_CREATE_LIMIT = 10;
export const BOARD_CREATE_PERIOD_SECONDS = 60;

// How many candidate ids one board creation may try before giving up. A try is
// only made against a code that is already taken (`share.unique`), so three is
// ample for 128-bit codes and bounds the work a single request can do.
export const CREATE_ID_MAX_ATTEMPTS = 3;

// PRD share.create: a new board must be open within this many ms.
export const CREATE_BUDGET_MS = 2000;

// How long the Share panel's button reads "Link copied".
export const LINK_COPIED_MS = 2000;

// First retry interval for the board page's existence check. Each retry
// doubles it, capped at RECONNECT_MAX_BACKOFF_MS (story 3), so a service that
// comes back is picked up without the person reloading.
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Multi-select, move, resize (story 7) -----------------------------------

// Resize handles on the selection's bounding box are this many SCREEN pixels,
// at any zoom (the overlay inverts the zoom so they stay this size).
export const HANDLE_SIZE_PX = 8;

// A sticky note may never be resized smaller than this many board (world)
// units on a side.
export const STICKY_MIN_SIZE_WORLD = 50;

// No board object may be resized larger than this many world units on a side.
export const MAX_OBJECT_SIZE_WORLD = 20_000;

// An arrow key nudges the selection this many world units.
export const NUDGE_STEP_WORLD = 1;

// Shift+arrow nudges this many world units.
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Free text (story 9) -----------------------------------------------------

// The width a free text box grows to on its own; a longer line wraps at it
// (world units).
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

// No text box may be narrower than this many world units; it is also the
// minimum a side-handle drag leaves behind.
export const TEXT_MIN_WIDTH_WORLD = 40;

// Hard limit on the number of characters kept in a text object's text.
export const TEXT_MAX_CHARS = 5000;

// The four font sizes of a text object, in CSS pixels (at 100% zoom, screen
// px == world units).
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;

// The size a new text object starts with.
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

// Line height of a text object, as a multiple of its font size.
export const TEXT_LINE_HEIGHT = 1.3;

// The font of a text object; measuring and rendering must agree on it.
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// Slack added to the longest measured line so the glyphs of a line never
// touch the box edge (world units).
export const TEXT_LAYOUT_PADDING_WORLD = 8;

// Average glyph width (× font size) estimated when no canvas text measuring
// exists (the createCanvasMeasurer fallback).
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

// --- Undo and redo (story 8) ------------------------------------------------

// A typing pause of THIS many milliseconds ends a typing burst: the next
// keystroke opens a new undo step. Shorter pauses merge into the current step,
// so "one meaningful action" is one step and a burst of typing is one too.
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

// How many undo steps one person's history keeps. The oldest step is discarded
// when a new one arrives while the history is full.
export const UNDO_MAX_STEPS = 200;

// --- Shapes and connectors (story 10) ---------------------------------------

// The three shape kinds, in the order the Shape menu lists them.
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

// A click, or a drag smaller than the minimum, lands a shape this wide and
// this tall (world units).
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

// A dragged area under this in either dimension counts as a click, and is also
// the smallest a shape may be resized to (world units).
export const SHAPE_MIN_SIZE_WORLD = 20;

// Hard limit on the number of characters kept in a shape's label.
export const SHAPE_LABEL_MAX_CHARS = 500;

// A shape's outline, in world units, so it scales with zoom like everything else.
export const SHAPE_STROKE_WIDTH_WORLD = 2;

// The label's box inside a shape: this much world space is left on every side,
// so words never run over the outline. Its line height is the text object's.
export const SHAPE_LABEL_INSET_WORLD = 12;
export const SHAPE_LINE_HEIGHT = 1.25;

// The seven fill choices - six colours and 'no fill' - and the six outlines.
// The names are the product settings; the hex values may change freely.
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

// A connector whose resolved length is under this many world units is never
// created (a connector drag of a few pixels is a mistake, not an arrow).
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

// Half the width of the invisible band a click can hit an arrow on, in SCREEN
// pixels: the registry hit test divides it by the zoom, so it is 6 px at every
// zoom level.
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

// The arrow's line, and the length of its arrowhead, in world units.
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

// A connection dot's radius, in SCREEN pixels (the tool draws them in screen
// space so they never shrink). 
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Freehand pen (story 11) -------------------------------------------------

// The six pen colours. The names are the product settings (they are what a
// stroke stores and what the pen toolbar offers); the hex values may change
// without touching anything else.
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;

// The three pen thicknesses, in WORLD units, so a stroke's line scales with the
// board like every other object does.
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

// What a fresh page draws with (pen.options: remembered until the page reloads,
// which is why they live in tool state and never in the doc).
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

// How far the finished stroke may lie from the path that was drawn, in SCREEN
// pixels: the Pen tool divides it by the zoom it drew at, so smoothing is as
// faithful at 400% as at 100% (pen.smooth).
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

// One stroke never keeps more than this many recorded points; a drag that goes
// past it finishes the stroke and continues with a new one that starts on the
// same point (pen.long_stroke).
export const STROKE_MAX_POINTS = 5000;

// Half the width of the band a click can hit a stroke on, in SCREEN pixels, and
// the smallest a stroke may be resized to (world units).
export const STROKE_HIT_TOLERANCE_PX = 6;
export const STROKE_MIN_SIZE_WORLD = 4;

// --- Images (story 12) -------------------------------------------------------

// The image formats the board accepts. The names are what a picker offers and
// what the server accepts; the sniffing that decides a file's real type lives in
// image-validation.ts and does not trust these strings when they come from a
// client.
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

// Largest image file the board accepts (10 MB). Both the client check that keeps
// a big file off the wire and the server check that is the actual boundary.
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// How many images one drop / paste / pick may add; anything past this is skipped
// with a message naming the number.
export const IMAGE_MAX_FILES_PER_ADD = 20;

// The long side of the box a large image is fitted into when it lands; an image
// already smaller than this is placed at its pixel size (images.footprint).
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

// The smallest side an image may be resized to (world units). Its own minimum,
// deliberately looser than a sticky's, because a picture is legible small.
export const IMAGE_MIN_SIZE_WORLD = 16;

// Gap between images landing from one multi-file add (world units): they step
// down-right by the placed size plus this, so a pile is fanned not stacked.
export const IMAGE_LAYOUT_GAP_WORLD = 24;

// How long an image may sit in `uploading` before it is treated as never having
// finished - the `unfinished` state, which offers a Remove (images.unfinished).
// It is derived at render from `uploadStartedAt`, not a timer that fires a write.
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

// How often an uploading image re-renders so its progress % moves and the
// `unfinished` boundary is crossed within a reasonable time (a clock tick, not a
// write - nothing is stored on a tick).
export const IMAGE_UPLOAD_TICK_MS = 30 * 1000;

// Image uploads per board per window. These two values are the product rule;
// `wrangler.jsonc`'s `ratelimits` binding must mirror them (an integration test
// asserts the equality, the way story 5's board-create limiter does).
export const IMAGE_UPLOAD_LIMIT = 60;
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;

// Browser cache lifetime for a served asset (world). Content is immutable at its
// key, so a year - the number is what the cache header carries and a test reads.
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

// How many leading bytes the format sniffer looks at. The widest magic-number
// signature it matches (RIFF....WEBP) is twelve bytes; twelve is exactly enough.
export const IMAGE_SNIFF_BYTES = 12;
