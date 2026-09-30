// Object type registry (story 7). Selection, moving, resizing and deleting are generic; a type
// declares only its component, whether it can be resized, whether it keeps its proportions, its
// minimum size, whether it holds editable text, and how to hit-test it. Stories 9–12 register
// their types here and add no selection or transform code of their own.
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN, type ObjectSnapshot, moveObjects, objectBounds } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { type ConnectorSnap, translateConnector } from '../../shared/objects/connector';
import { type TextSnapshot, setTextWidthFixed } from '../../shared/objects/text';
import { ConnectorEntry } from './ConnectorObject';
import { ShapeEntry } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { textMeasurer } from './textLayout';
import { syncTextBox } from './useTextBoxSync';

/** Props the board passes to every object component. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board is locked (story 4): no move, resize, edit or delete. */
  editable: boolean;
  /** True while a move or resize gesture of the selection is in progress. */
  transforming: boolean;
  /** CSS stacking layer: the object's rank in (z, id) order. */
  layer?: number;
  /** Rects of every object an arrow can attach to, topmost last (story 10 arrows). */
  rects?: ReadonlyMap<string, Rect>;
  /** Starts the generic select / move gesture (useTransformGesture). */
  onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus selected the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest width and height, world units. */
  minSize: number;
  editableText: boolean;
  /**
   * Handles shown when every selected object is of such a type: all eight (default), or only
   * the left and right side handles (story 9: text height follows its content).
   */
  handles?: 'all' | 'horizontal';
  /**
   * The smallest width/height this object allows in a resize, or null when it does not limit
   * the resize (its size is not changed). Default: `minSize` on both axes. `widthOnly` is true
   * when only side handles are shown.
   */
  resizeLimits?(obj: ObjectSnapshot, widthOnly: boolean): { width: number | null; height: number | null } | null;
  /**
   * Writes a resize for a type whose size partly follows its content, instead of the generic
   * rect write. `to` is the rect the generic resize computed for the object.
   */
  applyResize?(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, widthOnly: boolean): void;
  /**
   * Writes a move for a type whose box is derived (story 10 arrows), instead of setting x/y:
   * `start` is the object when the gesture started, (dx, dy) the offset in world units.
   */
  applyMove?(doc: Y.Doc, start: ObjectSnapshot, dx: number, dy: number): void;
  /**
   * True when presses are matched by `hitTest` instead of the object's DOM box (story 10:
   * an arrow is only hit near its line, not anywhere in its bounding box).
   */
  pickByHitTest?: boolean;
  /** The object draws its own selection (arrow end handles): no selection box when alone. */
  ownSelection?: boolean;
  /** `zoom` (screen px per world unit) lets a type use a tolerance in screen pixels. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers a type; registering the same type twice is a programming error and throws. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

export function isRegisteredType(type: string): boolean {
  return registry.has(type);
}

/** Point-in-bounds hit test (edges included). */
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
  // Only a width that is being set (side handles) or already fixed limits a resize; an automatic
  // width and the height follow the text.
  resizeLimits: (obj, widthOnly) =>
    widthOnly || (obj as TextSnapshot).widthMode === 'fixed'
      ? { width: TEXT_MIN_WIDTH_WORLD, height: null }
      : null,
  // Side handles set a fixed width; in a mixed selection the text moves with the group and only
  // a fixed width scales. The font size never changes; the height is re-measured.
  applyResize(doc, obj, to, widthOnly) {
    doc.transact(() => {
      moveObjects(doc, new Map([[obj.id, { x: to.x, y: to.y }]]));
      if (widthOnly || (obj as TextSnapshot).widthMode === 'fixed') {
        setTextWidthFixed(doc, obj.id, to.width);
      }
      syncTextBox(doc, obj.id, textMeasurer());
    }, LOCAL_ORIGIN);
  },
  hitTest: boundsHitTest,
});

registerObjectType('shape', {
  Component: ShapeEntry,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

/** Within CONNECTOR_HIT_TOLERANCE_PX screen pixels of the arrow's line. */
export function connectorHitTest(obj: ObjectSnapshot, p: Point, zoom = 1): boolean {
  const { ends } = obj as ConnectorSnap;
  return distanceToPolyline([ends.from, ends.to], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
}

registerObjectType('connector', {
  Component: ConnectorEntry,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  pickByHitTest: true,
  ownSelection: true,
  applyMove: (doc, start, dx, dy) => {
    translateConnector(doc, start as ConnectorSnap, dx, dy);
  },
  hitTest: connectorHitTest,
});
