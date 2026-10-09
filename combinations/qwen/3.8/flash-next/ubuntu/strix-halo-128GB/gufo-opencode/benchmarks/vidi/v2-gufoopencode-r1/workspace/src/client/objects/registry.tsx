import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { rectContains, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, CONNECTOR_HIT_TOLERANCE_PX, SHAPE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObject } from './ImageObject';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { isStrokeObject } from '../../shared/board-model';
import { scaledPoints } from '../../shared/objects/stroke';

// Props every object-type renderer receives from the board viewport. The
// viewport owns selection and the transform gesture; components only declare
// how they look and delegate pointer-down (design sel.all_types).
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  dragging: boolean;
  editing: boolean;
  editable: boolean;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  // Story 10 (optional): a click that only selects (never starts a move), and
  // the viewport's client↔world conversions plus a hit-test that returns the
  // topmost attachable object at a world point (or null). ConnectorObject uses
  // these for its endpoint re-attach handles.
  onSelect?(id: string): void;
  screenToWorld?(clientX: number, clientY: number): Point;
  worldToScreen?(world: Point): Point;
  hitTestAtWorld?(world: Point, excludeId?: string): string | null;
}

// What a type may declare — and nothing else (stories 9–12 add registry
// entries but must not add their own selection or transform code).
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  // 'horizontal' restricts resize handles to e/w (story 9: text height is
  // derived from content and must not be dragged). Default: all eight.
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Object types an arrow endpoint may attach to (connectors attach to neither).
export const ATTACHABLE_TYPES: ReadonlySet<string> = new Set(['sticky', 'text', 'shape']);

const stickyHitTest = (obj: ObjectSnapshot, worldPoint: Point): boolean =>
  rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest
});

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest
});

const connectorHitTest = (obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean => {
  const ends = (obj as { resolved?: { from: Point; to: Point } }).resolved;
  if (ends === undefined) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom === undefined || zoom <= 0 ? 1 : zoom);
  return distanceToPolyline([ends.from, ends.to], worldPoint) <= tolerance;
};

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: connectorHitTest
});

// Story 11: strokes hit against the recorded line (never the empty bbox),
// resize aspect-locked so the drawing is never distorted, and their thickness
// is a style key unaffected by the bbox scale.
const strokeHitTest = (obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean => {
  if (!isStrokeObject(obj)) return false;
  const tolerance = Math.max(
    PEN_THICKNESS_WORLD[obj.thickness] / 2,
    STROKE_HIT_TOLERANCE_PX / (zoom === undefined || zoom <= 0 ? 1 : zoom)
  );
  return distanceToPolyline(scaledPoints(obj), worldPoint) <= tolerance;
};

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest
});

// Story 12: images resize aspect-locked (never distorted) with the
// IMAGE_MIN_SIZE_WORLD floor on the longest side.
registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: stickyHitTest
});
