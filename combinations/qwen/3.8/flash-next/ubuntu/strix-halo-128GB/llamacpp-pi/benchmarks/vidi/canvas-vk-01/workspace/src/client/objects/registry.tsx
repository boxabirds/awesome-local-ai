import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';

/**
 * The props every renderable board object receives. Selection, move, resize
 * and delete are generic — a new object type only declares its own component
 * and a handful of behavioural knobs in {@link ObjectTypeSpec}, it never adds
 * its own selection or transform code (`sel.all_types`).
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  /** Full camera, for objects that turn pointer coordinates back into world. */
  camera: Camera;
  /**
   * Every attachable object's rectangle by id (story 10). Excludes connectors,
   * which have no surface to attach to; an arrow's end handle hit-tests this to
   * find what it was released on.
   */
  rects: ReadonlyMap<string, Rect>;
  selected: boolean;
  editing: boolean;
  /** False while the board is locked (persist.load_failure). */
  editable: boolean;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Begin a press that may become a group move; wired to useTransformGesture. */
  onObjectPointerDown(event: ReactPointerEvent<Element>, id: string): void;
}

/** A single object type's behaviour declaration. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles the selection overlay shows (story 9). 'horizontal'
   * (text) means only east/west: the height follows the wrapped text, it is
   * never dragged directly. Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Does `worldPoint` hit this object? `zoom` (screen pixels per world unit) is
   * only needed by objects whose tolerance is specified on screen — an arrow has
   * to be clickable within a fixed number of pixels however far away the board is
   * zoomed (`connector.select`). Defaults to 1.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Registers `sticky` and (in later stories) every new
 * object type. Throws on duplicate registration — that is a programming error
 * caught at module load.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`registerObjectType: object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // Keep the framework-free model's known-type set in sync so `snapshot` and
  // `allObjectIds` include this type.
  registerModelType(type);
}

/** The spec for a type, or `undefined` when the type is not registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// --- sticky notes (story 2, generalised in story 7) -----------------------
import { registerBoardObjectType as registerModelType } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

function stickyHitTest(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});

// --- free text (story 9) ---------------------------------------------------
import { TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { TextObject } from './TextObject';

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest,
});

// --- shapes (story 10) ----------------------------------------------------
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { ShapeObject } from './ShapeObject';

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});

// --- connectors (story 10) ------------------------------------------------
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { ConnectorSnapshot } from '../../shared/objects/connector';
import { ConnectorObject } from './ConnectorObject';

/**
 * An arrow is selected by how close the click is to its line, never by its
 * bounding box: clicking inside the box but away from the line selects nothing
 * (`connector.select`). The tolerance is specified in screen pixels, so it is
 * divided by the zoom to become world units.
 */
function connectorHitTest(obj: ObjectSnapshot, worldPoint: Point, zoom = 1): boolean {
  const connector = obj as ConnectorSnapshot;
  if (connector.fromPoint === undefined || connector.toPoint === undefined) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
  return distanceToPolyline([connector.fromPoint, connector.toPoint], worldPoint) <= tolerance;
}

registerObjectType('connector', {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: connectorHitTest,
});

// --- strokes (story 11) ---------------------------------------------------
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../shared/config';
import type { StrokeSnap } from '../../shared/objects/stroke';
import { scaledPoints } from '../../shared/objects/stroke';
import { StrokeObject } from './StrokeObject';

/**
 * A stroke is selected only by how close the click is to its drawn line,
 * never by its bounding box. Clicks inside the bbox but away from the line
 * fall through to objects below (`pen.select`).
 */
function strokeHitTest(obj: ObjectSnapshot, worldPoint: Point, zoom = 1): boolean {
  const stroke = obj as StrokeSnap;
  if (!Array.isArray(stroke.points) || stroke.points.length < 2) return false;
  const tolerance = Math.max(
    PEN_THICKNESS_WORLD[stroke.thickness] / 2,
    STROKE_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1),
  );
  const pts = scaledPoints(stroke);
  // Offset worldPoint into the stroke's local coordinate space (relative to bbox origin)
  const localPoint = { x: worldPoint.x - stroke.x, y: worldPoint.y - stroke.y };
  return distanceToPolyline(pts, localPoint) <= tolerance;
}

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});
