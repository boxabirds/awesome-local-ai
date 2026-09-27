// Client object registry (see spec: sel.objects).
//
// Every object type registers here exactly once at module load. The board
// renderer maps a snapshot through getObjectType and skips objects whose
// type is unregistered (forward compatibility, stories 9-12); the
// selection/transform layer reads the type's resize rules from here.
//
// The board-model module keeps the set of *known type names* (which objects
// the doc model can snapshot and which ids are selectable); this registry
// owns the React components and behaviour.

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import {
  objectBounds,
  registerObjectTypeName,
  type ObjectSnapshot,
} from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import { pointInRect, type Point, type Rect } from '../../shared/geometry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  CONNECTOR_MIN_LENGTH_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  PEN_THICKNESS_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import type { Endpoint } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';

import { ConnectorObject } from './ConnectorObject';
import { ImageObject } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';
import type { Camera } from '../canvas/camera';

/**
 * Props every object component receives. The object component stays
 * presentational: pointer handling delegates to the shared transform gesture
 * (drag/resize), editing to the selection state.
 */
export interface ObjectProps {
  /** This object's snapshot (re-rendered on every doc change). */
  obj: ObjectSnapshot;
  /** Every object's snapshot (cross-object behaviour, e.g. connectors). */
  snapshot?: readonly ObjectSnapshot[];
  /** The live Y.Doc (for Y.Text editing). */
  doc: Y.Doc;
  /** Current camera (screen ↔ world conversion). */
  camera?: Camera | null;
  /** Current camera zoom, for screen-space sizing. */
  zoom: number;
  /** Live rects of every attachable object (connector endpoint resolution). */
  rects?: ReadonlyMap<string, Rect>;
  /** Selected (part of the current selection). */
  selected: boolean;
  /** In text-edit mode (its editor is mounted). */
  editing: boolean;
  /** Moving with the current gesture. */
  dragging: boolean;
  /** The current client may edit the board. */
  editable: boolean;
  /** Pointer-down on the object: select + start a move gesture. */
  onObjectPointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Select this object without starting a gesture (keyboard focus). */
  onFocusSelect(id: string): void;
  /** Enter text-edit mode for this object (double-click / Enter). */
  onStartEdit(id: string): void;
  /** Leave text-edit mode: 'selected' keeps the note selected, 'unselected' deselects. */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** This tab's undo controller (story 8: editor boundaries + Ctrl/Cmd+Z). */
  undo?: UndoController | null;
  /** Story 12: per-image render context (progress, retry, identity, clock). */
  imageContext?: ImageRenderContext;
}

/** Story 12: what the image component needs beyond the plain snapshot. */
export interface ImageRenderContext {
  /** Live upload fraction 0..1 (uploader only). */
  progress?: number;
  /** True while the File is kept in memory (Retry is offered). */
  canRetry: boolean;
  /** True for the client that started the upload. */
  isUploader: boolean;
  /** Clock for the unfinished derivation. */
  now: number;
  onRetry(): void;
  onRemove(): void;
}

/** Behaviour and rendering of one object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** May be resized via the selection overlay handles. */
  resizable: boolean;
  /** Always keeps its width:height ratio (sticky notes are square). */
  aspectLocked: boolean;
  /** Smallest size in board units (resize floor). */
  minSize: number;
  /** Text is editable (double-click / Enter). */
  editableText: boolean;
  /** Which resize handles the selection overlay shows when this type is the
   *  only kind selected: 'all' (default) or 'horizontal' (e/w only, text). */
  handles?: 'all' | 'horizontal';
  /** Hit test in world units (future types may have irregular bounds).
   *  `zoom` (default 1) lets screen-px tolerances be converted to world. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();


/** Register a type; throws on a duplicate (a type registers exactly once). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registry.set(type, spec);
  registerObjectTypeName(type);
}

/** The spec for `type`, if registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Sticky note (story 2, extended by story 7: resizable, square, min 50). */
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) => pointInRect(objectBounds(obj), point),
});

/** Text (story 9): e/w handles only, min width, height follows content. */
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (obj, point) => pointInRect(objectBounds(obj), point),
});

/** Shape (story 10): free resize, no aspect lock, editable label. */
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (obj, point) => pointInRect(objectBounds(obj), point),
});

/** The stored anchor point of an endpoint (free point or attached fallback). */
function endpointPoint(e: Endpoint | undefined): Point | null {
  if (e === undefined || e === null) return null;
  return e.kind === 'free' ? { x: e.x, y: e.y } : e.fallback;
}

/** Connector (story 10): not resizable; a wide invisible line hit-tests it
 *  (distanceToPolyline <= CONNECTOR_HIT_TOLERANCE_PX / zoom, in the DOM); the
 *  bbox hitTest below is a coarse fallback. */
registerObjectType('connector', {
  Component: (props: ObjectProps) => (
    <ConnectorObject
      connector={props.obj as import('../../shared/objects/connector').ConnectorSnap}
      snapshot={props.snapshot ?? []}
      rects={props.rects ?? new Map<string, Rect>()}
      doc={props.doc}
      camera={props.camera ?? null}
      zoom={props.zoom}
      selected={props.selected}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      onFocusSelect={props.onFocusSelect}
      undo={props.undo}
    />
  ),
  resizable: false,
  aspectLocked: false,
  minSize: CONNECTOR_MIN_LENGTH_WORLD,
  editableText: false,
  hitTest: (obj, point) => {
    const a = endpointPoint(obj.from as Endpoint | undefined);
    const b = endpointPoint(obj.to as Endpoint | undefined);
    if (a === null || b === null) return false;
    const box = {
      x: Math.min(a.x, b.x) - CONNECTOR_HIT_TOLERANCE_PX,
      y: Math.min(a.y, b.y) - CONNECTOR_HIT_TOLERANCE_PX,
      width: Math.abs(a.x - b.x) + 2 * CONNECTOR_HIT_TOLERANCE_PX,
      height: Math.abs(a.y - b.y) + 2 * CONNECTOR_HIT_TOLERANCE_PX,
    };
    return pointInRect(box, point);
  },
});

/** Image (story 12): aspect-locked proportional resize with a floor
 *  (image.aspect_resize); states render from doc fields + imageContext. */
registerObjectType('image', {
  Component: ImageObject,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, point) => pointInRect(objectBounds(obj), point),
});

/** Stroke (story 11): proportional resize only (aspect-locked, min size),
 *  no text; a click within max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)
 *  of the line selects it (pen.select). */
registerObjectType('stroke', {
  Component: (props: ObjectProps) => (
    <StrokeObject
      stroke={props.obj as StrokeSnap}
      zoom={props.zoom}
      selected={props.selected}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      onFocusSelect={props.onFocusSelect}
    />
  ),
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (obj, point, zoom = 1) => {
    const stroke = obj as StrokeSnap;
    if (stroke.points === undefined) return false;
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[stroke.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    return distanceToPolyline(scaledPoints(stroke), point) <= tolerance;
  },
});
