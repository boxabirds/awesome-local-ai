/**
 * Object type registry: declares per-type resize rules and rendering components.
 * Selection, move, resize and delete stay generic (sel.all_types).
 * Each type declares only: whether it can be resized, whether it keeps proportions,
 * its minimum size, and whether it has editable text.
 */
import type { ComponentType } from 'react';
import type {
  ConnectorSnapshot,
  ObjectSnapshot,
} from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { addKnownType } from '../../shared/known-types';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onDoubleClick(e: React.MouseEvent, id: string): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  /**
   * When true, resize handles are horizontal-only (e/w) and dragging them
   * changes the object's fixed width (story 9 text objects).
   */
  horizontalOnly?: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Hit-test a world point for this object type. `zoom` is the current camera
   * zoom (for screen-pixel tolerances) and `rects` the current bounds of all
   * objects (needed to resolve connector endpoints).
   */
  hitTest(
    obj: ObjectSnapshot,
    worldPoint: Point,
    zoom?: number,
    rects?: ReadonlyMap<string, Rect>,
  ): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType "${type}" is already registered`);
  }
  registry.set(type, spec);
  addKnownType(type);
}

/**
 * Get the spec for a registered type, or undefined if not registered.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * Get all registered type names.
 */
export function registeredTypes(): string[] {
  return [...registry.keys()];
}

// --- Register the sticky note type ---
// The StickyNote component is registered here. It will be defined in the
// StickyNote.tsx file and imported lazily to avoid circular deps at module load.
// For now, we register a placeholder that will be replaced when StickyNote.tsx loads.

// We use a deferred registration pattern: the registry stores the spec,
// and the Component is set when StickyNote.tsx is first imported.
// Since StickyNote.tsx imports from this file (for ObjectProps type), we
// register the sticky type here with a forward-referenced component.

import { StickyNote as StickyNoteComponent } from '../objects/StickyNote';

registerObjectType('sticky', {
  Component: StickyNoteComponent as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest(obj, worldPoint) {
    const w = obj.width ?? 200; // STICKY_SIZE_WORLD
    const h = obj.height ?? 200;
    return (
      worldPoint.x >= obj.x &&
      worldPoint.y >= obj.y &&
      worldPoint.x < obj.x + w &&
      worldPoint.y < obj.y + h
    );
  },
});

// --- Register the text type (story 9) ---
import { TextObject as TextObjectComponent } from '../objects/TextObject';

registerObjectType('text', {
  Component: TextObjectComponent as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: false,
  horizontalOnly: true,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  hitTest(obj, worldPoint) {
    const w = obj.width ?? 0;
    const h = obj.height ?? 0;
    return (
      worldPoint.x >= obj.x &&
      worldPoint.y >= obj.y &&
      worldPoint.x < obj.x + w &&
      worldPoint.y < obj.y + h
    );
  },
});

// --- Register the shape type (story 10) ---
import { ShapeObject as ShapeObjectComponent } from '../objects/ShapeObject';

registerObjectType('shape', {
  Component: ShapeObjectComponent as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  // Bounding-box hit test (the default for shapes).
  hitTest(obj, worldPoint) {
    const w = obj.width ?? 0;
    const h = obj.height ?? 0;
    return (
      worldPoint.x >= obj.x &&
      worldPoint.y >= obj.y &&
      worldPoint.x < obj.x + w &&
      worldPoint.y < obj.y + h
    );
  },
});

// --- Register the connector type (story 10) ---
import { ConnectorObject as ConnectorObjectComponent } from '../objects/ConnectorObject';

registerObjectType('connector', {
  Component: ConnectorObjectComponent as unknown as ComponentType<ObjectProps>,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  // Select when within CONNECTOR_HIT_TOLERANCE_PX (screen px) of the line.
  hitTest(obj, worldPoint, zoom = 1, rects) {
    if (obj.type !== 'connector') return false;
    const ends = resolveEndpoints(obj as ConnectorSnapshot, rects ?? new Map());
    return (
      distanceToPolyline([ends.from, ends.to], worldPoint) <=
      CONNECTOR_HIT_TOLERANCE_PX / zoom
    );
  },
});

// --- Register the stroke type (story 11) ---
import { StrokeObject as StrokeObjectComponent } from '../objects/StrokeObject';

registerObjectType('stroke', {
  Component: StrokeObjectComponent as unknown as ComponentType<ObjectProps>,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  // Select only when within max(thickness/2, STROKE_HIT_TOLERANCE_PX/zoom) of the line.
  hitTest(obj, worldPoint, zoom = 1) {
    if (obj.type !== 'stroke') return false;
    const s = obj as StrokeSnap;
    const pts = scaledPoints(s);
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    return distanceToPolyline(pts, worldPoint) <= tolerance;
  },
});
