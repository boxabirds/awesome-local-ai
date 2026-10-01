import type React from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { Point } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  objectBounds,
  registerKnownObjectType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObject } from './ImageObject';
import type { Measurer } from './textLayout';

/**
 * Story 7 (sel.registry): one declaration per board object type.
 *
 * A type can only declare:
 *   - Component: its renderer (takes ObjectProps)
 *   - resizable / aspectLocked / minSize: resize behaviour
 *   - editableText: double-click editing
 *   - hitTest: is a world point inside this object?
 *
 * Selection, moving, resizing, nudging and deletion are generic over types
 * (sel.all_types) — nothing in the selection/gesture code knows about
 * stickies specifically.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** Primary pointerdown on the object: select (shift toggles) + start group drag. */
  onObjectPointerDown(e: PointerEvent, id: string): void;
  /** Double-click: enter text edit mode (editableText types only). */
  onStartEdit(id: string): void;
  /**
   * Text edit ended. `selected`: the object stays selected (Escape, Enter
   * commit); `unselected`: a pointerdown outside ended it → the whole
   * selection is cleared (story 2 contract, kept for story 7).
   */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Per-client undo history (story 8): step boundaries + in-editor shortcuts. */
  undo?: UndoController;
  /**
   * Story 9: text measurement for box sync (only text objects use it).
   */
  measurer?: Measurer;
  /**
   * Story 11 (pen.select fall-through): pointerdown inside this object's
   * bounds that missed its line hit test. The board resolves the topmost
   * object underneath (registry hit test) and starts its gesture; with
   * nothing underneath the event is left un-stopped so the viewport keeps
   * its normal pan/marquee/clear behaviour.
   */
  onMissHit?: (e: PointerEvent, world: Point) => void;
  /** The current camera (used by the stroke object for line hit tests). */
  camera?: Camera;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** Shows resize handles when selected. */
  resizable: boolean;
  /** Keeps the width/height ratio while resizing (and on Shift+resize). */
  aspectLocked: boolean;
  /** Minimum edge length in world units. */
  minSize: number;
  /** Double-click enters a text editor. */
  editableText: boolean;
  /**
   * Story 9: which resize handles to show when selected. 'horizontal' shows
   * only the east/west handles (text: width only, height follows content).
   */
  handles?: 'all' | 'horizontal';
  /** Is the world point inside this object? */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a bug).
 * Also marks the type as known to the board model (side effect) so
 * `allObjectIds` includes its objects in generic selection.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`vidi6: object type '${type}' is already registered`);
  }
  registry.set(type, spec);
  registerKnownObjectType(type);
}

/** The spec for `type`, or undefined for unknown/unregistered types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The sticky note type (stories 1-2, now sized and resizable). */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});

/** The free text type (story 9): horizontal handles only, no aspect lock. */
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});

/** The shape type (story 10): resizable, editable label. */
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});

/**
 * The stroke type (story 11): selectable by line distance (never by the
 * bbox), resizable with the aspect ratio locked, never text-editable.
 */
registerObjectType('stroke', {
  Component: StrokeObject as unknown as React.ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => {
    const s = obj as StrokeSnap;
    return distanceToPolyline(scaledPoints(s), p) <=
      Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
  },
});

/**
 * Story 11 (pen.select fall-through): the topmost object whose registry hit
 * test passes at `world`, or null. Topmost = greatest `(z, id)`, the same
 * ordering `objects()` renders with.
 */
export function objectAtPoint(
  snapshot: readonly ObjectSnapshot[],
  world: Point,
  zoom = 1,
): ObjectSnapshot | null {
  let best: ObjectSnapshot | null = null;
  let bestKey: [number, string] | null = null;
  for (const o of snapshot) {
    const spec = getObjectType(o.type);
    if (!spec) continue;
    if (!spec.hitTest(o, world, zoom)) continue;
    const key: [number, string] = [o.z, o.id];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = o;
      bestKey = key;
    }
  }
  return best;
}

/** The connector type (story 10): not resizable, hit test by line distance. */
registerObjectType('connector', {
  Component: ConnectorObject as unknown as React.ComponentType<ObjectProps>,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, p, zoom = 1) => {
    // Connector hit test: use the stored bbox expanded by the hit tolerance.
    // The precise line-distance test is handled by ConnectorObject's pointer events.
    const r = objectBounds(obj);
    const margin = CONNECTOR_HIT_TOLERANCE_PX / zoom;
    return (
      p.x >= r.x - margin && p.x <= r.x + r.width + margin &&
      p.y >= r.y - margin && p.y <= r.y + r.height + margin
    );
  },
});

/** The image type (story 12): resizable with aspect lock, minimum size 16. */
registerObjectType('image', {
  Component: ImageObject as unknown as React.ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, p) =>
    rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 }),
});
