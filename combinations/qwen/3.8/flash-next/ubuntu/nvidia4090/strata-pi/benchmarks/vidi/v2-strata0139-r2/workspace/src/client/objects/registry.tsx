import type { ComponentType, HTMLAttributes } from "react";
import type * as Y from "yjs";
import type { ObjectSnapshot } from "../../shared/board-model";
import { objectBounds } from "../../shared/board-model";
import { rectContains, type Point } from "../../shared/geometry";
import { STICKY_MIN_SIZE_WORLD } from "../../shared/config";
import { StickyNote } from "./StickyNote";
import { TextObject } from "./TextObject";
import { TEXT_MIN_WIDTH_WORLD } from "../../shared/config";
import { setTextWidthFixed } from "../../shared/objects/text";
import { CONNECTOR_HIT_TOLERANCE_PX, SHAPE_MIN_SIZE_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from "../../shared/config";
import { ShapeObject } from "./ShapeObject";
import { ConnectorObject } from "./ConnectorObject";
import { StrokeObject } from "./StrokeObject";
import { connectorLine, type ConnectorSnap } from "../../shared/objects/connector";
import { scaledPoints, strokeThicknessWorld, type StrokeSnap } from "../../shared/objects/stroke";
import { distanceToPolyline } from "../../shared/geometry/connector-geometry";
import type { PointerLike } from "../board/useTransformGesture";

/**
 * The object type registry (`sel.all_types`).
 *
 * One place says what a kind of board object can do. A type declares **only**:
 * how to render itself, whether it can be resized, whether it keeps its
 * proportions, its minimum size, whether it has editable text, and how to tell
 * whether a point is on it. Selection, moving, resizing, nudging and deleting
 * are generic and are never re-implemented per type — stories 9-12 add a
 * `registerObjectType` call and nothing else.
 */

export interface ObjectProps {
  /** The object as the document currently has it. */
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Board zoom: gestures are in screen pixels and are divided by it. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while a move or resize gesture is running on this object. */
  dragging: boolean;
  /**
   * The generic transform gesture: an object's own pointerdown hands over here,
   * which is what gives every type the same select / select-many / move
   * behaviour.
   */
  onObjectPointerDown(event: PointerLike, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: "selected" | "unselected"): void;
  /** Extra attributes the board renderer wants on the object's root element. */
  rootProps?: HTMLAttributes<HTMLDivElement>;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False for an object that always keeps the size it was created with. */
  resizable: boolean;
  /** True for an object whose width-to-height ratio must not change. */
  aspectLocked: boolean;
  /** Smallest side this type may be resized to, in board units. */
  minSize: number;
  /** True when the object holds text a person can type into. */
  editableText: boolean;
  /**
   * Which selection handles this type takes (story 9): `all` (the default) or
   * `horizontal`, for an object whose height is derived from its content and
   * must not be dragged.
   */
  handles?: "all" | "horizontal";
  /**
   * How a horizontal handle drag writes this type. Only used for a selection
   * whose types are all `handles: 'horizontal'`; absent means the generic box
   * resize. A text object needs it because fixing its width is part of its
   * schema and its height is measured, not dragged.
   */
  resizeWidth?(doc: Y.Doc, id: string, width: number): boolean;
  /** Is `worldPoint` on this object? (Board coordinates.)
   *
   * `zoom` (screen pixels per board unit) is given so a type whose hit shape is a
   * *line* can keep its target the same number of screen pixels at any zoom
   * (`pen.select`); a type hit by its box ignores it.
   */
  hitTest(object: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Registers a type. Registering the same type twice is a programming error and
 * throws at import time, where it is actually visible, rather than silently
 * replacing the first spec.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("an object type needs a name");
  }
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
}

/** The spec for a type, or `undefined` — which means the board cannot select,
 * resize or render it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Every registered type name (used by the board renderer and by tests). */
export function registeredObjectTypes(): string[] {
  return Array.from(registry.keys());
}

/** A point inside the object's box, which is every board object's hit shape today. */
function hitTestBounds(object: ObjectSnapshot, worldPoint: Point): boolean {
  if (!worldPoint) return false;
  const box = objectBounds(object);
  return rectContains(box, { x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
}

registerObjectType("sticky", {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: hitTestBounds,
});

// Story 9: text is a type added purely through this registry — nothing else in
// the board knows what a text object is.
registerObjectType("text", {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: "horizontal",
  resizeWidth: setTextWidthFixed,
  hitTest: hitTestBounds,
});

// Story 10: a shape is an ordinary resizable rectangle with editable text, so
// the three kinds need nothing beyond this entry — the kind only decides which
// figure is drawn inside the box the selection and the handles already use.
registerObjectType("shape", {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: hitTestBounds,
});

// A connector has no box of its own to resize and no text to type: its rectangle
// is derived from its ends, and it is hit by nearness to the line rather than by
// being inside that derived box. `CONNECTOR_HIT_TOLERANCE_WORLD` is the tolerance
// at zoom 1; the board scales it by the zoom where it actually answers a click.
registerObjectType("connector", {
  Component: ConnectorObject,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest(object, worldPoint) {
    if (!worldPoint) return false;
    // Against the ends the connector itself stores: the board answers a click on
    // an arrow with the live positions of the objects it is attached to, and this
    // is the version that works from the object alone.
    const line = connectorLine(object as ConnectorSnap, []);
    return (
      distanceToPolyline([line.from, line.to], worldPoint, CONNECTOR_HIT_TOLERANCE_PX) <= CONNECTOR_HIT_TOLERANCE_PX
    );
  },
});

// Story 11: a stroke is an ordinary resizable object — its own box, the generic
// handles, the generic move — with two differences. Its hit shape is its **line**,
// not its box, because the box of a diagonal scribble is mostly empty space; and
// its proportions are locked, because stretching a drawing out of shape is not what
// resizing a drawing means (`pen.resize`).
registerObjectType("stroke", {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest(object, worldPoint, zoom) {
    if (!worldPoint) return false;
    const stroke = object as StrokeSnap;
    const scale = Number.isFinite(zoom) && zoom !== undefined && zoom > 0 ? zoom : 1;
    // Half the line's own thickness, but never a target narrower than the click
    // tolerance in screen pixels: the thicker of the two, in board units.
    const tolerance = Math.max(strokeThicknessWorld(stroke) / 2, STROKE_HIT_TOLERANCE_PX / scale);
    return distanceToPolyline(scaledPoints(stroke), worldPoint, tolerance) <= tolerance;
  },
});
