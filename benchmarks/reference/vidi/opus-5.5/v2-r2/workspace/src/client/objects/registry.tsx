// Object type registry (sel.registry). Selection, move, resize and delete are
// generic; a type only declares whether it resizes, keeps its proportions and
// its minimum size. Stories 9–12 register their types here.
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import { type ObjectSnapshot, markObjectTypeKnown, objectBounds } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { type Point, type Rect, rectContains } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaleConnector } from '../../shared/objects/connector';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { strokeHitTest } from './strokeHitTest';
import { TextObject } from './TextObject';
import { applyTextResize } from './useTextBoxSync';
import type { ObjectProps } from './types';

export type { ObjectProps } from './types';
export { strokeHitTest } from './strokeHitTest';

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Resize handles offered when only this type is selected (default 'all'); 'horizontal' = left and right only. */
  handles?: 'all' | 'horizontal';
  /**
   * Custom write for a group resize (default: the scaled rect via `resizeObjects`).
   * `horizontalOnly` is true when every selected type has horizontal handles.
   */
  applyResize?(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, opts: { horizontalOnly: boolean }): void;
  /** Whether `worldPoint` is on the object; `zoom` (default 1) turns screen tolerances into world units. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers an object type. Throws when the type is already registered (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  markObjectTypeKnown(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Point-in-bounds hit test shared by rectangular types. */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  return rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  applyResize: (doc, obj, to, opts) => applyTextResize(doc, obj, to, opts),
  hitTest: boundsHitTest,
});

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/** Within CONNECTOR_HIT_TOLERANCE_PX screen pixels of the arrow's line. */
export function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  if (!obj.ends) return false;
  return distanceToPolyline([obj.ends.from, obj.ends.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  // In a group resize the free ends scale with the group; attached ends follow their objects.
  applyResize: (doc, obj, to) => {
    scaleConnector(doc, obj, to);
  },
  hitTest: connectorHitTest,
});

// Pen strokes (story 11): selected by their line only; resizing keeps their proportions.
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});
