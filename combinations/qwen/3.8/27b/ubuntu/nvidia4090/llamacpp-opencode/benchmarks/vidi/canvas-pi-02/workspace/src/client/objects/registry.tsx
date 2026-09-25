import * as React from 'react';
import * as Y from 'yjs';
import {
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import { objectBounds } from '../../shared/board-model';
import { pointInRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import type { Measurer } from './textLayout';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { SHAPE_MIN_SIZE_WORLD, STROKE_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { Endpoint } from '../../shared/objects/connector';
import { scaledPoints, strokeHitTolerance, type StrokeSnap } from '../../shared/objects/stroke';
import { StrokeObject } from './StrokeObject';

/**
 * Board object registry (story 7, sel.registry; extended in story 9).
 *
 * Each board object type registers its render component and the only
 * per-type knobs: whether it resizes, whether it keeps its proportions,
 * its minimum size, and which resize handles it shows.
 */
export type { Measurer };

export interface ObjectProps {
  /** The snapshot object this element renders (cast to the type's snapshot). */
  obj: ObjectSnapshot;
  /** The live Y.Doc for direct Y.Text/Y.Map access (editing, swatches). */
  doc: Y.Doc;
  /** The current camera zoom (font fitting, scale-unscaled chrome). */
  zoom: number;
  /** Whether this object is in the current selection. */
  selected: boolean;
  /** Whether this object is in text editing (at most one object ever is). */
  editing: boolean;
  /** persist.client_status: false while the board is locked (view-only). */
  editable: boolean;
  /** The tab's undo controller (story 8; the text editor uses it). */
  undo: UndoController;
  /** Generic object press (story 7 transform gesture; window-level). */
  onObjectPointerDown: (e: PointerEvent, id: string) => void;
  /** Tab focus selects the object (so Enter can then edit it). */
  onSelect: (id: string) => void;
  /** Double-click / Enter: start text editing. */
  onStartEdit: (id: string) => void;
  /** The editor finished (blur / Escape / Enter): editing ends, selection kept. */
  onEndEdit: () => void;
}

/** Which resize handles to show for this type. */
export type HandleMode = 'all' | 'horizontal';

export interface ObjectTypeSpec {
  /** Render component for every snapshot object of this type. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.ComponentType<any>;
  /** Whether the selection shows resize handles for objects of this type. */
  resizable: boolean;
  /** Which handles to show: 'all' (8 handles) or 'horizontal' (e/w only). */
  handles: HandleMode;
  /** Whether resizes keep the object's proportions (true for sticky). */
  aspectLocked: boolean;
  /** Smallest size the object may be resized to (world units). */
  minSize: number;
  /** Whether the object has an editable text (double-click / Enter). */
  editableText: boolean;
  /** True when the world point is inside the object's bounds (or, for line
   *  objects, within the hit tolerance of the line). `zoom` is the camera
   *  zoom (screen px per world unit); line hit tolerances are expressed in
   *  SCREEN pixels, so zoom-aware specs need it (story 11 strokes). Existing
   *  specs ignore it. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register one object type. Throws on duplicate registration (programming
 * error, caught by the registry unit tests).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`object type already registered: ${type}`);
  registry.set(type, spec);
}

/** The spec for `type`, or undefined for unknown / unregistered types. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The types this build renders (the renderer skips everything else). */
export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}

// --- The first object type: sticky -----------------------------------------

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  handles: 'all',
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

// --- The second object type: text (story 9) ---------------------------------

registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  handles: 'horizontal',
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

// --- The third object type: shape (story 10) --------------------------------

registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  handles: 'all',
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, worldPoint) => pointInRect(objectBounds(obj), worldPoint),
});

// --- The fourth object type: connector (story 10) ---------------------------

/** Connectors are rendered in a global SVG overlay, not in their own container. */
function ConnectorPlaceholder() { return null; }

registerObjectType('connector', {
  Component: ConnectorPlaceholder,
  resizable: false,
  handles: 'all',
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  hitTest: (obj, worldPoint) => {
    // Connector hit-testing uses distanceToPolyline on the resolved endpoints.
    // The resolved endpoints are computed by the parent (BoardPage) and passed
    // via the snapshot's `from` and `to` fields.
    const from = obj.from as Endpoint | undefined;
    const to = obj.to as Endpoint | undefined;
    if (!from || !to) return false;
    // For free endpoints, use the stored coordinates directly.
    // For attached endpoints, we can't resolve without the rects map, so
    // we use the fallback coordinates as an approximation.
    const fp: Point = from.kind === 'free' ? { x: from.x, y: from.y } : { ...from.fallback };
    const tp: Point = to.kind === 'free' ? { x: to.x, y: to.y } : { ...to.fallback };
    const dist = distanceToPolyline([fp, tp], worldPoint);
    return dist <= CONNECTOR_HIT_TOLERANCE_PX; // In world units; the caller divides by zoom.
  },
});

// --- The fifth object type: stroke (story 11) --------------------------------

/**
 * Stroke (freehand pen drawing). Rendered as an SVG path in a click-through
 * container; the invisible wide hit path is the only interactive part, so a
 * click inside the bbox but off the line falls through to whatever is below
 * (pen.select). Resize is aspect-locked (story 7 group resize) and keeps the
 * pen thickness constant (scaledPoints rescales the geometry only).
 */
registerObjectType('stroke', {
  Component: (props: ObjectProps) => (
    <StrokeObject
      stroke={props.obj as StrokeSnap}
      selected={props.selected}
      zoom={props.zoom}
      onObjectPointerDown={props.onObjectPointerDown}
      onSelect={props.onSelect}
    />
  ),
  resizable: true,
  handles: 'all',
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, worldPoint, zoom = 1) => {
    const s = obj as StrokeSnap;
    if (s.points === undefined || s.points.length === 0) return false;
    const pts = scaledPoints(s);
    if (pts.length === 0) return false;
    return distanceToPolyline(pts, worldPoint) <= strokeHitTolerance(s, zoom);
  },
});

/** Default world-space size for objects that do not store one (sticky). */
export const DEFAULT_OBJECT_SIZE_WORLD = STICKY_SIZE_WORLD;
