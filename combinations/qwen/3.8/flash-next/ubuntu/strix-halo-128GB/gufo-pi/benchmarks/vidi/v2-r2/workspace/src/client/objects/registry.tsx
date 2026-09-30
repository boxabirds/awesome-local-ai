import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import type { Point } from '@shared/geometry';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD, SHAPE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD, PEN_THICKNESS_WORLD, IMAGE_MIN_SIZE_WORLD } from '@shared/config';
import { distanceToPolyline } from '@shared/geometry/polyline';
import { scaledPoints } from '@shared/objects/stroke';
import type { StrokeSnap } from '@shared/objects/stroke';

export interface ObjectProps {
  obj: ObjectSnapshot;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  zoom: number;
  onPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  handles?: 'all' | 'horizontal';
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType "${type}" is already registered`);
  }
  registry.set(type, spec);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- Register sticky note type ---

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// --- Register text type ---

function textHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

// We do NOT register sticky here with the component to avoid circular deps in unit tests.
// The actual registration (with component) happens in a separate init module.

// For testability and to avoid circular imports in unit tests, we use a deferred pattern:
let stickyRegistered = false;
let textTypeRegistered = false;

export function registerStickyType(component: ObjectTypeSpec['Component']): void {
  if (stickyRegistered) return;
  stickyRegistered = true;
  registerObjectType('sticky', {
    Component: component,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    handles: 'all',
    hitTest: stickyHitTest,
  });
}

export function registerTextType(component: ObjectTypeSpec['Component']): void {
  if (textTypeRegistered) return;
  textTypeRegistered = true;
  registerObjectType('text', {
    Component: component,
    resizable: true,
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest: textHitTest,
  });
}

// Allow tests to reset registry state
export function _resetRegistryForTesting(): void {
  registry.clear();
  stickyRegistered = false;
  textTypeRegistered = false;
  shapeTypeRegistered = false;
  connectorTypeRegistered = false;
  strokeTypeRegistered = false;
  imageTypeRegistered = false;
}

/**
 * Returns true if all selected object specs have handles === 'horizontal'.
 */
export function allHandlesHorizontal(types: readonly string[]): boolean {
  if (types.length === 0) return false;
  return types.every((t) => {
    const spec = registry.get(t);
    return spec?.handles === 'horizontal';
  });
}

// Allow tests to reset connector registration
let shapeTypeRegistered = false;
let connectorTypeRegistered = false;

export function registerShapeType(component: ObjectTypeSpec['Component']): void {
  if (shapeTypeRegistered) return;
  shapeTypeRegistered = true;
  registerObjectType('shape', {
    Component: component,
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    handles: 'all',
    hitTest: (obj, worldPoint) => {
      const bounds = objectBounds(obj);
      return (
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height
      );
    },
  });
}

export function registerConnectorType(component: ObjectTypeSpec['Component']): void {
  if (connectorTypeRegistered) return;
  connectorTypeRegistered = true;
  registerObjectType('connector', {
    Component: component,
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest: (obj, worldPoint) => {
      // For connector hit test, we use the resolved endpoints from the snapshot
      const snap = obj as any;
      if (!snap.from || !snap.to) return false;
      // We can't compute resolved endpoints here without the rects map,
      // so use bbox approximation. Actual hit testing is done by the parent.
      const bounds = objectBounds(obj);
      // Expand by hit tolerance
      const tolerance = CONNECTOR_HIT_TOLERANCE_PX; // will be divided by zoom in parent
      return (
        worldPoint.x >= bounds.x - tolerance &&
        worldPoint.x <= bounds.x + bounds.width + tolerance &&
        worldPoint.y >= bounds.y - tolerance &&
        worldPoint.y <= bounds.y + bounds.height + tolerance
      );
    },
  });
}

// --- Register stroke type ---

let strokeTypeRegistered = false;

export function registerStrokeType(component: ObjectTypeSpec['Component']): void {
  if (strokeTypeRegistered) return;
  strokeTypeRegistered = true;
  registerObjectType('stroke', {
    Component: component,
    resizable: true,
    aspectLocked: true,
    minSize: STROKE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest: (obj: ObjectSnapshot, worldPoint: Point, zoom?: number) => {
      const stroke = obj as unknown as StrokeSnap;
      if (!stroke.points || !Array.isArray(stroke.points)) return false;
      const pts = scaledPoints(stroke);
      if (pts.length === 0) return false;
      const dist = distanceToPolyline(pts, worldPoint);
      const thicknessHalf = PEN_THICKNESS_WORLD[stroke.thickness] / 2;
      const effectiveZoom = zoom ?? 1;
      const tolerance = Math.max(thicknessHalf, STROKE_HIT_TOLERANCE_PX / effectiveZoom);
      return dist <= tolerance;
    },
  });
}

// --- Register image type ---

let imageTypeRegistered = false;

export function registerImageType(component: ObjectTypeSpec['Component']): void {
  if (imageTypeRegistered) return;
  imageTypeRegistered = true;
  registerObjectType('image', {
    Component: component,
    resizable: true,
    aspectLocked: true,
    minSize: IMAGE_MIN_SIZE_WORLD,
    editableText: false,
    handles: 'all',
    hitTest: (obj: ObjectSnapshot, worldPoint: Point) => {
      const bounds = objectBounds(obj);
      return (
        worldPoint.x >= bounds.x &&
        worldPoint.x <= bounds.x + bounds.width &&
        worldPoint.y >= bounds.y &&
        worldPoint.y <= bounds.y + bounds.height
      );
    },
  });
}
