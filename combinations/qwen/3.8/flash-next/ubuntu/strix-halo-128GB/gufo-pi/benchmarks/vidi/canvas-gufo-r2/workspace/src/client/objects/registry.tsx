/**
 * Board object-type registry (story 7).
 *
 * Every board object kind declares only the knobs the generic selection / move /
 * resize / delete machinery needs: whether it is resizable, whether it keeps its
 * proportions, its minimum size, whether it owns editable text, and how to hit-
 * test a world point. Selection, moving, resizing, nudging and deleting stay
 * generic — later object types (stories 9–12) add a registry entry and must not
 * re-implement any of that (PRD sel.all_types).
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import type { UndoController } from '../board/undo';

/** Props every board object component receives from the board renderer. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Board not editable (load failure): no dragging, no edit mode. */
  readOnly: boolean;
  /** Delegates press to the shared transform gesture (select + move / resize). */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Per-user undo controller (story 8). */
  undo?: UndoController;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a board object type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up a type; undefined for unknown types (which are never rendered or selected). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Import is deferred to avoid a cycle at module-evaluation time: the sticky
// component does not import the registry, so this import is one-directional.
import { StickyNote } from './StickyNote';

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj, worldPoint) {
    return rectContains(objectBounds(obj), {
      x: worldPoint.x,
      y: worldPoint.y,
      width: 0,
      height: 0,
    });
  },
});
