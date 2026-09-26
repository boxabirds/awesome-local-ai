// Object type registry (sel.registry, story 7).
//
// The whole point of story 7 is that selection, moving, resizing, nudging and
// deleting are written ONCE and apply to every kind of board object. The only
// thing a new type may declare is how those generic operations behave on it —
// whether it can be resized at all, whether it keeps its proportions, how small
// it may get, and how a point hits it. Anything else would leak per-type
// special cases back into the gestures.
//
// This module stays framework-free (no React, no DOM): `Component` is opaque
// here, and the renderer maps a type to its component separately.

import type { Point, Rect } from './geometry';
import { rectContainsPoint } from './geometry';
import { STICKY_MIN_SIZE_WORLD } from './config';

export interface ObjectTypeSpec {
  /** Registry key, matching the `type` field stored on the object. */
  type: string;
  /** Rendering component, if this type draws anything. Opaque on purpose. */
  Component?: unknown;
  /** False → the selection shows no resize handles for a selection containing
   * this type. */
  resizable: boolean;
  /** True → resizing keeps the bounding box's width/height ratio, so a sticky
   * note always stays square (contract `sel.aspect`). */
  aspectLocked: boolean;
  /** Smallest side this type may be resized to, in world units. */
  minSize: number;
  /** True → Enter / double-click opens a text editor for it. */
  editableText: boolean;
  /** Hit test in world space. A point exactly on the edge counts as a hit; a
   * point one unit outside must not (that boundary is asserted in the tests). */
  hitTest(bounds: Rect, point: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. Registering the same key twice is a programming error (it
 * would mean two modules disagreeing about one type's behaviour), so it throws
 * rather than silently picking a winner.
 */
export function registerObjectType(spec: ObjectTypeSpec): void {
  if (registry.has(spec.type)) {
    throw new Error(`object type "${spec.type}" is already registered`);
  }
  registry.set(spec.type, spec);
}

/** Look a type up. Unknown types return `undefined`, which is how the renderer
 * and every group operation know to skip an object. */
export function getObjectType(type: string | undefined): ObjectTypeSpec | undefined {
  if (type === undefined) return undefined;
  return registry.get(type);
}

/** Drop every registration. Test-only: it lets a suite register a throwaway
 * type without leaking it into the next test. */
export function resetObjectTypes(): void {
  registry.clear();
  registerBuiltinTypes();
}

/** True when at least one of `types` can be resized. */
export function anyResizable(types: Iterable<string | undefined>): boolean {
  for (const type of types) {
    const spec = getObjectType(type);
    if (spec?.resizable) return true;
  }
  return false;
}

/** True when at least one of `types` locks its proportions. Aspect lock is
 * contagious across a selection: one square object keeps the whole box square. */
export function anyAspectLocked(types: Iterable<string | undefined>): boolean {
  for (const type of types) {
    const spec = getObjectType(type);
    if (spec?.aspectLocked) return true;
  }
  return false;
}

/** The smallest `minSize` across `types` — a mixed selection stops at the
 * tightest limit, so the whole group is clamped as one. */
export function minSizeOf(types: Iterable<string | undefined>, fallback: number): number {
  let min = fallback;
  for (const type of types) {
    const spec = getObjectType(type);
    if (spec && spec.minSize < min) min = spec.minSize;
  }
  return min;
}

/** Sticky notes: resizable, always square, and hit anywhere inside the note. */
export const STICKY_SPEC: ObjectTypeSpec = {
  type: 'sticky',
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (bounds, point) => rectContainsPoint(bounds, point),
};

function registerBuiltinTypes(): void {
  registerObjectType(STICKY_SPEC);
}

// Registered on module load; `resetObjectTypes` re-registers after a test wipe.
registerBuiltinTypes();
