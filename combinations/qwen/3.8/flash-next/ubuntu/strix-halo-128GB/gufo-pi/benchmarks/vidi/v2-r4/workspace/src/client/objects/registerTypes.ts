/**
 * Registers the sticky note, text object, shape, and connector types in the object type registry.
 * Imported by App.tsx (and tests) to populate the registry.
 */
import { registerObjectType } from './registry';
import { objectBounds } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { ConnectorSnap } from '../../shared/objects/connector';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

// Register sticky note type
registerObjectType('sticky', {
  Component: (() => null) as any, // rendered by App directly; registry is for generic logic
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});

// Register text object type (story 9)
registerObjectType('text', {
  Component: (() => null) as any, // rendered by App directly
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});

// Register shape type (story 10)
registerObjectType('shape', {
  Component: (() => null) as any, // rendered by App directly
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});

// Register connector type (story 10)
registerObjectType('connector', {
  Component: (() => null) as any, // rendered by App directly
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj, worldPoint) {
    const conn = obj as unknown as ConnectorSnap;
    // Resolve endpoints for hit test using stored positions
    const fromPt = conn.from.kind === 'free' ? { x: conn.from.x, y: conn.from.y } : conn.from.fallback;
    const toPt = conn.to.kind === 'free' ? { x: conn.to.x, y: conn.to.y } : conn.to.fallback;
    const dist = distanceToPolyline([fromPt, toPt], worldPoint);
    // Use a world-space tolerance based on 6 screen pixels at zoom=1
    return dist <= CONNECTOR_HIT_TOLERANCE_PX;
  },
});

// Register stroke type (story 11)
registerObjectType('stroke', {
  Component: (() => null) as any, // rendered by App directly
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest(obj, worldPoint, zoom = 1) {
    const stroke = obj as unknown as StrokeSnap;
    const pts = scaledPoints(stroke);
    const dist = distanceToPolyline(pts, worldPoint);
    const tolerance = Math.max(PEN_THICKNESS_WORLD[stroke.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return dist <= tolerance;
  },
});

// Register image type (story 12)
registerObjectType('image', {
  Component: (() => null) as any, // rendered by App directly
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest(obj, worldPoint) {
    const b = objectBounds(obj);
    return (
      worldPoint.x >= b.x &&
      worldPoint.y >= b.y &&
      worldPoint.x <= b.x + b.width &&
      worldPoint.y <= b.y + b.height
    );
  },
});
