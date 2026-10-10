import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerSelectableType, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  IMAGE_MIN_SIZE_WORLD,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD
} from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { collectConnectorViews } from '../../shared/objects/connector';
import { getStrokeSnap, scaledPoints } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';
import type { EndEditNext } from '../board/useSelection';
import { ConnectorObject } from './ConnectorObject';
import { ImageObjectView } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';

// The props every object component receives. Position, size and selection
// behaviour are generic; per-type specifics live in the document and in the
// spec below.
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  // False while the board cannot be mutated (load_failed): no gestures (TC-23).
  editable: boolean;
  // Press on the object body: selection + group move gesture, owned by the
  // board (the component must stopPropagation so the viewport does not pan).
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  // This tab's undo history, for components that own keyboard input while
  // editing (the sticky text editor routes Ctrl/Cmd+Z to it).
  undo?: UndoController;
}

// The only per-type knobs. Selection, move, resize, delete, keyboard and the
// marquee are all generic over registered types (sel.all_types).
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  // 'horizontal' = only e/w handles (height is derived, story 9 text).
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, point: Point, ctx?: { doc?: Y.Doc; zoom?: number }): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    // Programming error: two modules claiming one type name.
    throw new Error(`registerObjectType: type "${type}" is already registered`);
  }
  registry.set(type, spec);
  registerSelectableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});

// Shapes take generic bbox hit-testing (the SVG fills the box for rect;
// ellipse/diamond corners are forgiving, matching sticky/text behaviour).
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});

// An arrow is hit by proximity to its line (6 screen px), never by its
// bounding box; not resizable (end handles are the connector's own).
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, point, ctx) => {
    if (ctx?.doc === undefined) return false;
    const view = collectConnectorViews(ctx.doc).find((v) => v.id === obj.id);
    if (view === undefined) return false;
    const zoom = ctx.zoom ?? 1;
    return (
      distanceToPolyline([view.resolved.from, view.resolved.to], point) <=
      CONNECTOR_HIT_TOLERANCE_PX / zoom
    );
  }
});

// A stroke is hit by proximity to its drawn line (6 screen px or half its
// thickness, whichever is larger), never by its bounding box; resizes keep
// the drawn line proportional with the thickness unchanged.
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, point, ctx) => {
    if (ctx?.doc === undefined) return false;
    const snap = getStrokeSnap(ctx.doc, obj.id);
    if (snap === undefined) return false;
    const zoom = ctx.zoom ?? 1;
    return (
      distanceToPolyline(scaledPoints(snap), point) <=
      Math.max(PEN_THICKNESS_WORLD[snap.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom)
    );
  }
});

// An image is selected, moved and resized like a sticky, but the resize is
// always proportional (aspectLocked) and stops at IMAGE_MIN_SIZE_WORLD
// (image.aspect_resize). It has no editable text.
registerObjectType('image', {
  Component: ImageObjectView,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, point) =>
    rectContains(objectBounds(obj), { x: point.x, y: point.y, width: 0, height: 0 })
});
