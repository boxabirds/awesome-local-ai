// Object type registry (sel.all_types). Selection, moving, resizing, nudging and deleting are generic; a type
// only declares whether it can be resized, whether it keeps its proportions, and its minimum size.
// Stories 9-12 add their types with `registerObjectType` and must not add their own selection or transform code.
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, registerModelObjectType, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { StickyNote } from './StickyNote';

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
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
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
