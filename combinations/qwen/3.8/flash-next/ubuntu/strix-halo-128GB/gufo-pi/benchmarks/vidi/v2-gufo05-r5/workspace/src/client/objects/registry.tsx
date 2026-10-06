/**
 * Object type registry (story 7).
 *
 * Each board object type declares its component, whether it can be resized, whether it
 * keeps its proportions, its minimum size, whether it has editable text, and a hit-test.
 * Selection, move, resize, nudge and delete are generic (sel.all_types): a new type only
 * calls `registerObjectType` with its spec.
 */
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { hitConnector } from '../../shared/geometry/connector-geometry';
import type { ComponentType } from 'react';
import type { Point } from '../../shared/geometry';
import {
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { ObjectProps } from './ObjectProps';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';

export interface ObjectTypeSpec {
  /** React component that renders this object type (set during app initialization). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: any;
  /** Whether the object can be resized via handles. */
  resizable: boolean;
  /** Whether width-to-height ratio is locked during resize. */
  aspectLocked: boolean;
  /** Minimum width/height in world units. */
  minSize: number;
  /** Whether the object has inline text editing. */
  editableText: boolean;
  /** Hit-test: is `worldPoint` inside this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /**
   * Which resize handles this type offers (story 9). `'all'` (the default) is the 8 handles round
   * the box; `'horizontal'` is the two sides only, for an object whose height belongs to its
   * content and must not be dragged. A selection of several types shows the union: what every
   * object in it can do. `'none'` (story 10) is for an object with no box of its own to resize -
   * an arrow, whose shape belongs to the two objects it joins.
   */
  handles?: 'all' | 'horizontal' | 'none';
}

/**
 * The component contract every object type meets. The spec field is loose so a type can declare
 * the snapshot it really draws (a note, a text); this is the same contract written out for the
 * place that renders an object without knowing which type it got.
 */
export type BoardObjectComponent = ComponentType<ObjectProps & { note: ObjectSnapshot }>;

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a new object type. Throws if the type string is already registered.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Returns the spec for the given type, or undefined if not registered.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---- Hit-test helpers ----

/** Hit test for any rectangular object: point within objectBounds. */
export function rectHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// ---- Register built-in types ----

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

// Story 9: a new type without touching selection, move, marquee, delete or undo - the registry is
// the only place that knows text exists. Its height is derived from its content, so it offers the
// two side handles only.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  hitTest: rectHitTest,
  handles: 'horizontal',
});

// Story 10: a shape is a box like any other - moved, resized, marquee-selected and deleted by the
// generic code - and brings its own hit test only in that it is the box. Its label is edited the
// same way a note's text is, through the registry's `editableText`.
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: rectHitTest,
});

// Story 10: an arrow is the one object that is not a box. Its box is derived from its ends, so
// there is nothing to resize; what a click has to be measured against is the line, within
// CONNECTOR_HIT_TOLERANCE_PX (see ConnectorObject, which does the same thing in screen pixels).
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, worldPoint) {
    if (obj.type !== 'connector') return false;
    // The registry's hit test has no zoom to work with, so it answers for the board at 1:1. The
    // component does the same measurement with the live zoom, which is the one a click is made at.
    return hitConnector(obj.ends, worldPoint, 1);
  },
  handles: 'none',
});
