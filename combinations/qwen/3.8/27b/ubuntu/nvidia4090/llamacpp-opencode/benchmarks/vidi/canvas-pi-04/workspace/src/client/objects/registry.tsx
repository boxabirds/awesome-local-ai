// Story 7: the object type registry (anchor: sel.registry).
//
// One registry so that selection, transforming and rendering behave the same
// for every object type. Stories 9-12 call `registerObjectType` and must not
// add their own selection or transform code (sel.all_types). The registry is
// the single place that decides whether a type is resizable, aspect-locked,
// its minimum size and whether it has editable text.
//
// The component (a React type) lives here, in the client; the per-type
// geometry knobs that board-model needs are intentionally NOT imported back
// into the shared layer (no client -> shared React coupling).

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Point } from '../../shared/geometry';
import { CONNECTOR_HIT_TOLERANCE_PX, SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { ShapeSnap } from '../../shared/objects/shape';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * The props every registered object component receives. The component renders
 * its object from `obj`, mirrors its selection/editing state, and delegates
 * pointer-down to the transform gesture.
 */
export interface ObjectProps {
  /** The immutable snapshot of this one object (type already known). */
  obj: ObjectSnapshot;
  /** The shared board document (for type-specific reads/writes, e.g. text). */
  doc: Y.Doc;
  /** True when this object is in the current selection. */
  selected: boolean;
  /** True while this object's text is being edited. */
  editing: boolean;
  /** False when the board could not be loaded: mutations are no-ops. */
  canEdit: boolean;
  /** Pointer down on the object body: hand to the transform gesture. */
  onPointerDown: (e: ReactPointerEvent) => void;
  /** Request to start editing this object's text. */
  onStartEdit: (id: string) => void;
  /** Commit or cancel editing (the hook keeps the selection). */
  onEndEdit: (id: string) => void;
  /**
   * Story 10: the full board snapshot. Connector components need it for
   * endpoint hit-testing and the arrow re-attach drag.
   */
  snapshot?: readonly ObjectSnapshot[];
  /** Story 10: the current camera zoom (screen px per world unit). */
  zoom?: number;
  /** Story 10: the full camera (connector handle drags convert client px). */
  camera?: import('../canvas/camera').Camera;
}

/** Everything the board needs to know to select/transform one object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Whether the type can be resized by the selection handles. */
  resizable: boolean;
  /** Whether a selection of (or including) this type keeps its proportions. */
  aspectLocked: boolean;
  /** Minimum side/size in world units (clamped by `clampScale`). */
  minSize: number;
  /** Whether the type has editable text. */
  editableText: boolean;
  /**
   * Which resize handles the type shows when it is the only kind selected:
   * 'all' (default, story 7) or 'horizontal' (e/w only; height is derived,
   * e.g. text — story 9, text.height).
   */
  handles?: 'all' | 'horizontal';
  /** Whether a world point hits the object (for future hit regions). */
  hitTest: (obj: ObjectSnapshot, worldPoint: Point) => boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on a duplicate type (a programming error
 * caught by the unit tests). Populated at module load for the built-in types.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for a type, or undefined when the type is unknown/unregistered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Register the one real object type this story ships: the sticky note. It is
 * resizable, always square (aspect locked), has a minimum side and editable
 * text.
 */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) => {
    const b = objectBounds(obj);
    return (
      point.x >= b.x &&
      point.x < b.x + b.width &&
      point.y >= b.y &&
      point.y < b.y + b.height
    );
  },
});

// Story 10: shapes (anchor: shapes.object). Rectangles, ellipses and
// diamonds; freely resizable, minimum side SHAPE_MIN_SIZE_WORLD, editable
// label text.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) => {
    const b = objectBounds(obj as ShapeSnap);
    return (
      point.x >= b.x &&
      point.x < b.x + b.width &&
      point.y >= b.y &&
      point.y < b.y + b.height
    );
  },
});

// Story 10: connectors (anchor: connector.select). Never resizable or
// aspect-locked (the geometry is derived from its endpoints); selection is
// by the hit band around the centre line, ±CONNECTOR_HIT_TOLERANCE_PX screen
// px at the current zoom.
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  // Coarse world-unit approximation (the registry API has no zoom); the
  // precise ±CONNECTOR_HIT_TOLERANCE_PX screen-px band is the DOM hit line in
  // ConnectorObject.
  hitTest: (obj, point) => {
    const snap = obj as ConnectorSnap;
    return (
      distanceToPolyline([snap.fromPoint, snap.toPoint], point) <=
      CONNECTOR_HIT_TOLERANCE_PX
    );
  },
});

// Story 9: free text (anchor: text.object). Resizable by width only (e/w
// handles), never aspect-locked, minimum side TEXT_MIN_WIDTH_WORLD.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, point) => {
    const b = objectBounds(obj);
    return (
      point.x >= b.x &&
      point.x < b.x + b.width &&
      point.y >= b.y &&
      point.y < b.y + b.height
    );
  },
});
