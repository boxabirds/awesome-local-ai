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
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { rectContains, type Point } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';

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
  /**
   * True when `worldPoint` lies on the object's footprint.
   *
   * `zoom` (screen pixels per world unit, 1 when the caller has no camera) lets
   * a type whose footprint is a *line* keep its tolerance in screen pixels: an
   * arrow stays just as easy to hit at 20 % as at 200 % (PRD
   * `shape.connector_precise`).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
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

/**
 * Shapes (story 10): resizable in both axes, no aspect lock (a dragged ellipse
 * may be wide or tall), and they carry a centred label, so they own editable
   text. Their footprint is the bounding box, which is what the PRD asks for
 * (`shape.create_drag` selects a shape by its box, not by its exact outline).
 */
export const SHAPE_TYPE = 'shape';

registerObjectType(SHAPE_TYPE, {
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: rectangularHitTest,
});

/**
 * Connectors (story 10): not resizable and not aspect-locked — an arrow's shape
 * is decided by what its ends point at, so there is nothing to drag. Its
 * footprint is deliberately *not* its bounding box: a click inside the box but
 * far from the line must not select it (PRD `shape.arrow_select`), so the test
 * is a distance to the drawn line, kept at {@link CONNECTOR_HIT_TOLERANCE_PX}
 * screen pixels by dividing the zoom out.
 */
export const CONNECTOR_TYPE = 'connector';

registerObjectType(CONNECTOR_TYPE, {
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  handles: 'all',
  hitTest: (obj, worldPoint, zoom = 1) => {
    const ends = obj.ends;
    if (!ends) return false;
    const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
    return distanceToPolyline([ends.from, ends.to], worldPoint) <= tolerance;
  },
});

/**
 * The topmost object whose footprint contains `worldPoint`, or `null`.
 *
 * Used by the Connector tool and by an arrow's end handle: both need to know
 * what is *under the pointer*, which is a question about the model (the DOM may
 * have a tool overlay in the way). `snapshot` is in z order, so the scan runs
 * back to front. `zoom` defaults to 1 — a tool that cares about a screen-pixel
 * tolerance passes its camera.
 */
export function hitTestAt(
  snapshot: readonly ObjectSnapshot[],
  worldPoint: Point,
  zoom = 1,
): ObjectSnapshot | null {
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const obj = snapshot[i];
    const spec = getObjectType(obj.type);
    if (!spec) continue;
    if (spec.hitTest(obj, worldPoint, zoom)) return obj;
  }
  return null;
}