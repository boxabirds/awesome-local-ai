import type { Camera } from './camera';
import type { ConnectionState } from '../sync/connectBoard';
import type * as Y from 'yjs';
import type { StickyColor } from '../../shared/config';
import type {
  ObjectSnapshot,
  StickySnapshot,
} from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import type { ShapeKind, ShapeSnap } from '../../shared/objects/shape';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { PenColor, PenThickness } from '../../shared/config';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS } from '../../shared/config';
import { applyTextDiff } from '../objects/StickyText';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../shared/board-model';
import { objectBounds, objectSnapshots } from '../../shared/board-model';
import { nearestSide, sideAnchor } from '../../shared/geometry';
import { createShape, getShapeLabel } from '../../shared/objects/shape';
import { createConnector } from '../../shared/objects/connector';
import { createStroke } from '../../shared/objects/stroke';

/** Test-only handle on the live camera, installed when MODE === 'test'. */
export interface Vidi6TestHooks {
  setCamera(cam: Camera): void;
  getCamera(): Camera;
  /**
   * Connection state exactly as the badge renders it, so an e2e test can assert
   * it never leaves `connected` while idle (null before the first update), and can
   * tell whether this client has synced with the room yet.
   */
  connectionState: ConnectionState | null;
}

/** What a test can do to the live board using the very functions the UI uses. */
export interface Vidi6BoardHandle {
  /** The live shared document. */
  readonly doc: Y.Doc;
  /** The board exactly as this client's model sees it. */
  notes(): readonly StickySnapshot[];
  /** Create a note centred on a world point; returns its id. */
  create(at?: { x: number; y: number }): string;
  /** Put a note at world (x, y). */
  moveTo(id: string, x: number, y: number): boolean;
  color(id: string, color: StickyColor): boolean;
  /** Replace a note's text, as the editor does (minimal diff, merge-safe). */
  write(id: string, text: string): void;
  remove(id: string): boolean;
  /** The shapes on the board, as this client's model sees them. */
  shapes(): readonly ShapeSnap[];
  /** The arrows on the board, with their ends resolved to where they draw. */
  connectors(): readonly ConnectorSnap[];
  /**
   * Draw a shape centred on a world point (or of an exact box), in the shape kind asked
   * for. Null when the model refused it, which is what it does with a box that is neither
   * a real drag nor a click.
   */
  createShape(at: Point, kind?: ShapeKind, rect?: Rect): string | null;
  /**
   * Join two objects with an arrow, both ends attached to the object it names, which is the
   * way the tool joins them. Null when the model refused: one object at both ends, or an
   * arrow too short to be a thing a person meant to draw.
   */
  connect(fromId: string, toId: string): string | null;
  /**
   * Join one end of an arrow to an object and leave the other end a point on the board at `at`,
   * which is what an arrow whose object went away is left as. Null when the model refused it,
   * as it does with an arrow too short to have been meant.
   */
  connectToPoint(fromId: string, at: Point): string | null;
  /** Replace a shape's label, as the editor does (minimal diff, merge-safe). */
  writeShape(id: string, text: string): void;
  /**
   * The drawings on the board, as this client's model sees them — seeded or drawn, local or
   * synced, because the model does not distinguish and neither can a test that wants the truth.
   */
  strokes(): readonly StrokeSnap[];
  /**
   * Draw a stroke through world points, in the ink and nib asked for: the same `createStroke`
   * the Pen tool calls, so a seeded stroke is indistinguishable from a drawn one. Null when the
   * model refused the path, which is what it does with a path that has no points in it.
   */
  createStroke(
    points: readonly Point[],
    color?: PenColor,
    thickness?: PenThickness,
  ): string | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
    __vidi6TestBoard?: Vidi6BoardHandle;
  }
}

export const IS_TEST_MODE = import.meta.env.MODE === 'test';

/**
 * Last published connection state. Kept at module level because the effect that
 * publishes it and the effect that installs the camera handle are separate, and
 * the handle is re-created whenever the camera's deps are.
 */
let lastConnectionState: ConnectionState | null = null;

/**
 * Install `window.__vidi6` so Playwright e2e tests can jump the camera far away
 * (dragging a million pixels is impractical). In production builds
 * `import.meta.env.MODE` is `"production"`, so this is a no-op and the branch is
 * tree-shaken out of the bundle.
 */
export function installTestHooks(
  get: () => Camera,
  set: (cam: Camera) => void,
): () => void {
  if (!IS_TEST_MODE) return () => {};
  window.__vidi6 = {
    setCamera: (cam) => set({ x: cam.x, y: cam.y, zoom: cam.zoom }),
    getCamera: get,
    connectionState: lastConnectionState,
  };
  return () => {
    delete window.__vidi6;
  };
}

/**
 * Install `window.__vidi6TestBoard` for e2e tests that need seed data or volume
 * (hundreds of operations would take minutes through the mouse). The operations
 * are the same ones the UI calls, so a scripted change propagates and renders
 * exactly like a person's. `window.__vidi6Board` is the bare document, kept for
 * the component tests. Test builds only.
 */
export function installBoardHandle(doc: Y.Doc): () => void {
  if (!IS_TEST_MODE) return () => {};
  const handle: Vidi6BoardHandle = {
    doc,
    notes: () => snapshot(doc),
    create: (at) => createSticky(doc, at ?? { x: 0, y: 0 }),
    moveTo: (id, x, y) => moveObject(doc, id, x, y),
    color: (id, color) => setStickyColor(doc, id, color),
    write: (id, text) => {
      const ytext = getStickyText(doc, id);
      if (ytext) applyTextDiff(ytext, text, undefined);
    },
    remove: (id) => deleteObject(doc, id),
      writeShape: (id, text) => {
      const label = getShapeLabel(doc, id);
      if (label) applyTextDiff(label, text, undefined);
    },
    connectToPoint: (fromId, at) => {
      const from = objectsOf(doc).find((o) => o.id === fromId && o.type !== 'connector');
      if (!from) return null;
      const box = objectBounds(from);
      return createConnector(
        doc,
        {
          kind: 'attached',
          objectId: from.id,
          // The end is stored with the place it draws, so that is the place it is left with if
          // the object goes away (connector.detaches).
          fallback: sideAnchor(box, nearestSide(box, at)),
        },
        { kind: 'free', x: at.x, y: at.y },
        'e2e',
      );
    },
    shapes: () => objectsOf(doc, 'shape') as ShapeSnap[],
    strokes: () => objectsOf(doc, 'stroke') as StrokeSnap[],
    createStroke: (points, color = DEFAULT_PEN_COLOR, thickness = DEFAULT_PEN_THICKNESS) =>
      createStroke(doc, { points, color, thickness }, 'e2e'),
    connectors: () => objectsOf(doc, 'connector') as ConnectorSnap[],
    createShape: (at, kind, rect) => createShape(doc, { at, kind, rect }, 'e2e'),
    connect: (fromId, toId) => {
      const things = objectsOf(doc).filter((o) => o.type !== 'connector');
      const a = things.find((o) => o.id === fromId);
      const b = things.find((o) => o.id === toId);
      // The centre is only a starting point: the model stores each end's fallback as the
      // place that end actually draws, which is what an arrow is left with when the object
      // it was joined to goes away (connector.detaches).
      if (!a || !b) return null;
      return createConnector(
        doc,
        {
          kind: 'attached',
          objectId: a.id,
          fallback: { x: a.x, y: a.y },
        },
        {
          kind: 'attached',
          objectId: b.id,
          fallback: { x: b.x, y: b.y },
        },
        'e2e',
      );
    },
  };
  window.__vidi6TestBoard = handle;
  return () => {
    if (window.__vidi6TestBoard === handle) delete window.__vidi6TestBoard;
  };
}

/**
 * Every object of one type, as the render model sees it. The type is a plain string on a
 * generic snapshot, so the filter is the check and the caller's annotation is a promise the
 * filter keeps.
 */
function objectsOf(doc: Y.Doc, type?: string): ObjectSnapshot[] {
  const all: ObjectSnapshot[] = [...objectSnapshots(doc)];
  return type === undefined ? all : all.filter((o) => o.type === type);
}

/**
 * Publish the badge's connection state for e2e assertions. No-op in production
 * builds, like the rest of this module.
 */
export function publishConnectionState(state: ConnectionState): void {
  if (!IS_TEST_MODE) return;
  lastConnectionState = state;
  if (window.__vidi6) window.__vidi6.connectionState = state;
}
