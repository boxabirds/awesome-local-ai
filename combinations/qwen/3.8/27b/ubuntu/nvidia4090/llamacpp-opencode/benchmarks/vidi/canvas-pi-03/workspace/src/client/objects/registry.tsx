import type { ComponentType, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { ObjectSnapshot } from '@/shared/board-model';
import { objectBounds } from '@/shared/board-model';
import type { Point } from '@/shared/geometry';
import { STICKY_MIN_SIZE_WORLD } from '@/shared/config';
import { StickyNote, type StickyNoteProps } from './StickyNote';

/**
 * Object-type registry (story 7, sel.registry).
 *
 * The board renderer maps every snapshot object through `getObjectType` and
 * skips unknown types (forward compatibility: a doc persisted by a newer
 * build can carry types this build does not know). Select, move, resize and
 * delete all key off the spec, so stories 9-12 plug in a new object type by
 * registering one spec — they must not add their own selection or transform
 * code (sel.all_types).
 *
 * The module-level map is populated at import (sticky below); a duplicate
 * registration is a programming error and throws at module load.
 */

/**
 * Props the board renderer passes to every registry component. The base
 * fields are the object's own snapshot data plus the shared interaction
 * props; each component type may additionally receive type-specific props
 * (the renderer passes a superset; the index signature keeps this open).
 */
export type ObjectProps = Record<string, unknown> & {
  id: string;
  x: number;
  y: number;
  /** True when this object is in the local selection (drives the outline). */
  selected?: boolean;
  /**
   * Pointerdown delegation: the board's transform gesture selects the object
   * (or the set, when shift-held) and drives move/resize from here.
   */
  onObjectPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
};

export interface ObjectTypeSpec {
  /** The component the renderer uses for objects of this type. */
  Component: ComponentType<ObjectProps>;
  /** Group resize (bounding-box handles) applies to this type. */
  resizable: boolean;
  /** Individual objects of this type keep their w:h ratio when resized. */
  aspectLocked: boolean;
  /** Smallest size (world units) one object of this type may be resized to. */
  minSize: number;
  /** Double-click / Enter enters in-place text editing for this type. */
  editableText: boolean;
  /** True when the world point is inside the object (hit testing). */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/** Registers a type spec. Throws when the type is already registered. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined when this build does not know it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Test-only: forget a registration (module state is per test process). */
export function resetObjectTypeRegistry(): void {
  registry.clear();
  // Re-register the built-in sticky (module load already did this once).
  registerStickyType();
}

function pointInBounds(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
}

/**
 * Thin adapter so the spec's `Component` (typed as `ComponentType<ObjectProps>`)
 * can be the concrete StickyNote without widening StickyNote's own props.
 */
function StickyRegistryComponent(props: ObjectProps): ReactElement {
  return <StickyNote {...(props as unknown as StickyNoteProps)} />;
}

export function registerStickyType(): void {
  if (registry.has('sticky')) return; // idempotent (resetObjectTypeRegistry)
  registry.set('sticky', {
    Component: StickyRegistryComponent,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest: pointInBounds,
  });
}

// Story 2's type is known from the start: register at module load.
registerStickyType();
