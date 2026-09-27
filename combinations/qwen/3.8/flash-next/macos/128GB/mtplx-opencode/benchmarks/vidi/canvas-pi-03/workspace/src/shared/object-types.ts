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
import {
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  CONNECTOR_HIT_TOLERANCE_PX,
} from './config';
import { distanceToPolyline } from './geometry/polyline';

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
  /** False → a group move leaves this type alone. An arrow's position is
   * derived from its ends, so translating a stored x/y would be meaningless. */
  movable?: boolean;
  /** Which resize handles a selection of ONLY this kind shows. 'all' is the
   * eight-handle box; 'horizontal' means the height is derived from the
   * content and only the left/right edges resize (contract `text.height`).
   * Defaults to 'all'. */
  handles?: 'all' | 'horizontal';
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

/** True when EVERY type in `types` declares 'horizontal' handles — the only
 * case where the box drops its corner and edge handles. An unknown type counts
 * as 'all', so a mixed selection always gets the full box. */
export function allHorizontalHandles(types: Iterable<string | undefined>): boolean {
  let seen = false;
  for (const type of types) {
    const spec = getObjectType(type);
    if (!spec || spec.handles !== 'horizontal') return false;
    seen = true;
  }
  return seen;
}

/** Which resize handles a selection of ONLY this kind shows. */
export type ResizeMode = 'all' | 'horizontal' | 'none';

/**
 * The resize mode of one type: 'none' when it is unknown or not resizable
 * (every generic gesture then skips it), 'horizontal' when only its width is
 * driven by the pointer, 'all' for the eight-handle box.
 */
export function resizeModeOf(type: string | undefined): ResizeMode {
  const spec = getObjectType(type);
  if (spec === undefined || !spec.resizable) return 'none';
  return spec.handles ?? 'all';
}

/**
 * The resize mode of a whole selection. It is narrowed to 'horizontal' only
 * when EVERY member declares that mode — a cluster with one sticky in it keeps
 * its full eight-handle box, because the box belongs to the group, not to the
 * tightest member. One unresizable (or unknown) member takes the handles away.
 */
export function selectionResizeMode(types: Iterable<string | undefined>): ResizeMode {
  let all = false;
  for (const type of types) {
    const mode = resizeModeOf(type);
    if (mode === 'none') return 'none';
    if (mode === 'all') all = true;
  }
  if (!all) return 'horizontal';
  return 'all';
}

/** True when EVERY type resizes freely in both axes (the W/H fields' case). */
export function allFreeResize(types: Iterable<string | undefined>): boolean {
  for (const type of types) {
    if (resizeModeOf(type) !== 'all') return false;
  }
  return true;
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

/** Free text (story 9): width resizes through the e/w handles only — the height
 * always follows the text, so a top/bottom handle would fight the layout. Not
 * aspect-locked: dragging a corner of a mixed selection repositions a text
 * block proportionally without changing its font size. */
export const TEXT_SPEC: ObjectTypeSpec = {
  type: 'text',
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (bounds, point) => rectContainsPoint(bounds, point),
};

/** Shapes: resizable in both axes (no aspect lock), and hit anywhere inside
 * the drawn box, like a note. */
export const SHAPE_SPEC: ObjectTypeSpec = {
  type: 'shape',
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (bounds, point) => rectContainsPoint(bounds, point),
};

/** Connectors: no resize handles and no text editor (contract `connector.ui`).
 *
 * `hitTest` is deliberately the loose bounding-box test: whether a click landed
 * on the line itself is decided by `hitConnector` (the polyline distance, in
 * SCREEN pixels over zoom), which is what the renderer and the tests use. The
 * rectangle test here only answers "is this point anywhere near the arrow", and
 * that is all the marquee and the group transform need.
 */
export const CONNECTOR_SPEC: ObjectTypeSpec = {
  type: 'connector',
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  movable: false,
  hitTest: (bounds, point) => rectContainsPoint(bounds, point),
};

/** True when a point is within CONNECTOR_HIT_TOLERANCE_PX SCREEN pixels of an
 * arrow's line (`tolerance / zoom` world units). */
export function hitConnector(ends: readonly Point[], point: Point, zoom: number): boolean {
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  return distanceToPolyline(ends, point) <= tolerance;
}

function registerBuiltinTypes(): void {
  registerObjectType(STICKY_SPEC);
  registerObjectType(TEXT_SPEC);
  registerObjectType(SHAPE_SPEC);
  registerObjectType(CONNECTOR_SPEC);
}

// Registered on module load; `resetObjectTypes` re-registers after a test wipe.
registerBuiltinTypes();
