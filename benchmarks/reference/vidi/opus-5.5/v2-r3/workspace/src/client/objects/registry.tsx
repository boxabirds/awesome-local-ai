// Object type registry (story 7, sel.registry). Each board object type declares
// only how it renders and whether/how it can be resized; selection, move,
// resize, nudge and delete stay generic (sel.all_types).
import type { ComponentType, PointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerModelType, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  IMAGE_MIN_SIZE_WORLD,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import {
  CONNECTOR_TYPE,
  getConnectorEnds,
  transformConnector,
  type ConnectorSnap,
} from '../../shared/objects/connector';
import { IMAGE_TYPE } from '../../shared/objects/image';
import { SHAPE_TYPE } from '../../shared/objects/shape';
import { scaledPoints, STROKE_TYPE, type StrokeSnap } from '../../shared/objects/stroke';
import { TEXT_TYPE } from '../../shared/objects/text';
import { ConnectorObject } from './ConnectorObject';
import { RegisteredImageObject } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { resizeText, TextObject } from './TextObject';

/** This object's part in the local transform gesture. */
export type ObjectGesturePhase = 'idle' | 'pressed' | 'dragging';

/** Props every registered object component receives from the board. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Stacking position among rendered objects (render order stays stable during drags). */
  zIndex: number;
  selected: boolean;
  editing: boolean;
  /** No moving, resizing or editing (the board could not be loaded, story 4). */
  readOnly: boolean;
  gesture: ObjectGesturePhase;
  /** Every object delegates its pointerdown here (useTransformGesture). */
  onPointerDown(e: PointerEvent<Element>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Current zoom (story 10: arrow hit tolerance and handles are in screen pixels). */
  zoom?: number;
  /** Rects of every attachable object in (z, id) order (story 10 arrows resolve their ends from them). */
  rects?: ReadonlyMap<string, Rect>;
}

/**
 * For types whose geometry is derived rather than stored (story 10 arrows):
 * a move, resize or nudge captures the object's state when it starts and then
 * writes its points mapped through the selection's transform, instead of x/y.
 */
export interface ObjectTransformHook {
  capture(doc: Y.Doc, id: string): unknown;
  /** Called inside the frame's transaction; `start` is what `capture` returned. */
  apply(doc: Y.Doc, id: string, start: unknown, map: (p: Point) => Point): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height in world units. */
  minSize: number;
  editableText: boolean;
  /** Which resize handles a selection of only this type shows (default 'all'; story 9). */
  handles?: 'all' | 'horizontal';
  /**
   * Writes a resize frame for this type instead of the generic width/height
   * write: `next` is the object's rect in the transformed selection, `start`
   * its rect when the gesture began; `horizontalOnly` when every selected
   * object has horizontal handles. Called inside the frame's transaction.
   */
  resize?(doc: Y.Doc, id: string, next: Rect, start: Rect, horizontalOnly: boolean): void;
  /** Derived-geometry types move through this hook (story 10). */
  transform?: ObjectTransformHook;
  /** Whether a press at `worldPoint` hits the object; `zoom` for tolerances given in screen pixels. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /** Arrows can attach to this type (default true; false for arrows themselves). */
  attachable?: boolean;
}

const types = new Map<string, ObjectTypeSpec>();

/** Registers a type at module load. Registering the same type twice is a programming error. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`Object type "${type}" is already registered`);
  types.set(type, spec);
  registerModelType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** True when the point lies within the object's rect (edges included). */
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

registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resize: resizeText,
  hitTest: boundsHitTest,
});

registerObjectType(SHAPE_TYPE, {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/** Within CONNECTOR_HIT_TOLERANCE_PX screen pixels of the drawn line (connector.select). */
export function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  const c = obj as ConnectorSnap;
  if (!c.ends) return false;
  return distanceToPolyline([c.ends.from, c.ends.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  attachable: false,
  transform: {
    capture: (doc, id) => getConnectorEnds(doc, id),
    apply: (doc, id, start, map) => {
      if (start) transformConnector(doc, id, start as NonNullable<ReturnType<typeof getConnectorEnds>>, map);
    },
  },
  hitTest: connectorHitTest,
});

/**
 * Within STROKE_HIT_TOLERANCE_PX screen pixels of the drawn line, or half its
 * thickness when that is larger (pen.select). Empty space inside the box misses.
 */
export function strokeHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  const s = obj as StrokeSnap;
  if (!s.points || !(s.thickness in PEN_THICKNESS_WORLD)) return false;
  const tol = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  return distanceToPolyline(scaledPoints(s), p) <= tol;
}

registerObjectType(STROKE_TYPE, {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});

// Story 12: images always keep their proportions and never get smaller than 16 units.
registerObjectType(IMAGE_TYPE, {
  Component: RegisteredImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: boundsHitTest,
});

/**
 * The topmost attachable object whose hit test contains `p` (story 10 connector
 * targets). `list` is in (z, id) order; `exclude` is skipped.
 */
export function attachableAt(list: readonly ObjectSnapshot[], p: Point, zoom: number, exclude?: string): ObjectSnapshot | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    const spec = getObjectType(o.type);
    if (!spec || spec.attachable === false || o.id === exclude) continue;
    if (spec.hitTest(o, p, zoom)) return o;
  }
  return null;
}
