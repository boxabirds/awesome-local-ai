import type * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  objectBounds,
  registerKnownObjectType,
} from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { PenThickness } from '../../shared/objects/stroke';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { UndoController } from '../board/undo';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';

/**
 * Story 7 (sel.registry): the object type registry.
 *
 * A type declares only its rendering component and a few generic knobs
 * (resizable, aspect lock, minimum size, editable text, hit test). Selection,
 * move, resize and delete stay generic — a new type never adds its own
 * interaction code (sel.all_types).
 *
 * Registration also tells the shared board-model the type is known, so
 * `allObjectIds` / `objectsInRect` / `snapshot` include it.
 *
 * Story 10: hitTest also receives the camera zoom and the current
 * object-bounds map (`rects`), so a type can hit-test against screen
 * tolerances (the connector's 6-px line) or other objects' live bounds.
 */
export interface ObjectProps {
  /** The generic object snapshot (type-specific fields may be read via a cast). */
  readonly obj: ObjectSnapshot;
  /** The board document, for direct writes. */
  readonly doc: import('yjs').Doc;
  /** Current camera zoom (screen px per world unit). */
  readonly zoom: number;
  /**
   * Story 10: current world Rect of every board object, by id (id → bounds).
   * Used to resolve connector endpoints and for hit tests.
   */
  readonly rects: ReadonlyMap<string, Rect>;
  /** Whether this object is in the current selection. */
  readonly selected: boolean;
  /** Whether this object is being edited (text). */
  readonly editing: boolean;
  /** Whether the current user may edit (story 5). */
  readonly editable: boolean;
  /** The caller's undo controller (story 8), for step boundaries and shortcuts. */
  readonly undo: UndoController;
  /** The generic transform-gesture pointer-down handler. */
  onObjectPointerDown(e: React.PointerEvent, id: string): void;
  /** Enter text editing for the object. */
  onStartEdit(id: string): void;
  /** Leave text editing (selection is kept). */
  onEndEdit(): void;
}

export interface ObjectTypeSpec {
  /** The React component that renders one instance of this type. */
  readonly Component: React.ComponentType<ObjectProps>;
  /** Whether the type can be resized via the bounding-box handles. */
  readonly resizable: boolean;
  /** Whether resizing keeps the width:height ratio. */
  readonly aspectLocked: boolean;
  /** Minimum size in world units (fed to clampScale). */
  readonly minSize: number;
  /** Whether the type has an editable text field. */
  readonly editableText: boolean;
  /**
   * Handles shown for a single selection of this type: 'all' (the default,
   * eight handles), 'horizontal' (only e/w — text objects resize by width,
   * their height always follows the content) or 'none' (story 10: connectors
   * show their own endpoint handles instead).
   */
  readonly handles?: 'all' | 'horizontal' | 'none';
  /**
   * Whether a world point hits this object. Story 10: the zoom (screen px
   * per world unit) and the current bounds map are also available.
   * Default: within its bounds.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number, rects: ReadonlyMap<string, Rect>): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error, caught by the registry unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** Look up a type's spec; undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The current id → world Rect map of a snapshot (connector resolution). */
export function buildRects(snapshot: readonly ObjectSnapshot[]): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const o of snapshot) rects.set(o.id, objectBounds(o));
  return rects;
}

/**
 * The topmost (z) registered-type object hit by `worldPoint`, or null.
 * Unknown types and the types in `skipTypes` (tools pass 'connector' so an
 * arrow is never an attach target) are ignored.
 */
export function findObjectAt(
  snapshot: readonly ObjectSnapshot[],
  worldPoint: Point,
  zoom: number,
  rects: ReadonlyMap<string, Rect>,
  skipTypes?: readonly string[],
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const o = snapshot[i];
    if (skipTypes?.includes(o.type)) continue;
    const spec = registry.get(o.type);
    if (!spec) continue; // unknown type
    if (spec.hitTest(o, worldPoint, zoom, rects)) return o;
  }
  return null;
}

const boundsHitTest = (obj: ObjectSnapshot, p: Point): boolean => {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
};

/**
 * Register the story 1 sticky note type: resizable, aspect-locked (always
 * square), minimum STICKY_MIN_SIZE_WORLD, editable text, bounds hit test.
 */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => boundsHitTest(obj, p),
});

/**
 * Register the story 9 text type: resizable by width only (horizontal
 * handles), no aspect lock, editable text, bounds hit test.
 */
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) => boundsHitTest(obj, p),
});

/**
 * Register the story 10 shape type: resizable (both axes), no aspect lock
 * (Shift-square happens at creation), editable text (the label), bounds hit
 * test.
 */
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => boundsHitTest(obj, p),
});

/**
 * Register the story 11 stroke type: resizable with a locked aspect ratio
 * (a resize scales the drawn points with the box via scaledPoints — the
 * thickness stays in world units), minimum STROKE_MIN_SIZE_WORLD, no
 * editable text. Hit test: within max(half thickness,
 * STROKE_HIT_TOLERANCE_PX / zoom) world units of the drawn line — a click
 * far from the line but inside the bbox misses (and selects what is below).
 */
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p, zoom) => {
    const s = obj as StrokeSnap;
    const t = PEN_THICKNESS_WORLD[s.thickness as PenThickness] ?? PEN_THICKNESS_WORLD.medium;
    return (
      distanceToPolyline(scaledPoints(s), p) <=
      Math.max(t / 2, STROKE_HIT_TOLERANCE_PX / zoom)
    );
  },
});

/**
 * Register the story 10 connector type: no bounding-box resize (it has its
 * own endpoint handles), no aspect lock, no editable text. Hit test: within
 * CONNECTOR_HIT_TOLERANCE_PX screen pixels of the resolved line (a 6-px
 * target at any zoom).
 */
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  handles: 'none',
  hitTest: (obj, p, zoom, rects) => {
    const from = obj.from;
    const to = obj.to;
    if (!from || !to) return false;
    const ends = resolveEndpoints({ from, to }, rects);
    return distanceToPolyline([ends.from, ends.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
  },
});
