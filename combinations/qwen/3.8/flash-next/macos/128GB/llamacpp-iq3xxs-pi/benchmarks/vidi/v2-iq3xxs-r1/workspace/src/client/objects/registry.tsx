import type { ComponentType } from 'react';
import type { ObjectSnapshot, WorldPoint } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * Per-type knobs the generic selection/move/resize/delete machinery needs.
 * Stories 9–12 add types by calling `registerObjectType`; they must not add
 * their own selection or transform code.
 */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles this type offers (story 9). `'all'` is the 8-way box
   * stories 2–7 know; `'horizontal'` is for objects whose height always follows
   * their content — text rewraps, it does not stretch. SelectionOverlay reads this
   * instead of testing a type name, so adding a type stays a registration.
   */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean;
}

/** Props every registered object component receives (sel.all_types). */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Register sticky notes inline to avoid circular imports
function registerSticky() {
  if (registry.has('sticky')) return; // already registered (hot reload guard)
  registry.set('sticky', {
    Component: StickyNote as unknown as ComponentType<ObjectProps>,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      const bounds = objectBounds(obj);
      return rectContains(bounds, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

// Register free text inline for the same reason, and because the selection machinery
// asks for its spec the same way it asks for a note's.
function registerText() {
  if (registry.has('text')) return;
  registry.set('text', {
    Component: TextObject as unknown as ComponentType<ObjectProps>,
    resizable: true,
    // A text object's height comes from its content, and its width does not follow
    // its top-left being dragged: nothing here keeps a ratio (PRD text.fixed_width).
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      const bounds = objectBounds(obj);
      return rectContains(bounds, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

// Auto-register at module load
registerSticky();
registerText();
