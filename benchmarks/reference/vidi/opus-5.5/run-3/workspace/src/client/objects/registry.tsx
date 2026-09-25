// Object type registry (sel.all_types). Selection, moving, resizing, nudging and deleting are generic; a type
// only declares whether it can be resized, whether it keeps its proportions, its minimum size, which handles it
// offers and (optionally) how a resize is written.
// Stories 9-12 add their types with `registerObjectType` and must not add their own selection or transform code.
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerModelObjectType, type ObjectSnapshot } from '../../shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD, STICKY_MIN_SIZE_WORLD, STROKE_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { resizeText, TextObject } from './TextObject';
import { ShapeObjectView } from './ShapeObject';
import { connectorHitTest, ConnectorObjectView } from './ConnectorObject';
import { strokeHitTest, StrokeObjectView } from './StrokeObject';
import { ImageObjectView } from './ImageObject';

/** How the transform gesture currently affects an object. */
export type ObjectGesturePhase = 'idle' | 'pressed' | 'dragging';

/** Props every object component receives. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board cannot be edited (load failed). */
  editable: boolean;
  /** CSS stacking position (1 = bottom). Omitted: DOM order decides. */
  stackIndex?: number;
  gesture: ObjectGesturePhase;
  /** Every object hands its primary pointerdown to the generic transform gesture. */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  /** Keyboard focus selects the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest side, in world units. */
  minSize: number;
  editableText: boolean;
  /**
   * 'horizontal': only the left and right handles are offered when every selected object is of such a type, and
   * the height is not the type's to set (story 9 text: height follows content). Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Writes a resize of this object to `to` (its proportional place in the resized group) instead of the generic
   * position and size write. `horizontalOnly`: the gesture is a left/right handle drag on a selection whose
   * types are all horizontal. Called inside the gesture's transaction.
   */
  resize?(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, ctx: { horizontalOnly: boolean }): void;
  /**
   * Whether a world point is on the object. `zoom` (screen px per world unit, default 1) lets a type use a
   * screen-space tolerance (story 10 arrows).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /**
   * The type draws its own selection UI (story 10 arrows: end handles), so no selection box is drawn when only
   * objects of such types are selected.
   */
  ownSelectionUi?: boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers an object type. Registering the same type twice is a programming error and throws. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  registerModelObjectType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Whether a world point lies inside an object's rectangle (edges included). */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  const r = objectBounds(obj);
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
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
  resize: resizeText,
  hitTest: boundsHitTest,
});

registerObjectType('shape', {
  Component: ShapeObjectView,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

registerObjectType('connector', {
  Component: ConnectorObjectView,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  ownSelectionUi: true,
  hitTest: connectorHitTest,
});

registerObjectType('stroke', {
  Component: StrokeObjectView,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});

// Images keep their proportions when resized, down to IMAGE_MIN_SIZE_WORLD (image.aspect_resize).
registerObjectType('image', {
  Component: ImageObjectView,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: boundsHitTest,
});

/** Whether every one of these objects offers only horizontal handles (and there is at least one). */
export function onlyHorizontalHandles(objects: readonly ObjectSnapshot[]): boolean {
  return objects.length > 0 && objects.every((o) => getObjectType(o.type)?.handles === 'horizontal');
}
