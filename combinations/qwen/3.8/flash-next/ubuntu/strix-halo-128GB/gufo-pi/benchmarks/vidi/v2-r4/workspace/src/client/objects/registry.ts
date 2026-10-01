/**
 * Object type registry: each board object type declares its component,
 * whether it is resizable, whether it keeps its proportions, its minimum size,
 * whether it has editable text, and a hit-test function.
 *
 * Stories 9–12 add new types by calling `registerObjectType`; they must not
 * add their own selection, move, resize, or delete code (sel.all_types).
 */
import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
}

export interface ObjectTypeSpec {
  Component: ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register a new object type. Throws on duplicate registration (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up an object type spec. Returns undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}
