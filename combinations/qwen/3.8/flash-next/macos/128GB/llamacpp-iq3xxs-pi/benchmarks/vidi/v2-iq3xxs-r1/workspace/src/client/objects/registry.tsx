import type { ComponentType } from 'react';
import type { ObjectSnapshot, WorldPoint } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  IMAGE_MIN_SIZE_WORLD,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { rectContains } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { isConnectorSnap } from '../../shared/objects/connector';
import { isStrokeSnap, scaledPoints } from '../../shared/objects/stroke';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObject } from './ImageObject';

/**
 * Per-type knobs the generic selection/move/resize/delete machinery needs.
 * Stories 9–12 add types by calling `registerObjectType`; they must not add
 * their own selection or transform code.
 */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  aspectLocked: boolean;
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles this type offers (story 9). `'all'` is the 8-way box
   * stories 2–7 know; `'horizontal'` is for objects whose height always follows
   * their content — text rewraps, it does not stretch. SelectionOverlay reads this
   * instead of testing a type name, so adding a type stays a registration.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Whether a point is on this object. `zoom` is passed only where a type's
   * tolerance is measured on screen rather than in board units — a connector is hit
   * within 6 px of its line whatever the zoom is (story 10, PRD conn.endpoint).
   */
  hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint, zoom?: number): boolean;
}

/** Props every registered object component receives (sel.all_types). */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable?: boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// Register sticky notes inline to avoid circular imports
function registerSticky() {
  if (registry.has('sticky')) return; // already registered (hot reload guard)
  registry.set('sticky', {
    Component: StickyNote as unknown as ComponentType<ObjectProps>,
    resizable: true,
    aspectLocked: true,
    minSize: STICKY_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      const bounds = objectBounds(obj);
      return rectContains(bounds, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

// Register free text inline for the same reason, and because the selection machinery
// asks for its spec the same way it asks for a note's.
function registerText() {
  if (registry.has('text')) return;
  registry.set('text', {
    Component: TextObject as unknown as ComponentType<ObjectProps>,
    resizable: true,
    // A text object's height comes from its content, and its width does not follow
    // its top-left being dragged: nothing here keeps a ratio (PRD text.fixed_width).
    aspectLocked: false,
    minSize: TEXT_MIN_WIDTH_WORLD,
    editableText: true,
    handles: 'horizontal',
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      const bounds = objectBounds(obj);
      return rectContains(bounds, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

// Shapes and connectors (story 10) register the same way, for the same reason: the
// generic selection machinery asks every type the same question.
function registerShape(): void {
  if (registry.has('shape')) return;
  registry.set('shape', {
    Component: ShapeObject as unknown as ComponentType<ObjectProps>,
    // A shape has no content to fit, so it is stretched freely in both directions
    // and never keeps a ratio — Shift belongs to the drawing gesture (PRD shape.resize).
    resizable: true,
    aspectLocked: false,
    minSize: SHAPE_MIN_SIZE_WORLD,
    editableText: true,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      // The bounding box, whatever the kind: an ellipse is selected by its box, which
      // is what the outline, the move handles and the marquee all agree on.
      return rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

function registerConnector(): void {
  if (registry.has('connector')) return;
  registry.set('connector', {
    Component: ConnectorObject as unknown as ComponentType<ObjectProps>,
    // Where a connector goes is decided by its ends, not by a box: dragging a corner
    // of an invisible box would move nothing sensible (PRD conn.endpoint).
    resizable: false,
    aspectLocked: false,
    minSize: 0,
    editableText: false,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint, zoom = 1): boolean {
      if (!isConnectorSnap(obj)) return false;
      const { from, to } = obj.ends;
      return distanceToPolyline([from, to], worldPoint) <= CONNECTOR_HIT_TOLERANCE_PX / zoom;
    },
  });
}

function registerStroke(): void {
  if (registry.has('stroke')) return;
  registry.set('stroke', {
    Component: StrokeObject as unknown as ComponentType<ObjectProps>,
    // A stroke is a drawing, so it is resized, but only in proportion: squashing a
    // handwritten line is not a thing a person means to do (PRD pen.resize).
    resizable: true,
    aspectLocked: true,
    minSize: STROKE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint, zoom = 1): boolean {
      if (!isStrokeSnap(obj)) return false;
      // Only the line itself is clickable: within half the ink, or 6 px of screen,
      // whichever is wider. A click inside the box but away from the line misses,
      // and selection falls through to whatever is underneath (PRD pen.select).
      const tolerance = Math.max(
        PEN_THICKNESS_WORLD[obj.thickness] / 2,
        STROKE_HIT_TOLERANCE_PX / (zoom > 0 ? zoom : 1),
      );
      return distanceToPolyline(scaledPoints(obj), worldPoint) <= tolerance;
    },
  });
}

// Images (story 12) are the simplest box on the board: they have no text to edit and
// no shape of their own, so the bounding box is the object.
function registerImage(): void {
  if (registry.has('image')) return;
  registry.set('image', {
    Component: ImageObject as unknown as ComponentType<ObjectProps>,
    resizable: true,
    // An image is always resized in proportion: a squashed photograph is not a thing a
    // person means to do, and Shift has nothing else to mean here (PRD image.aspect_resize).
    aspectLocked: true,
    // A picture can be shrunk to a thumbnail, but not below a box whose status text and
    // buttons could still be found (IMAGE_MIN_SIZE_WORLD, PRD image.aspect_resize).
    minSize: IMAGE_MIN_SIZE_WORLD,
    editableText: false,
    hitTest(obj: ObjectSnapshot, worldPoint: WorldPoint): boolean {
      // The whole box, placeholder included: a person aiming at the grey box means the
      // image that is coming.
      return rectContains(objectBounds(obj), { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
    },
  });
}

// Auto-register at module load
registerSticky();
registerText();
registerShape();
registerConnector();
registerImage();
registerStroke();
