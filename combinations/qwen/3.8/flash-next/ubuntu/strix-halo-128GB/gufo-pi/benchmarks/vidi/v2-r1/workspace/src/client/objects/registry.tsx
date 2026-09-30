/**
 * Object type registry: each board object type declares its component,
 * resizability, aspect lock, minimum size, text editability, handle mode
 * and hit-test. Stories 9-12 add new types here without duplicating
 * selection/transform code.
 */

import type { ObjectSnapshot, Point } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, STROKE_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

export interface ObjectTypeSpec {
  Component: React.ComponentType<any> | null;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /** Handle set: 'all' (8 handles) or 'horizontal' (e/w only). Default 'all'. */
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Hit test: world point falls within the object's bounds. */
function boundsHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.y >= bounds.y &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// Register the sticky type at module load.
registerObjectType('sticky', {
  Component: null,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: boundsHitTest,
});

// Register the text type (story 9).
registerObjectType('text', {
  Component: null,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
});

// Register the shape type (story 10).
registerObjectType('shape', {
  Component: null,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: boundsHitTest,
});

// Register the connector type (story 10).
registerObjectType('connector', {
  Component: null,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  handles: 'all',
  hitTest: (_obj, _worldPoint) => {
    // Connectors use a custom hit test based on distance to the line.
    // This is handled in ConnectorObject; for the registry, always return false
    // since connector selection uses a different mechanism.
    return false;
  },
});

// Register the stroke type (story 11).
registerObjectType('stroke', {
  Component: null,
  resizable: true,
  aspectLocked: true,
  minSize: 4, // STROKE_MIN_SIZE_WORLD
  editableText: false,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const snap = obj as StrokeSnap;
    if (snap.type !== 'stroke') return false;
    const pts = scaledPoints(snap);
    if (pts.length === 0) return false;
    const thicknessHalf = PEN_THICKNESS_WORLD[snap.thickness] / 2;
    // Zoom is not available here; the BoardViewport scales the tolerance before calling hitTest.
    // Use a generous hit tolerance in world units (6px at zoom 1).
    const tolerance = Math.max(thicknessHalf, STROKE_HIT_TOLERANCE_PX);
    return distanceToPolyline(pts, worldPoint) <= tolerance;
  },
});

/** Set the Component for an already-registered type (used by the app for lazy binding). */
export function setObjectComponent(type: string, Component: React.ComponentType<any>): void {
  const spec = registry.get(type);
  if (spec) spec.Component = Component;
}

// Register the image type (story 12).
registerObjectType('image', {
  Component: null,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest: boundsHitTest,
});
