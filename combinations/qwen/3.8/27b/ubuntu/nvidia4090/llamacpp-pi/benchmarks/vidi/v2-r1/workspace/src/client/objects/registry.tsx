// Object type registry (story 7, sel.registry contract): every object type
// declares how it renders and how the generic selection and transform
// machinery may operate on it. Later object types (stories 9–12) register
// here and inherit selection, group move, resize and delete without adding
// their own interaction code (sel.all_types).

import type React from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { pointInRect, type Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import type { Camera } from '../canvas/camera';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import type { Rect } from '../../shared/geometry';

/**
 * The minimal pointer-event shape the object components and the transform
 * gesture exchange. Both a native `PointerEvent` and React's synthetic
 * `PointerEvent` satisfy it structurally.
 */
export interface ObjectPointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly shiftKey: boolean;
}

/**
 * Props every registered object component receives from the board. The
 * component renders its object in world coordinates and delegates pointer
 * input to the generic transform gesture via `onPointerDown`.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom (screen px per world unit). */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * Story 4 edit lock: while false the object can still be selected, but
   * move/resize and entering edit mode are no-ops.
   */
  canEdit: boolean;
  /** Delegate a pointerdown on this object to the transform gesture. */
  onPointerDown(e: ObjectPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /**
   * End editing. `'selected'` keeps the object selected (Escape);
   * `'unselected'` clears the selection (click outside).
   */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Story 8: the per-board undo controller. Optional so existing harnesses
   * (and future non-undo features) keep working; objects with editable text
   * use it for typing boundaries and in-editor undo/redo.
   */
  undo?: UndoController;
  // --- Story 10 additions (optional; only shape/connector use them) --------
  /** The camera (the connector's handle drags convert client → world). */
  camera?: Camera;
  /** World boxes of every object (the connector resolves its endpoints). */
  rects?: ReadonlyMap<string, Rect>;
  /** The full snapshot (the connector hit-tests drop targets). */
  snapshot?: readonly ObjectSnapshot[];
}

/**
 * What one object type declares about itself. A type may declare only
 * whether it can be resized, whether it keeps its proportions, its minimum
 * size and how it is hit-tested — nothing else (sel.all_types).
 */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Minimum side length in world units (the maximum is global). */
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles the selection box shows for objects of this type.
   * 'horizontal' (story 9 text): only the east/west handles, which set a
   * fixed width; never a height handle. Default 'all' (eight handles).
   */
  handles?: 'all' | 'horizontal';
  /**
   * Whether a world point hits this object. `zoom` lets a type use
   * screen-pixel tolerances (the connector's 6px line tolerance,
   * connector.select).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number): boolean;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error that must surface at module load, caught by the unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`Object type already registered: ${type}`);
  }
  specs.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for `type`, or undefined for types this build does not know. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/**
 * The topmost (highest z) object at world point `p`, hit-tested with the
 * type's own hitTest at the given zoom, or null. The snapshot must be
 * (z, id)-sorted ascending (objectsSnapshot's order).
 */
export function objectAtPoint(
  snapshot: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    const o = snapshot[i]!;
    const spec = specs.get(o.type);
    if (spec !== undefined && spec.hitTest(o, p, zoom)) return o;
  }
  return null;
}

// --- Sticky notes (story 2, moved onto the generic machinery) ---------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true, // sticky notes stay square
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: (obj, p) => pointInRect(objectBounds(obj), p),
});

// --- Free text (story 9, text.object) ---------------------------------------

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  // A side-handle drag shrinks a text box down to this (text.fixed_width).
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  // Only the east/west handles: they set a fixed width; a text object has no
  // handles that change its height (the height follows the wrapped text).
  handles: 'horizontal',
  hitTest: (obj, p) => pointInRect(objectBounds(obj), p),
});

// --- Shapes (story 10, shape.ui) --------------------------------------------

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: (obj, p) => pointInRect(objectBounds(obj), p),
});

// --- Connectors (story 10, connector.ui) -------------------------------------

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false, // arrows have no resize; their ends move via handles
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  // A click within CONNECTOR_HIT_TOLERANCE_PX of the line selects the arrow
  // (screen pixels, so the tolerance divides the zoom); anywhere else — even
  // inside the bounding box — misses (connector.select).
  hitTest: (obj, p, zoom) => {
    if (obj.fromPoint === undefined || obj.toPoint === undefined) return false;
    return (
      distanceToPolyline([obj.fromPoint, obj.toPoint], p) <=
      CONNECTOR_HIT_TOLERANCE_PX / zoom
    );
  },
});
