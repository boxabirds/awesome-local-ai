// Object type registry: maps type strings to their rendering component
// and declarative interaction properties.
//
// The only per-type knobs are: whether it can be resized, which handles it
// shows, whether it keeps its proportions, its minimum size, whether it has
// editable text, and how to hit-test a world point. Selection, move, resize and
// delete stay generic.

import type * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import {
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { connectorHitTest } from '../../shared/objects/connector';

/** Props that every object-type component receives. */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: import('yjs').Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Which resize handles a type shows around its part of the selection bounds. */
export type HandleSet = 'all' | 'horizontal';

/** Declarative per-type specification for the generic machinery. */
export interface ObjectTypeSpec {
  /** React component that renders this object type. */
  Component: React.ComponentType<ObjectProps>;
  /** Whether the type can be resized by handle. */
  resizable: boolean;
  /**
   * Which handles to draw. 'horizontal' is a type whose height somebody else
   * decides — a text object's is the number of lines its text needs, so a
   * bottom handle would be dragged to nothing — and defaults to 'all'.
   */
  handles?: HandleSet;
  /** Whether resizing keeps the original aspect ratio. */
  aspectLocked: boolean;
  /** Minimum width/height in world units after resize. */
  minSize: number;
  /** Whether double-click opens a text editor. */
  editableText: boolean;
  /**
   * Hit-test: is `worldPoint` within this object's bounds? `zoom` is the zoom
   * the point was taken at, for a type whose tolerance is stated in screen
   * pixels — an arrow is as easy to click at 10 % as at 400 %. Types that only
   * look at a box ignore it.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws if the type name is already registered
 * (a duplicate registration is a programming error).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  registry.set(type, spec);
}

/**
 * Get the spec for a registered type, or undefined for unknown types.
 */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Is `worldPoint` inside the object's stored box? Every type does it this way. */
function inBounds(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const bounds: Rect = objectBounds(obj);
  return (
    worldPoint.x >= bounds.x &&
    worldPoint.x <= bounds.x + bounds.width &&
    worldPoint.y >= bounds.y &&
    worldPoint.y <= bounds.y + bounds.height
  );
}

/** The handles a type is drawn with, defaulting to all eight. */
export function handlesOf(type: string | undefined): HandleSet {
  const spec = type === undefined ? undefined : registry.get(type);
  return spec?.handles ?? 'all';
}

// --- Register sticky notes ---------------------------------------------------

// Lazy import to avoid circular dependency issues at module load time.
// The StickyNote component is loaded separately; here we provide a placeholder
// component that the real module replaces.

function StickyNotePlaceholder(): React.ReactElement {
  return <div data-sticky-placeholder={true} /> as React.ReactElement;
}

registerObjectType('sticky', {
  Component: StickyNotePlaceholder,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: inBounds,
});

// --- Register free text objects ---------------------------------------------

function TextObjectPlaceholder(): React.ReactElement {
  return <div data-text-placeholder={true} /> as React.ReactElement;
}

registerObjectType('text', {
  Component: TextObjectPlaceholder,
  resizable: true,
  // Height is the text's business: the box is only ever widened or narrowed.
  handles: 'horizontal',
  // A text object has no square to keep, and its narrowest box is the width a
  // single word can leave it with.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  hitTest: inBounds,
});

// --- Register shapes (story 10) ---------------------------------------------

function ShapePlaceholder(): React.ReactElement {
  return <div data-shape-placeholder={true} /> as React.ReactElement;
}

registerObjectType('shape', {
  Component: ShapePlaceholder,
  resizable: true,
  // A shape keeps no proportion: a rectangle drawn 40 wide and 400 tall is the
  // rectangle somebody drew, and the diamond and the ellipse stretch with it.
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: inBounds,
});

// --- Register connectors (story 10) ------------------------------------------

function ConnectorPlaceholder(): React.ReactElement {
  return <div data-connector-placeholder={true} /> as React.ReactElement;
}

registerObjectType('connector', {
  Component: ConnectorPlaceholder,
  // An arrow has no box to drag: it is stretched by moving one of its ends, and
  // the overlay draws handles for those instead of the eight corner ones.
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  // A line is thin: the click is measured against it in screen pixels, which is
  // the only way it stays as easy to catch at 10 % as at 400 %.
  hitTest: (obj, worldPoint, zoom) =>
    obj.type === 'connector' && connectorHitTest(obj, worldPoint, zoom ?? 1),
});
