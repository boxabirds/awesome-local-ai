import type { ComponentType } from 'react';
import { STICKY_SIZE_WORLD, STICKY_MIN_SIZE_WORLD } from '@/shared/config';

/** Generic object snapshot — any registered type's shape. */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
  [key: string]: unknown;
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface Point {
  x: number;
  y: number;
}

/** Specification for a board object type in the registry. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: PointerEvent, id: string): void;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws if already registered (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): string {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
  return type;
}

/**
 * Get the spec for a registered type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Reset the registry to initial state. Used only in tests.
 */
export function resetRegistry(): void {
  registry.clear();
}

/**
 * Returns true if at least one selected type is resizable.
 */
export function selectionIsResizable(
  _snapshot: readonly ObjectSnapshot[],
  ids: ReadonlySet<string>,
): boolean {
  // Stubbed — actual check requires access to each object's rect + spec
  // The caller should pass this information directly
  return false;
}

/**
 * Returns true if any selected type locks aspect ratio.
 */
export function selectionHasAspectLock(
  _snapshot: readonly ObjectSnapshot[],
  _ids: ReadonlySet<string>,
): boolean {
  // Stubbed — actual check requires access to each object's rect + spec
  return false;
}

/**
 * Get min sizes for each selected object.
 */
export function selectedMinSizes(
  _snapshot: readonly ObjectSnapshot[],
  _ids: ReadonlySet<string>,
): number[] {
  // Stubbed — actual implementation passes through spec data
  return [];
}

/**
 * Hit-test a point against a sticky note using simple bounds.
 */
export function stickyHitTest(obj: ObjectSnapshot, wp: Point): boolean {
  const w = (obj.width as number) ?? STICKY_SIZE_WORLD;
  const h = (obj.height as number) ?? STICKY_SIZE_WORLD;
  return (
    wp.x >= obj.x &&
    wp.y >= obj.y &&
    wp.x <= obj.x + w &&
    wp.y <= obj.y + h
  );
}
