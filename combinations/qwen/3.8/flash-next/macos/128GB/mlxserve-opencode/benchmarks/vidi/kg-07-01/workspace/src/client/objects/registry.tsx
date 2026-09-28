import type * as React from 'react';
import type { Point } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';

/** Props every object component receives from the board. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
  stackIndex?: number;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Declares per-type behaviour for selection, resize, and hit-testing. */
export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers a type. Throws on duplicate registration. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Returns the spec for a type, or undefined if not registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Resets the registry (test-only). */
export function _resetRegistryForTests(): void {
  registry.clear();
}

/** Default hitTest: point is inside objectBounds. */
function defaultHitTest(obj: ObjectSnapshot, pt: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    pt.x >= bounds.x &&
    pt.y >= bounds.y &&
    pt.x < bounds.x + bounds.width &&
    pt.y < bounds.y + bounds.height
  );
}

/**
 * Registers the sticky note type. Called at module load.
 * The Component is a placeholder here; the real StickyNote is passed in via App wiring.
 */
export function registerSticky(Component: React.ComponentType<ObjectProps>): void {
  registerObjectType('sticky', {
    Component,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: defaultHitTest,
  });
}
