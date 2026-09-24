/**
 * Story 7 · task 8 — the object-type registry (design "Object type registry").
 *
 * The single place that declares what each board object type can *do*: whether
 * it is resizable, whether resizing keeps its aspect ratio, its minimum size and
 * whether it carries editable text. Selection, group move and resize stay
 * generic — they read these knobs instead of special-casing a type — which is
 * what lets stories 9–12 add shapes by calling `registerObjectType` and adding
 * no transform code of their own (`sel.all_types`).
 *
 * It holds only declarative data plus a pure `hitTest`, so it imports no
 * component or DOM code and is unit-testable in Node.
 */
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, STICKY_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';

export interface ObjectTypeSpec {
  /** Whether the selection shows resize handles for this type. */
  resizable: boolean;
  /** Whether resizing keeps the object's width : height ratio. */
  aspectLocked: boolean;
  /** Smallest edge the object may be resized to, in world units. */
  minSize: number;
  /** Whether the object owns editable text (drives the text editor). */
  editableText: boolean;
  /**
   * Which resize handles the selection offers. `'all'` (the default) is the
   * eight-edge sticky behaviour; `'horizontal'` (free text) shows only the east
   * and west handles, because a text box's height is derived from its content
   * and is never dragged directly (design Key decision 2).
   */
  handles?: 'all' | 'horizontal';
  /** True when `worldPoint` lies on the object's footprint. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. Registering the same name twice is a programming error (two
 * components cannot both own `sticky`), so it throws at load — caught by the
 * registry tests.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
}

/** The spec for a type, or `undefined` when it is unknown to this client. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The handles a type offers (defaults to `'all'` when unset / unknown). */
export function getHandles(type: string): 'all' | 'horizontal' {
  return registry.get(type)?.handles ?? 'all';
}

/** True when the type is known to this client (used to filter snapshots). */
export function hasObjectType(type: string): boolean {
  return registry.has(type);
}

/** A rectangular object: a point is on it when it is inside its bounds. */
export function rectangularHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(objectBounds(obj), {
    x: worldPoint.x,
    y: worldPoint.y,
    width: 0,
    height: 0,
  });
}

/**
 * The sticky note: square, aspect-locked, resizable, editable text. Its default
 * size is STICKY_SIZE_WORLD; it may shrink to STICKY_MIN_SIZE_WORLD. Registered
 * once at module load; the test-only `testbox` type is registered separately by
 * the test fixture, never here.
 */
export const STICKY_TYPE = 'sticky';

registerObjectType(STICKY_TYPE, {
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: rectangularHitTest,
});

/**
 * Free text (story 9): resizable, not aspect-locked, editable, and with
 * **horizontal-only** handles (its height follows the wrapped content). The
 * resize maths therefore runs in `'width'` mode for a lone text box and its
 * minimum width is `TEXT_MIN_WIDTH_WORLD`.
 */
export const TEXT_TYPE = 'text';

registerObjectType(TEXT_TYPE, {
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: rectangularHitTest,
});

/** The default rectangular footprint for an object with no stored size. */
export const DEFAULT_OBJECT_SIZE = STICKY_SIZE_WORLD;