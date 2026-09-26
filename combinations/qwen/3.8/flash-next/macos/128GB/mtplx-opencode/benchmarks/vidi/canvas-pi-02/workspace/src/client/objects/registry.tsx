/**
 * Object type registry (story 7).
 *
 * Every board object type declares its behaviour through this registry. The
 * selection, move, resize and delete machinery is generic: it reads the spec
 * to decide whether handles appear, whether aspect ratio is locked, and what
 * the minimum size is.
 *
 * Stories 9–12 will call `registerObjectType` to add text, shapes, drawings
 * and images.
 */
import type * as React from 'react';

// Forward-declare the minimal props type that object components need.
export interface ObjectProps {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ObjectTypeSpec {
  /**
   * React component that renders this type.
   *
   * NOT WIRED UP: nothing renders this field. `App.tsx` paints every snapshot
   * entry with a hardcoded `<StickyNote>`, and `snapshot()` only ever emits
   * `type: 'sticky'`, so today this is inert metadata. Wiring a second object
   * type requires three changes at once, and doing only some of them leaves
   * two live paths:
   *   1. `snapshot()` must stop filtering to stickies and carry the stored
   *      `type` (see `isSticky`) instead of hardcoding 'sticky';
   *   2. the renderer must dispatch on `getObjectType(type)` and skip types
   *      with no spec — today an unregistered type would paint as a note;
   *   3. `ObjectProps` below is not the shape `StickyNote` takes, so sticky
   *      rendering has to move behind a spec that matches it.
   */
  Component: React.ComponentType<ObjectProps>;
  /** Whether the object shows resize handles. */
  resizable: boolean;
  /** Whether resize preserves aspect ratio. */
  aspectLocked: boolean;
  /** Minimum size (world units) for any dimension. */
  minSize: number;
  /** Whether the object has editable inline text. */
  editableText: boolean;
  /** Hit test: is the world point inside this object's bounds? */
  hitTest(obj: { x: number; y: number; width?: number; height?: number }, worldPoint: { x: number; y: number }, zoom?: number): boolean;
  /** Which handles to show: 'all' for 8, 'horizontal' for e/w only. */
  handles?: 'all' | 'horizontal';
}

const registry = new Map<string, ObjectTypeSpec>();

/** Register an object type. Throws on duplicate registration. */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** Look up a type spec; undefined for unknown types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Reset registry (test-only helper). */
export function __resetRegistry(): void {
  registry.clear();
}
