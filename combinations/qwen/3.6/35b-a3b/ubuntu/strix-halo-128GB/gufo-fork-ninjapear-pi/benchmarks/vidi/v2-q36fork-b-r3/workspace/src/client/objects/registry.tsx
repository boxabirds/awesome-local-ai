import type { ComponentType } from 'react';
import type { ObjectSnap } from '@shared/board-model';

/** Specification for an object type on the board. */
export type HandleMode = 'all' | 'horizontal';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ObjectTypeSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Which resize handles to show: 'all' (default 8) or 'horizontal' (left/right only). */
  handles?: HandleMode;
  /** Hit test: returns true if world point p is within the object's interactive region. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hitTest(obj: ObjectSnap, worldPoint: { readonly x: number; readonly y: number }, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register an object type. Throws if already registered. */
export function registerObjectType(
  type: string,
  spec: ObjectTypeSpec,
): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up a registered object type, or undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Check all specs are resizable / know their sizes. Useful for runtime validation. */
export function getAllTypes(): ReadonlyMap<string, ObjectTypeSpec> {
  return registry;
}
