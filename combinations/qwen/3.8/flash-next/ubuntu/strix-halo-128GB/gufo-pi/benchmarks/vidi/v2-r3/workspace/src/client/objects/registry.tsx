import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';

/**
 * Per-type specification: the only knobs an object type may declare.
 * Selection, move, resize and delete logic stays generic (sel.all_types).
 */
export interface ObjectTypeSpec {
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
  /** Zoom-aware hit test (used when available by selection logic). */
  hitTestZoom?(obj: ObjectSnapshot, worldPoint: Point, zoom: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Look up the spec for a registered type. Returns undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register the `sticky` type ---

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

registerObjectType('sticky', {
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: stickyHitTest,
});

// --- Register the `text` type ---

registerObjectType('text', {
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest, // reuse rectangular hit test
});

// --- Register the `shape` type ---

registerObjectType('shape', {
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: stickyHitTest, // bbox hit test
});

// --- Register the `connector` type ---

registerObjectType('connector', {
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    // Connector hit test uses distanceToPolyline; needs zoom which is not in the interface.
    // The default is always false; the caller (App) uses a zoom-aware path.
    // For the registry hit test (used by marquee/selection), we accept if inside bbox.
    const bounds = objectBounds(obj);
    // For connectors, we only allow hit if very close (handled externally with zoom)
    // Use a generous bbox for the selection overlay but actual selection uses tolerance
    return (
      worldPoint.x >= bounds.x - 20 &&
      worldPoint.x <= bounds.x + bounds.width + 20 &&
      worldPoint.y >= bounds.y - 20 &&
      worldPoint.y <= bounds.y + bounds.height + 20
    );
  },
});

// --- Register the `stroke` type (story 11) ---

registerObjectType('stroke', {
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    // Conservative bbox-based hit test for the registry (used by marquee etc.)
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
  hitTestZoom(obj: ObjectSnapshot, worldPoint: Point, zoom: number): boolean {
    const s = obj as StrokeSnap;
    const threshold = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return distanceToPolyline(scaledPoints(s), worldPoint) <= threshold;
  },
});

// --- Register the `image` type (story 12) ---

registerObjectType('image', {
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest: stickyHitTest,
});
