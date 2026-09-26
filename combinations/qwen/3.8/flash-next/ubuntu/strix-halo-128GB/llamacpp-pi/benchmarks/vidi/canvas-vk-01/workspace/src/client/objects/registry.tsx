import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { rectContains, type Point } from '../../shared/geometry';

/**
 * The props every renderable board object receives. Selection, move, resize
 * and delete are generic — a new object type only declares its own component
 * and a handful of behavioural knobs in {@link ObjectTypeSpec}, it never adds
 * its own selection or transform code (`sel.all_types`).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board is locked (persist.load_failure). */
  editable: boolean;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Begin a press that may become a group move; wired to useTransformGesture. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
}

/** A single object type's behaviour declaration. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Registers `sticky` and (in later stories) every new
 * object type. Throws on duplicate registration — that is a programming error
 * caught at module load.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // Keep the framework-free model's known-type set in sync so `snapshot` and
  // `allObjectIds` include this type.
  registerModelType(type);
}

/** The spec for a type, or `undefined` when the type is not registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- sticky notes (story 2, generalised in story 7) -----------------------
import { registerBoardObjectType as registerModelType } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});
