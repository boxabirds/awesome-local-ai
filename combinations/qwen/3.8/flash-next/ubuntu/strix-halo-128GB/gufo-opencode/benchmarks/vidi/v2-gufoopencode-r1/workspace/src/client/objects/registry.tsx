import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { rectContains, type Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

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
}

// What a type may declare — and nothing else (stories 9–12 add registry
// entries but must not add their own selection or transform code).
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
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
