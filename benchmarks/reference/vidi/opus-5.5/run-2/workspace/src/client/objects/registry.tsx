/**
 * Object type registry (anchor: sel.registry). Each board object type declares only how it
 * renders and its resize rules; selection, move, resize, nudge and delete stay generic
 * (sel.all_types). Stories 9–12 call `registerObjectType` and add no selection or
 * transform code of their own.
 */
import { memo, useContext, type ComponentType, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  declareObjectType,
  isStickySnapshot,
  LOCAL_ORIGIN,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { isTextSnapshot, setTextWidthFixed } from '../../shared/objects/text';
import { isShapeSnap } from '../../shared/objects/shape';
import { isStrokeSnap, scaledPoints, STROKE_TYPE } from '../../shared/objects/stroke';
import { IMAGE_TYPE, isImageSnap } from '../../shared/objects/image';
import {
  CONNECTOR_TYPE,
  isConnectorSnap,
  moveConnector,
  setConnectorEndpoint,
  type Endpoint,
} from '../../shared/objects/connector';
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
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { BoardObjectsContext } from './BoardObjectsContext';
import { ConnectorObject } from './ConnectorObject';
import { ImageContext, ImageObject } from './ImageObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';
import { defaultMeasurer } from './textLayout';
import { syncTextBox } from './useTextBoxSync';

/** Props every registered object component receives. */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** True while this object is part of a selection being moved or resized. */
  transforming: boolean;
  /** False while the board cannot be edited (story 4 load failure). */
  editable: boolean;
  /** Must be called from the object's pointerdown: starts select / move (useTransformGesture). */
  onPointerDown(e: PointerEvent<HTMLElement>, id: string): void;
  /** Keyboard focus selects the object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  resizable: boolean;
  /** Keeps the width-to-height ratio; any such object locks the whole selection's ratio. */
  aspectLocked: boolean;
  /** Smallest width and height, in world units. */
  minSize: number;
  editableText: boolean;
  /** `zoom` lets thin objects (story 10 arrows) use a tolerance in screen pixels. Default 1. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /** Story 10: false hides the selection outline (arrows show their own end handles). Default true. */
  outline?: boolean;
  /**
   * Story 10: writes a move by `d` from the object's state `start` instead of the generic
   * top-left write (arrows move their free ends).
   */
  applyMove?(doc: Y.Doc, start: ObjectSnapshot, d: Point): void;
  /**
   * Story 9: 'horizontal' shows only the left and right handles when every selected object
   * is of such a type (height follows content). Default 'all'.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Which axes of the object scale with a group resize (and so take part in its min/max
   * limits). Default both.
   */
  scalesWith?(obj: ObjectSnapshot, mode: ResizeMode): { x: boolean; y: boolean };
  /**
   * Writes the object's part of a resize instead of the generic rect write: `to` is the
   * object's proportionally scaled rect, `from` its rect when the gesture started.
   */
  applyResize?(doc: Y.Doc, obj: ObjectSnapshot, to: Rect, from: Rect, mode: ResizeMode, start: ObjectSnapshot): void;
}

/** 'horizontal': a side handle of a selection of horizontal-only types; 'group': any other resize. */
export type ResizeMode = 'horizontal' | 'group';

const registry = new Map<string, ObjectTypeSpec>();

/** Throws on duplicate registration (a programming error, caught at module load). */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) throw new Error(`Object type "${type}" is already registered`);
  registry.set(type, spec);
  declareObjectType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** True when the point lies within the object's bounds (edges included). */
export function boundsHitTest(obj: ObjectSnapshot, p: Point): boolean {
  return rectContains(objectBounds(obj), { x: p.x, y: p.y, width: 0, height: 0 });
}

/**
 * Moves each object by `d` from its state in `starts` in one transaction: the generic
 * top-left write, or the type's own `applyMove` (story 7 move and nudge).
 */
export function moveSnapshots(doc: Y.Doc, starts: readonly ObjectSnapshot[], d: Point): void {
  const positions = new Map<string, Point>();
  const custom: (() => void)[] = [];
  for (const o of starts) {
    const apply = getObjectType(o.type)?.applyMove;
    if (apply !== undefined) custom.push(() => apply(doc, o, d));
    else positions.set(o.id, { x: o.x + d.x, y: o.y + d.y });
  }
  if (custom.length === 0) {
    moveObjects(doc, positions);
    return;
  }
  doc.transact(() => {
    moveObjects(doc, positions);
    custom.forEach((fn) => fn());
  }, LOCAL_ORIGIN);
}

/**
 * The topmost object an arrow end can attach to at `p` (every known type except arrows),
 * skipping `excludeId`. Story 10 connector tool and end handles.
 */
export function connectableAt(
  objects: readonly ObjectSnapshot[],
  p: Point,
  zoom: number,
  excludeId?: string,
): ObjectSnapshot | undefined {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const o = objects[i]!;
    if (o.type === CONNECTOR_TYPE || o.id === excludeId) continue;
    const spec = getObjectType(o.type);
    if (spec !== undefined && spec.hitTest(o, p, zoom)) return o;
  }
  return undefined;
}

const StickyObject = memo(function StickyObject(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isStickySnapshot(object) ? <StickyNote note={object} {...rest} /> : null;
});

registerObjectType('sticky', {
  Component: StickyObject,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

const TextObjectEntry = memo(function TextObjectEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isTextSnapshot(object) ? <TextObject note={object} {...rest} /> : null;
});

/** Width changes smaller than this (world units) are rounding noise, not a resize. */
const TEXT_RESIZE_EPSILON = 1e-6;

registerObjectType('text', {
  Component: TextObjectEntry,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: boundsHitTest,
  // Font size never changes by handles: height follows the content; auto width follows the text.
  scalesWith: (obj, mode) => ({
    x: mode === 'horizontal' || (isTextSnapshot(obj) && obj.widthMode === 'fixed'),
    y: false,
  }),
  applyResize(doc, obj, to, from, mode) {
    if (!isTextSnapshot(obj)) return;
    const widthChanged = Math.abs(to.width - from.width) > TEXT_RESIZE_EPSILON;
    moveObjects(doc, new Map([[obj.id, { x: to.x, y: mode === 'horizontal' ? from.y : to.y }]]));
    if (widthChanged && (mode === 'horizontal' || obj.widthMode === 'fixed')) setTextWidthFixed(doc, obj.id, to.width);
    syncTextBox(doc, obj.id, defaultMeasurer());
  },
});

const ShapeEntry = memo(function ShapeEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isShapeSnap(object) ? <ShapeObject shape={object} {...rest} /> : null;
});

registerObjectType('shape', {
  Component: ShapeEntry,
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsHitTest,
});

function ConnectorEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  // Only arrows read the rects of every object: they redraw when anything they attach to moves.
  const { rects } = useContext(BoardObjectsContext);
  return isConnectorSnap(object) ? <ConnectorObject connector={object} rects={rects} {...rest} /> : null;
}

/** Scales a free end from the arrow's start box into its resized box (group resize). */
function scaleFree(e: Endpoint, from: Rect, to: Rect): Endpoint | null {
  if (e.kind !== 'free') return null;
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return { kind: 'free', x: to.x + (e.x - from.x) * sx, y: to.y + (e.y - from.y) * sy };
}

registerObjectType(CONNECTOR_TYPE, {
  Component: ConnectorEntry,
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  outline: false,
  // connector.select: within CONNECTOR_HIT_TOLERANCE_PX screen pixels of the line.
  hitTest: (obj, p, zoom = 1) =>
    isConnectorSnap(obj) && distanceToPolyline([obj.fromPoint, obj.toPoint], p) <= CONNECTOR_HIT_TOLERANCE_PX / zoom,
  applyMove(doc, start, d) {
    if (isConnectorSnap(start)) moveConnector(doc, start, d);
  },
  applyResize(doc, _obj, to, from, _mode, start) {
    if (!isConnectorSnap(start)) return;
    for (const end of ['from', 'to'] as const) {
      const next = scaleFree(start[end], from, to);
      if (next !== null) setConnectorEndpoint(doc, start.id, end, next);
    }
  },
});

const StrokeEntry = memo(function StrokeEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  return isStrokeSnap(object) ? <StrokeObject stroke={object} {...rest} /> : null;
});

registerObjectType(STROKE_TYPE, {
  Component: StrokeEntry,
  resizable: true,
  // pen.resize: the line scales in proportion (scaledPoints); the thickness never scales.
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  // pen.select: within half the thickness or STROKE_HIT_TOLERANCE_PX screen pixels of the line.
  hitTest: (obj, p, zoom = 1) =>
    isStrokeSnap(obj) &&
    distanceToPolyline(scaledPoints(obj), p) <=
      Math.max(PEN_THICKNESS_WORLD[obj.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom),
});

function ImageEntry(props: ObjectProps): React.JSX.Element | null {
  const { object, ...rest } = props;
  // Only images read the upload state (progress, retry, clock) of the board.
  const ctx = useContext(ImageContext);
  if (!isImageSnap(object)) return null;
  return (
    <ImageObject
      {...rest}
      image={object}
      isUploader={ctx.identityId !== '' && object.uploaderId === ctx.identityId}
      progress={ctx.progress.get(object.id)}
      canRetry={ctx.canRetry(object.id)}
      now={ctx.now}
      onRetry={() => ctx.retry(object.id)}
      onRemove={() => ctx.remove(object.id)}
    />
  );
}

registerObjectType(IMAGE_TYPE, {
  Component: ImageEntry,
  resizable: true,
  // image.aspect_resize: proportional, never smaller than IMAGE_MIN_SIZE_WORLD on either side.
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: boundsHitTest,
});
