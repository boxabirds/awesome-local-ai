import type * as Y from 'yjs';
import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';
import type { StickyColor } from '../../shared/config';
import type { StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { ShapeSnap } from '../../shared/objects/shape';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { ShapeKind, TextSize, FillColor, StrokeColor } from '../../shared/config';

/** A note a browser-test fixture asks for (world position, colour, text, size). */
export interface SeedNote {
  x: number;
  y: number;
  color?: StickyColor;
  text?: string;
  width?: number;
  height?: number;
}

/**
 * A text a browser-test fixture asks for: top-left position (PRD text.create),
 * content, size and an optional fixed width (as if a side handle had been dragged).
 * The box is measured from the content, exactly as it would be if the text had been
 * typed, so its numbers are the ones the layout produces.
 */
export interface SeedText {
  x: number;
  y: number;
  text?: string;
  size?: TextSize;
  /** Below TEXT_MIN_WIDTH_WORLD the width is raised to the minimum, as in the app. */
  width?: number;
  createdBy?: string;
}

/**
 * A shape a browser-test fixture asks for: its box (top-left, like SeedText), kind,
 * colours and label (story 10).
 */
export interface SeedShape {
  x: number;
  y: number;
  width?: number;
  height?: number;
  kind?: ShapeKind;
  fill?: FillColor;
  stroke?: StrokeColor;
  label?: string;
  createdBy?: string;
}

/** One end of a seeded connector: an object id created earlier in the same fixture, or a point. */
export interface SeedEndpoint {
  /** Attach to an object that is already on the board. */
  objectId?: string;
  /** Or to the shape from an earlier `seedShapes` call, in order. */
  shapeIndex?: number;
  /** Or fix to an explicit world point. */
  x?: number;
  y?: number;
}

/** A connector between two of the fixture's shapes, or two points (story 10). */
export interface SeedConnector {
  from: SeedEndpoint;
  to: SeedEndpoint;
  createdBy?: string;
}

export interface BoardSelectionState {
  selectedId: string | null;
  editingId: string | null;
  /** All selected ids (story 7 multi-select). */
  selectedIds?: string[];
}

/**
 * Test-only API installed in `import.meta.env.MODE === 'test'` builds only.
 * Installed in pieces (camera by useCamera, board by App) and merged, so each
 * owner can register what it owns.
 */
export interface BoardTestApi {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /** Live sticky note snapshot in paint order (story 2). */
  getSnapshot(): readonly StickySnapshot[];
  /** Live free text snapshot in paint order (story 9), for e2e assertions. */
  getTexts(): readonly TextSnapshot[];
  /** Live shape snapshot in paint order (story 10). */
  getShapes(): readonly ShapeSnap[];
  /** Live connector snapshot in paint order (story 10), ends resolved as drawn. */
  getConnectors(): readonly ConnectorSnap[];
  /** The in-memory document, so tests can drive the model directly. */
  getDoc(): Y.Doc;
  /** Local selection / editing ids (story 2). */
  getSelection(): BoardSelectionState;
  /** Connection state behind the badge (story 3, nightly TC-29). */
  getConnectionState(): ConnectionState;
  /** Close the board's socket without leaving the board (browser tests). */
  dropConnection(): void;
  /** Reconnect after `dropConnection()`. */
  resumeConnection(): void;
  /**
   * Fill the board with `count` distinct, text-bearing notes in one document
   * transaction (browser tests only): a fast way to reach a realistic 25-note or
   * large board that then syncs to the room and is stored like any real edit.
   */
  seedBoard(count: number): void;
  /**
   * Write the given notes as one transaction that is *not* this tab's own work — the
   * way a board that was already saved arrives — and return their ids in the order
   * they were given (browser tests). Story 8 needs fixtures that are not undoable by
   * whoever happens to create them.
   */
  seedNotes(specs: readonly SeedNote[]): string[];
  /**
   * The same fixture for free text (story 9): created as if the board had been saved
   * with it on it, each box measured from its content, ids returned in order.
   */
  seedTexts(specs: readonly SeedText[]): string[];
  /**
   * The same fixture for shapes (story 10): created as if the board had been saved
   * with them on it, ids returned in the order they were given.
   */
  seedShapes(specs: readonly SeedShape[]): string[];
  /**
   * And for connectors (story 10): each end names the index of a shape from the same
   * call, or a world point, so a fixture can describe a whole flow in one go.
   */
  seedConnectors(specs: readonly SeedConnector[]): string[];
  /**
   * This tab's own undo history (story 8): step once back or once forward and report
   * whether either is available. The same history the buttons and shortcuts drive, so
   * a browser test can ask what the user could have undone.
   */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
}

declare global {
  interface Window {
    __vidi6?: BoardTestApi;
  }
}

export function installTestHook(api: BoardTestApi): void {
  if (typeof window !== 'undefined') window.__vidi6 = api;
}

/** Add/replace part of the test API without clobbering the rest of it. */
export function patchTestHook(patch: Partial<BoardTestApi>): void {
  if (typeof window === 'undefined') return;
  window.__vidi6 = { ...(window.__vidi6 ?? {}), ...patch } as BoardTestApi;
}

export function uninstallTestHook(): void {
  if (typeof window !== 'undefined') delete window.__vidi6;
}

/** Drop only the given keys, leaving other owners' registrations in place. */
export function unpatchTestHook(keys: (keyof BoardTestApi)[]): void {
  if (typeof window === 'undefined') return;
  const api = window.__vidi6;
  if (!api) return;
  const mutable = api as Partial<BoardTestApi>;
  for (const key of keys) delete mutable[key];
  if (Object.keys(api).length === 0) delete window.__vidi6;
}
