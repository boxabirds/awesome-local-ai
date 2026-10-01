import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerKnownObjectType, type ObjectSnapshot } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX, IMAGE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { StrokeObject } from './StrokeObject';
import type { Point, Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { resolveEndpoints, type ConnectorSnap } from '../../shared/geometry/connector-geometry';
import type { UndoController } from '../board/undo';
import { ConnectorObject } from './ConnectorObject';
import { BoardImage } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** Everything a board object component receives; selection, move, resize and delete stay generic (sel.all_types). */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  /** Board is not editable (load_failed). */
  readOnly: boolean;
  /** Objects delegate their pointerdown here so every type shares one gesture. */
  onPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** This tab's undo history; editors use it for step boundaries and Ctrl/Cmd+Z. */
  undo?: UndoController;
  /** Rectangles of every attachable object in stacking order; arrows resolve their ends from these. */
  rects?: ReadonlyMap<string, Rect>;
}

export interface HitContext { zoom?: number; rects?: ReadonlyMap<string, Rect> }

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Which resize handles the selection overlay offers; height-derived types use 'horizontal'. Default 'all'. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, ctx?: HitContext): boolean;
}

const types = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) throw new Error(`object type already registered: ${type}`);
  types.set(type, spec);
  registerKnownObjectType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
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

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj, p, ctx) {
    const s = obj as StrokeSnap;
    const local = { x: p.x - s.x, y: p.y - s.y };
    return distanceToPolyline(scaledPoints(s), local)
      <= Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / (ctx?.zoom ?? 1));
  },
});

registerObjectType('image', {
  Component: BoardImage,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: boundsHitTest,
});

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, p, ctx) {
    const ends = resolveEndpoints(obj as ConnectorSnap, ctx?.rects ?? new Map());
    return distanceToPolyline([ends.from, ends.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / (ctx?.zoom ?? 1);
  },
});
