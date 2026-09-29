/**
 * Story 7: the object type registry (sel.registry / sel.all_types).
 *
 * Every board object type declares ONLY its per-type knobs here — whether it
 * can be resized, whether it keeps its proportions, its minimum size, whether
 * it has editable text, and its point hit-test. Selection, move, resize,
 * nudge and delete are generic machinery (board-model + useTransformGesture +
 * useBoardKeys) that works identically for every registered type. Stories
 * 9–12 plug new types in by calling `registerObjectType` and must not add
 * their own selection or transform code.
 */
import type React from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  allObjects,
  registerKnownObjectType,
  type ObjectSnapshot,
} from 'src/shared/board-model';
import { STICKY_MIN_SIZE_WORLD, CONNECTOR_HIT_TOLERANCE_PX, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from 'src/shared/config';
import { distanceToPolyline } from 'src/shared/geometry/polyline';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { TEXT_MIN_WIDTH_WORLD } from 'src/shared/config';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { scaledPoints, type StrokeSnap } from 'src/shared/objects/stroke';
import { IMAGE_MIN_SIZE_WORLD } from 'src/shared/config';
import { ImageObject } from '../images/ImageObject';
import type { ImageSnap } from 'src/shared/objects/image';
import { useBoardContext } from '../board/context';

/**
 * Story 10: bridges the connector's board-level extras (camera, identity,
 * onEndsChanged — carried in BoardContext, not ObjectProps) into the
 * registered component.
 */
function ConnectorObjectBridge(props: ObjectProps): React.JSX.Element {
  const { camera, identity, onEndsChanged } = useBoardContext();
  return <ConnectorObject {...props} camera={camera} identity={identity} onEndsChanged={onEndsChanged} />;
}

/** Rebuilds the full image snap from the snapshot's carried fields. */
function toImageSnap(obj: ObjectSnapshot): ImageSnap | undefined {
  if (obj.type !== 'image') return undefined;
  if (obj.width === undefined || obj.height === undefined) return undefined;
  if (obj.assetKey === undefined || typeof obj.contentType !== 'string') return undefined;
  if (obj.naturalWidth === undefined || obj.naturalHeight === undefined) return undefined;
  if (obj.status === undefined || obj.uploadStartedAt === undefined) return undefined;
  if (typeof obj.uploaderId !== 'string') return undefined;
  return {
    id: obj.id,
    type: 'image',
    x: obj.x,
    y: obj.y,
    z: obj.z,
    width: obj.width,
    height: obj.height,
    assetKey: obj.assetKey,
    contentType: obj.contentType,
    naturalWidth: obj.naturalWidth,
    naturalHeight: obj.naturalHeight,
    status: obj.status,
    uploadStartedAt: obj.uploadStartedAt,
    uploaderId: obj.uploaderId,
  };
}

/**
 * Story 12: bridges the image's board-level extras (the stale clock, this
 * tab's upload progress, the retry/remove actions — carried in BoardContext)
 * into the registered component.
 */
function ImageObjectBridge(props: ObjectProps): React.JSX.Element | null {
  const { identity, now, imageProgress, canRetryImage, onImageRetry, onImageRemove } = useBoardContext();
  const snap = toImageSnap(props.obj);
  if (!snap) return null;
  return (
    <ImageObject
      image={snap}
      isUploader={snap.uploaderId === identity}
      progress={imageProgress.get(snap.id)}
      canRetry={canRetryImage(snap.id)}
      now={now}
      onRetry={() => onImageRetry(snap.id)}
      onRemove={() => onImageRemove(snap.id)}
      onPointerDown={(e) => props.onPointerDown(e, snap.id)}
    />
  );
}

/**
 * Common props handed to every registered object component. `onPointerDown`
 * delegates press handling to the generic transform gesture (group move /
 * single-object drag); future types do the same and gain selection, moving
 * and resizing for free.
 */
export interface ObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False when the board is `load_failed`: selectable, never mutable. */
  editable: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  /** Story 8: the board's per-user undo controller (text-editor boundaries). */
  undo: UndoController;
}

export interface ObjectTypeSpec {
  Component: React.ComponentType<ObjectProps>;
  /** May the selection's bounding box show resize handles for this type? */
  resizable: boolean;
  /** While selected, keep the bounding box's width-to-height ratio. */
  aspectLocked: boolean;
  /** Smallest allowed size in board units (feeds clampScale). */
  minSize: number;
  /** May the object's text be edited (Enter / double-click)? */
  editableText: boolean;
  /**
   * Story 9: which resize handles the selection overlay shows for a selection
   * made up ONLY of this type — 'all' (the default: the 8 handles) or
   * 'horizontal' (only e/w, for text objects whose width is the editable
   * dimension; text.height).
   */
  handles?: 'all' | 'horizontal';
  /**
   * Point-in-object hit test (world units). Story 10: an optional `zoom` —
   * screen-constant tolerances (the connector's CONNECTOR_HIT_TOLERANCE_PX)
   * convert to world units with it. Default 1 keeps existing types exact.
   */
  hitTest: (obj: ObjectSnapshot, worldPoint: { x: number; y: number }, zoom?: number) => boolean;
}

/**
 * Story 10: the topmost registered object whose hit test contains a world
 * point (highest z first). Used for the empty-click selection path and the
 * connector tool's attach-target lookup.
 */
export function hitObjectAt(
  doc: Y.Doc,
  worldPoint: { x: number; y: number },
  zoom = 1,
): string | null {
  const objects = allObjects(doc);
  for (let i = objects.length - 1; i >= 0; i--) {
    const spec = specs.get(objects[i].type);
    if (!spec) continue;
    if (spec.hitTest(objects[i], worldPoint, zoom)) return objects[i].id;
  }
  return null;
}

/**
 * The topmost CONNECTOR hit by a world point (connector.select, story 10).
 * Empty-space board clicks are routed through this: in real browsers a click
 * on a shape/sticky hits that object's own DOM, but a click within a
 * connector's screen tolerance can land on the board background (the wide
 * SVG hit stroke covers the real-browser case; jsdom cannot target SVG
 * strokes, so the board hit-tests in world units).
 */
export function hitConnectorAt(
  doc: Y.Doc,
  worldPoint: { x: number; y: number },
  zoom = 1,
): string | null {
  const objects = allObjects(doc);
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].type !== 'connector') continue;
    const spec = specs.get('connector');
    if (spec && spec.hitTest(objects[i], worldPoint, zoom)) return objects[i].id;
  }
  return null;
}

const specs = new Map<string, ObjectTypeSpec>();

/**
 * Registers an object type. Throws on duplicate registration — a programming
 * error that must fail loudly at module load, not silently in the UI.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`Object type '${type}' is already registered`);
  }
  specs.set(type, spec);
  // board-model must be able to select/mutate objects of this type
  // (allObjectIds, select-all, group ops).
  registerKnownObjectType(type);
}

/** The spec for a type, or undefined when the type is not registered. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Sticky-note hit test: the point lies within the note's bounds. */
function stickyHitTest(obj: ObjectSnapshot, p: { x: number; y: number }): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

// The one type this story ships: sticky notes (resizable, always square,
// never smaller than STICKY_MIN_SIZE_WORLD, editable text).
registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: stickyHitTest,
});

// Story 9: free text objects — resizable by width only (side handles), never
// aspect-locked, never smaller than TEXT_MIN_WIDTH_WORLD, editable text.
registerObjectType('text', {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: stickyHitTest,
});

// Story 10: shapes — resizable, never aspect-locked (a shape's width/height
// are independent), a generous min size (they are clicked into being),
// editable label (the story 2 editor, SHAPE_LABEL_MAX_CHARS).
registerObjectType('shape', {
  Component: ShapeObject,
  resizable: true,
  aspectLocked: false,
  minSize: 20,
  editableText: true,
  hitTest: stickyHitTest,
});

// Story 10: connectors (arrows) — not resizable (endpoints are moved via the
// end handles, not scale handles), hit = within CONNECTOR_HIT_TOLERANCE_PX
// (screen px) of the resolved line (polyline distance in world units).
function connectorHitTest(obj: ObjectSnapshot, p: { x: number; y: number }, zoom = 1): boolean {
  const ends = obj.ends;
  if (!ends) return false;
  const tolerance = CONNECTOR_HIT_TOLERANCE_PX / Math.max(zoom, 0.01);
  return distanceToPolyline([ends.from, ends.to], p) <= tolerance;
}

registerObjectType('connector', {
  Component: ConnectorObjectBridge,
  resizable: false,
  aspectLocked: false,
  minSize: 1,
  editableText: false,
  hitTest: connectorHitTest,
});

// Story 11: strokes — resizable with aspect locked (the line scales, the
// thickness does not), never smaller than STROKE_MIN_SIZE_WORLD, no editable
// text. Hit = within max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom) of the
// (scaled) line (pen.select).
function strokeHitTest(obj: ObjectSnapshot, p: { x: number; y: number }, zoom = 1): boolean {
  const snap = toStrokeSnap(obj);
  if (!snap) return false;
  const tolerance = Math.max(
    PEN_THICKNESS_WORLD[snap.thickness] / 2,
    STROKE_HIT_TOLERANCE_PX / Math.max(zoom, 0.01),
  );
  return distanceToPolyline(scaledPoints(snap), p) <= tolerance;
}

/** Rebuilds the full stroke snap from the snapshot's carried geometry. */
function toStrokeSnap(obj: ObjectSnapshot): StrokeSnap | undefined {
  if (obj.type !== 'stroke') return undefined;
  if (!obj.points || obj.baseWidth === undefined || obj.baseHeight === undefined) return undefined;
  if (obj.color === undefined || obj.thickness === undefined) return undefined;
  return {
    id: obj.id,
    type: 'stroke',
    x: obj.x,
    y: obj.y,
    z: obj.z,
    width: obj.width,
    height: obj.height,
    points: obj.points,
    baseWidth: obj.baseWidth,
    baseHeight: obj.baseHeight,
    color: obj.color as StrokeSnap['color'],
    thickness: obj.thickness as StrokeSnap['thickness'],
  };
}

registerObjectType('stroke', {
  Component: StrokeObject,
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: strokeHitTest,
});

// Story 12: images — resizable with aspect locked (image.aspect_resize),
// never smaller than IMAGE_MIN_SIZE_WORLD on either side, no editable text.
registerObjectType('image', {
  Component: ImageObjectBridge,
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: stickyHitTest,
});

/**
 * The topmost STROKE hit by a world point (pen.select, story 11).
 * Empty-space board clicks are routed through this, like connectors: a click
 * within the line's screen tolerance that lands on the board background
 * (the wide SVG hit path covers the real-browser case; jsdom cannot target
 * SVG strokes, so the board hit-tests in world units).
 */
export function hitStrokeAt(
  doc: Y.Doc,
  worldPoint: { x: number; y: number },
  zoom = 1,
): string | null {
  const objects = allObjects(doc);
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].type !== 'stroke') continue;
    const spec = specs.get('stroke');
    if (spec && spec.hitTest(objects[i], worldPoint, zoom)) return objects[i].id;
  }
  return null;
}
