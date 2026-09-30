// Object type registry (sel.registry). Selection, move, resize and delete are
// generic; a type only declares whether it resizes, keeps its proportions and
// its minimum size. Stories 9–12 register their types here.
import type { ComponentType } from 'react';
import { type ObjectSnapshot, markObjectTypeKnown, objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { type Point, rectContains } from '../../shared/geometry';
import { StickyNote } from './StickyNote';
import type { ObjectProps } from './types';

export type { ObjectProps } from './types';

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers an object type. Throws when the type is already registered (programming error). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  markObjectTypeKnown(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Point-in-bounds hit test shared by rectangular types. */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  return rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});
