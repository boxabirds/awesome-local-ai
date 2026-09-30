import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import type { Point } from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '@shared/config';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  zoom: number;
  onPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType "${type}" is already registered`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register sticky note type ---

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// --- Register text type ---

function textHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// We do NOT register sticky here with the component to avoid circular deps in unit tests.
// The actual registration (with component) happens in a separate init module.

// For testability and to avoid circular imports in unit tests, we use a deferred pattern:
let stickyRegistered = false;
let textTypeRegistered = false;

export function registerStickyType(component: ObjectTypeSpec['Component']): void {
  if (stickyRegistered) return;
  stickyRegistered = true;
  registerObjectType('sticky', {
    Component: component,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    handles: 'all',
    hitTest: stickyHitTest,
  });
}

export function registerTextType(component: ObjectTypeSpec['Component']): void {
  if (textTypeRegistered) return;
  textTypeRegistered = true;
  registerObjectType('text', {
    Component: component,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest: textHitTest,
  });
}

// Allow tests to reset registry state
export function _resetRegistryForTesting(): void {
  registry.clear();
  stickyRegistered = false;
  textTypeRegistered = false;
}

/**
 * Returns true if all selected object specs have handles === 'horizontal'.
 */
export function allHandlesHorizontal(types: readonly string[]): boolean {
  if (types.length === 0) return false;
  return types.every((t) => {
    const spec = registry.get(t);
    return spec?.handles === 'horizontal';
  });
}
