import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import {
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  IMAGE_MIN_SIZE_WORLD,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObjectAdapter } from './ImageObject';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';

/**
 * Props every board object component receives (sel.all_types). Selection,
 * move, resize and delete behaviour is generic (story 7); a type declares
 * only its resize rules via `ObjectTypeSpec` and renders itself.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a transform gesture is moving this object. */
  dragging: boolean;
  /** Generic pointerdown handler (click / shift-click / drag — useTransformGesture). */
  onObjectPointerDown(e: ReactPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /** Editor ended: 'selected' keeps the selection (Escape), 'unselected' clears it (outside click). */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
  /** Story 10: the full snapshot (needed by ConnectorObject for endpoint resolution). */
  snapshot?: readonly ObjectSnapshot[];
  /** Story 10: the camera (needed by ConnectorObject for handle drags). */
  camera?: import('../canvas/camera').Camera;
}

/**
 * Per-type declaration (sel.all_types, sel.size_limits). The only per-type
 * knobs: whether the type can be resized, whether it keeps its proportions,
 * its minimum size, and whether it has editable text. The maximum size is
 * the global MAX_OBJECT_SIZE_WORLD.
 */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles the selection overlay shows (story 9): 'all' (the
   * default) for the full 8-handle box (sticky notes) or 'horizontal' for
   * only the east and west handles (free text — height stays content-driven,
   * so n/s handles are meaningless).
   */
  handles?: 'all' | 'horizontal';
  /**
   * Whether `worldPoint` hits this object. `zoom` (screen px per world unit)
   * lets screen-pixel tolerances scale with the camera (story 11 strokes,
   * story 10 connectors).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a board object type. Throws on duplicate registration (a
 * programming error, caught by tests). Stories 9–12 call this and must not
 * add their own selection or transform code.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`ObjectType '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for unknown types (skipped by the renderer and select-all). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** True when `worldPoint` lies within `rect` (left/top inclusive, right/bottom exclusive). */
function pointInRect(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height
  );
}

/**
 * The sticky note type (story 2, made resizable in story 7): resizable,
 * aspect-locked (stays square), minimum STICKY_MIN_SIZE_WORLD, editable text.
 */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

/**
 * The free text type (story 9): resizable (east/west handles set a fixed
 * width; the height is always re-measured from the content), never
 * aspect-locked, minimum TEXT_MIN_WIDTH_WORLD, editable text.
 */
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

/**
 * The shape type (story 10): resizable, not aspect-locked, minimum
 * SHAPE_MIN_SIZE_WORLD, editable text (label).
 */
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

/**
 * The connector type (story 10): not resizable, hit-test uses
 * distanceToPolyline with CONNECTOR_HIT_TOLERANCE_PX.
 */
registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (_obj, _worldPoint) => {
    // The hit test for connectors needs zoom context; the registry's hitTest
    // is a simplified version. The real hit test is done in the selection
    // logic with zoom awareness.
    return false;
  },
});

/**
 * The pen stroke type (story 11): resizable, aspect-locked (the drawn line
 * scales in proportion; the thickness never scales), minimum
 * STROKE_MIN_SIZE_WORLD, no editable text. Hit test is by line distance:
 * a click selects the stroke only within max(thickness / 2,
 * STROKE_HIT_TOLERANCE_PX / zoom) of the line, so clicks in empty space
 * inside the bbox fall through to objects below (pen.select).
 */
registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, worldPoint, zoom = 1) => {
    const s = obj as StrokeSnap;
    if (!s.points || s.points.length === 0) return false;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[s.thickness ?? 'medium'] / 2,
      STROKE_HIT_TOLERANCE_PX / (zoom || 1),
    );
    return distanceToPolyline(scaledPoints(s), worldPoint) <= tolerance;
  },
});

/**
 * The image type (story 12): resizable, aspect-locked (images always keep
 * their proportions), minimum IMAGE_MIN_SIZE_WORLD, no editable text.
 * Hit test is the bounding box (bbox).
 */
registerObjectType('image', {
  Component: ImageObjectAdapter,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});
