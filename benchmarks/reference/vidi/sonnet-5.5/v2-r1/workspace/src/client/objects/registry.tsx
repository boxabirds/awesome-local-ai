import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STROKE_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import type { ConnectorSnap } from '../../shared/objects/connector';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { ConnectorObject, hitsConnector } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject, hitsStroke } from './StrokeObject';
import { TextObject } from './TextObject';

/** What the board hands to every object type's component; selection and transforms stay generic. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while the board cannot be edited (load_failed). */
  readOnly?: boolean;
  /** Rects of every object arrows can attach to, in stacking order (arrows resolve their ends from these). */
  rects?: ReadonlyMap<string, Rect>;
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next?: 'selected' | 'unselected'): void;
}

/** The only per-type knobs: can it be resized, does it keep its proportions, how small can it get. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Which resize handles a selection of only this type shows; default 'all'. */
  handles?: 'all' | 'horizontal';
  /** `zoom` matters for objects with a screen-space click tolerance (arrows). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`object type already registered: ${type}`);
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
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

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => hitsConnector(obj as ConnectorSnap, p, zoom),
});

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => hitsStroke(obj as StrokeSnap, p, zoom),
});
