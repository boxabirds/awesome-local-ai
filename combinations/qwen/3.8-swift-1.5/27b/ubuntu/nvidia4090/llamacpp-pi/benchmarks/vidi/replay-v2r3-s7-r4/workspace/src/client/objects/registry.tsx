/**
 * Story 7: object type registry.
 *
 * A board object type declares only what is type-specific: its component,
 * whether it can be resized, whether it keeps its proportions, its minimum
 * size, whether it has editable text, and how to hit-test it. Selection,
 * moving, resizing and deleting stay generic (sel.all_types) — the later
 * object types (stories 9–12) call `registerObjectType` and must not add
 * their own selection or transform code.
 */
import type * as Y from 'yjs';
import { objectBounds, markTypeKnown, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';
import type { Point } from '../../shared/geometry';

/** Props every registered object component receives. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Delegates to the generic transform gesture (select / move). */
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error, caught by tests). Also marks the type as known to the shared model
 * so snapshots and select-all include it.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`vidi6: object type '${type}' is already registered`);
  }
  registry.set(type, spec);
  markTypeKnown(type);
}

/** Look up a registered type; `undefined` for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) => {
    const b = objectBounds(obj);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  },
});
