import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, STROKE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaledPoints } from '../../shared/objects/stroke';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
}

export interface ObjectTypeSpec {
  Component: ComponentType<any>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws if the type is already registered (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for an object type, or undefined if not registered.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ─── Register sticky note ────────────────────────────────────────────────────

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// ─── Register text object ───────────────────────────────────────────────────

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// ─── Register shape ───────────────────────────────────────────────────────────────────

registerObjectType('shape', {
  Component: () => null, // Rendered by BoardApp directly
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
    const bounds = objectBounds(obj);
    return (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    );
  },
});

// ─── Register connector ───────────────────────────────────────────────────────────────

registerObjectType('connector', {
  Component: () => null, // Rendered by BoardApp directly
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest(obj: ObjectSnapshot, _worldPoint: Point, _zoom: number = 1): boolean {
    if (obj.type !== 'connector') return false;
    // Handled by BoardApp
    return false;
  },
});

// ─── Register stroke ───────────────────────────────────────────────────────────────────────

registerObjectType('stroke', {
  Component: () => null, // Rendered by BoardApp directly
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom: number = 1): boolean {
    if (obj.type !== 'stroke') return false;
    const snap = obj as unknown as StrokeSnap;
    const pts = scaledPoints(snap);
    const tolerance = Math.max(PEN_THICKNESS_WORLD[snap.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return distanceToPolyline(pts, worldPoint) <= tolerance;
  },
});
