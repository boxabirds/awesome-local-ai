// The object type registry (`sel.registry`).
//
// Everything story 7 does — drawing, selecting, marquee-selecting, moving,
// resizing, deleting — is written once against this table. A type declares only
// four things: how it is drawn, whether it can be resized, whether a resize keeps
// its proportions, and how small it may be made. Stories 9–12 add shapes,
// connectors, frames and images here and deliberately add no selection or
// transform code of their own: an object type that wants group behaviour has to
// register, and gets it for free (sel.all_types).
//
// Registering a client type also registers it in the shared model
// (`registerObjectTypeModel`), because a document can hold objects a screen cannot
// draw, and those must stay invisible rather than be moved or resized blindly
// (TC-08, TC-12).
import type { ComponentType, ReactNode } from 'react';
import { useContext } from 'react';
import type * as Y from 'yjs';
import type { BoardObject, ObjectSnapshot } from '../../shared/board-model';
import {
  isStickySnapshot,
  moveObjects,
  objectBounds,
  registerObjectTypeModel,
} from '../../shared/board-model';
import type { Handle, Point } from '../../shared/geometry';
import { rectContains } from '../../shared/geometry';
import {
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  IMAGE_MIN_SIZE_WORLD,
} from '../../shared/config';
import {
  readTextSnapshot,
  setTextBox,
  setTextWidthFixed,
} from '../../shared/objects/text';
import type { UndoController } from '../board/undo';
import { isConnectorSnapshot, hitTestConnector, type ConnectorSnapshot } from '../../shared/objects/connector';
import { isShapeSnapshot, type ShapeSnapshot } from '../../shared/objects/shape';
import {
  hitTestStroke,
  isStrokeSnapshot,
  type StrokeSnapshot,
} from '../../shared/objects/stroke';
import { objectRects } from '../../shared/board-model';
import { ConnectorObject } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StickyNote } from './StickyNote';
import { StrokeObject } from './StrokeObject';
import { TextObject } from './TextObject';
import { boardMeasurer } from './textLayout';
import { measureTextBox } from './useTextBoxSync';
import { ImageObject } from './ImageObject';
import { ImageObjectContext } from './imageContext';
import { isImageSnapshot } from '../../shared/objects/image';

/** What the board hands every object component, whatever kind it is. */
export interface ObjectProps {
  object: BoardObject;
  doc: Y.Doc;
  /** Camera zoom: a gesture divides screen deltas by it to stay screen-relative. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False when the board could not be loaded: the board is read-only then. */
  editable: boolean;
  /**
   * A press on this object. The generic transform gesture decides what follows:
   * select if unselected, then move or resize (sel.transform). Object components
   * hold no pointer logic of their own.
   */
  onObjectPointerDown(event: PointerEvent, id: string): void;
  /** Only called for a type with `editableText`. */
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * This tab's own undo history (story 8). A text-editing object opens and closes a
   * step with it and routes Ctrl/Cmd+Z through it, so the browser's own textarea
   * undo never diverges from the shared text. Absent means the board is not undoable.
   */
  undo?: UndoController;
}

/**
 * The set of drag handles a kind of object has. `all` is story 7's eight handles
 * (a sticky note, whose height is its own). `horizontal` is for a type whose height
 * follows its content — a piece of text — which is dragged by west/east only.
 */
export type ObjectHandles = 'all' | 'horizontal';

/** What a type that measures its own box is told when a handle gesture happens. */
export interface ResizeNotice {
  /** The board's document, so the type can write its own box into it. */
  doc: Y.Doc;
  /** The single object this gesture is about. */
  id: string;
  /** Which handle is being dragged (`'e'` or `'w'` for a horizontal type). */
  handle: Handle;
  /** Where the pointer went down, in board units: the corner that did not move. */
  anchor: Point;
  /** The width the pointer asked for, already inside this type's own limits. */
  width: number;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False: no resize handles, and a handle gesture is ignored. */
  resizable: boolean;
  /** True: a resize keeps the proportions (sticky notes are squares). */
  aspectLocked: boolean;
  /** The type's own floor, in world units; the maximum is one global setting. */
  minSize: number;
  editableText: boolean;
  /**
   * Is this board point on this object? `zoom` is how far the board is zoomed in, for
   * the one kind of object whose target is measured in *screen* pixels rather than
   * board units — an arrow is hit within a few pixels of its line, whatever the zoom,
   * so its tolerance has to be divided by the zoom to be in board units at all
   * (`connector.select`). Every other type is a box and ignores it; absent means 1.
   */
  hitTest(object: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
  /** Which handles this kind of object is dragged by. Default `all`. */
  handles?: ObjectHandles;
  /**
   * The west/east handle of a `handles: 'horizontal'` type. The gesture never
   * writes a height for such a type: it hands over the width the pointer asked for
   * and the type works out how tall the text it holds has become.
   */
  onHorizontalResize?(event: ResizeNotice): void;
  /**
   * The gesture is over and this type measures its own box. The gesture drops its
   * live preview of the size and lets the type's own numbers stand, because the
   * client that made the change is the one that measured it (`text.wrap`).
   */
  remeasureAfterResize?(doc: Y.Doc, ids: string[]): void;
}

const types = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. A duplicate throws: two modules quietly fighting over
 * one type name is a programming error, and it is cheaper to hear about it at
 * module load than to wonder why the wrong component drew.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (types.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  types.set(type, spec);
  registerObjectTypeModel(type, spec.minSize);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return types.get(type);
}

/** Registered type names, for tests and for the "unknown type" cases. */
export function registeredObjectTypes(): string[] {
  return [...types.keys()];
}

/** A sticky note, reached through the generic props every object gets. */
function StickyObject(props: ObjectProps): ReactNode {
  if (!isStickySnapshot(props.object)) return null;
  return (
    <StickyNote
      note={props.object}
      doc={props.doc}
      zoom={props.zoom}
      selected={props.selected}
      editing={props.editing}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      onStartEdit={props.onStartEdit}
      onEndEdit={props.onEndEdit}
      undo={props.undo}
    />
  );
}

registerObjectType('sticky', {
  Component: StickyObject,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (object: ObjectSnapshot, point: Point) =>
    // A zero-size rect at the point: `rectContains` is the same rule the marquee
    // uses, so a hit is decided exactly like a marquee containment.
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});

/**
 * A piece of free text, with the fields a generic snapshot cannot carry put back in.
 *
 * `snapshotObjects` reads coordinates, and coordinates are all a note needs. A text
 * object's characters live in a shared `Y.Text`, which no plain snapshot can hold,
 * so the component is handed the object as `readTextSnapshot` read it — the one
 * place in the client that asks the document for more than the generic read gives,
 * and the reason `TextObject` is handed `doc` like every other type.
 */
function TextObjectType(props: ObjectProps): ReactNode {
  const full = readTextSnapshot(props.doc, props.object.id);
  if (!full) return null;
  return <TextObject {...props} object={full} />;
}

registerObjectType('text', {
  Component: TextObjectType,
  resizable: true,
  // The width is what you drag; the height is what the text needs at that width.
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (object: ObjectSnapshot, point: Point) =>
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),

  // The gesture has worked out how wide the pointer wants the box, in board units
  // and already inside this type's own limits. It does not write anything for us:
  // taking the width, becoming fixed-width and keeping the edge that was not
  // grabbed where it was are all one write of ours.
  onHorizontalResize(notice): void {
    const { doc, id, handle, anchor } = notice;
    if (!setTextWidthFixed(doc, id, notice.width)) {
      // Already exactly this width: the only thing left is the position, and a west
      // handle that has not changed the width has not moved the box either.
      if (handle !== 'w') return;
    }
    const snapshot = readTextSnapshot(doc, id);
    if (!snapshot) return;
    // The stored width is the one that got clamped to this type's minimum, so it is
    // the one the fixed edge has to be measured from.
    const width = snapshot.width ?? TEXT_MIN_WIDTH_WORLD;
    if (handle === 'w') {
      moveObjects(doc, new Map<string, Point>([[id, { x: anchor.x - width, y: snapshot.y }]]));
    }
  },

  // The gesture is over. This type measures its own box, so its own numbers are the
  // ones that stay: the height the rewrapped text needs goes in now.
  remeasureAfterResize(doc: Y.Doc, ids: string[]): void {
    for (const id of ids) {
      const box = measureTextBox(doc, id, boardMeasurer);
      if (box) setTextBox(doc, id, box);
    }
  },
});

/**
 * A shape, reached through the generic props every object gets (`shape.ui`).
 *
 * A shape is a box with a size of its own, so it is dragged by any of story 7's eight
 * handles and is resized down to `SHAPE_MIN_SIZE_WORLD` — the same floor a drawn shape
 * may not be smaller than, so that the minimum means one thing (`shape.min_size`). It
 * holds text, so it is editable, and the label is a `Y.Text` that `snapshotObjects`
 * reads into `object` like any other field.
 */
function ShapeObjectType(props: ObjectProps): ReactNode {
  if (!isShapeSnapshot(props.object)) return null;
  const shape = props.object as ShapeSnapshot;
  return (
    <ShapeObject
      shape={shape}
      doc={props.doc}
      zoom={props.zoom}
      selected={props.selected}
      editing={props.editing}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      onStartEdit={props.onStartEdit}
      onEndEdit={props.onEndEdit}
      undo={props.undo}
    />
  );
}

registerObjectType('shape', {
  Component: ShapeObjectType,
  resizable: true,
  // A shape is as wide as you dragged it: a resize never changes the other dimension.
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  // The whole rectangle, which for a diamond or an ellipse includes its corners: the
  // box is the object's, and hitting the box it is drawn in is what picking it means.
  hitTest: (object: ObjectSnapshot, point: Point) =>
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});

/**
 * An arrow (`connector.ui`).
 *
 * Not resizable in story 7's sense: an arrow has no box of its own to drag — its box is
 * between two objects, and what you drag instead is either end, which the component
 * does for itself (`connector.reattach`). It holds no text. And it is the one type that
 * is not hit by its box: an arrow's box is mostly empty air, and a click in that air
 * that is nowhere near the line must not select it (TC-20).
 */
function ConnectorObjectType(props: ObjectProps): ReactNode {
  if (!isConnectorSnapshot(props.object)) return null;
  const connector = props.object as ConnectorSnapshot;
  // The same snapshot's boxes the arrow's own box was resolved from. Nothing here is
  // measured or written: the arrow asks where its objects are and draws itself there.
  const rects = objectRects(props.doc);
  return (
    <ConnectorObject
      connector={connector}
      rects={rects}
      doc={props.doc}
      zoom={props.zoom}
      selected={props.selected}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
      undo={props.undo}
    />
  );
}

registerObjectType('connector', {
  Component: ConnectorObjectType,
  resizable: false,
  aspectLocked: false,
  // No floor of its own: an arrow is as long as the gap between what it joins, and
  // `CONNECTOR_MIN_LENGTH_WORLD` is a rule about drags, taken once in the model.
  minSize: 0,
  editableText: false,
  hitTest: (object: ObjectSnapshot, point: Point, zoom?: number) =>
    isConnectorSnapshot(object)
      ? hitTestConnector(object, point, zoom ?? 1)
      : rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});

/**
 * A drawing (`stroke.object`).
 *
 * Resizable, and the one type whose resize has to keep the proportions: a sketch stretched
 * on one axis only is that sketch distorted, so `aspectLocked` is what story 7's handles
 * are given and `scaledPoints` draws the result at whatever size the box became
 * (`pen.resize`). It holds no text — a drawing has nothing to type into — and it is the
 * second type that is not hit by its box: a stroke's box is mostly empty air, and a click
 * in that air that is nowhere near the ink is a click on whatever is behind it (TC-16).
 * Where a stroke is drawn is the document's own `width`/`height`, so the generic move,
 * resize and delete work on it without knowing what a line is.
 */
function StrokeObjectType(props: ObjectProps): ReactNode {
  if (!isStrokeSnapshot(props.object)) return null;
  const stroke = props.object as StrokeSnapshot;
  return (
    <StrokeObject
      stroke={stroke}
      selected={props.selected}
      zoom={props.zoom}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
    />
  );
}

registerObjectType('stroke', {
  Component: StrokeObjectType,
  resizable: true,
  // A drawing scales as a drawing: both ways at once, so the thing that was drawn is the
  // thing that is bigger.
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  hitTest: (object: ObjectSnapshot, point: Point, zoom?: number) =>
    isStrokeSnapshot(object)
      ? hitTestStroke(object, point, zoom ?? 1)
      : rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});

/**
 * An image (`image.object`).
 *
 * Resizable, and the second type whose resize must keep proportions — an image stretched
 * on one axis only is that picture distorted (`image.aspect_resize`), exactly as a drawing
 * is. It holds no text, and it is hit by its box: an image is a solid rectangle, so picking
 * it is picking the rectangle it is drawn in, with no empty-air exception like a line or an
 * arrow. It is the one type whose *rendering* is not decided by its own fields alone: the
 * same `uploading` object is a percentage to the tab that uploaded it and a plain
 * "Uploading…" to everyone else, a failure is only ever *yours* to see, and `unfinished`
// needs a clock. Those are per-tab facts held in `useImageInsert`, so the wrapper reads
 * them out of `ImageObjectContext` and hands the pure `ImageObject` its five per-viewer
 * props; the object writes nothing to the document through them (`image.status_owner`).
 */
function ImageObjectType(props: ObjectProps): ReactNode {
  if (!isImageSnapshot(props.object)) return null;
  const ctx = useContext(ImageObjectContext);
  const image = props.object;
  return (
    <ImageObject
      image={image}
      isUploader={image.uploaderId === ctx.localId}
      progress={ctx.progress.get(image.id)}
      canRetry={ctx.canRetry(image.id)}
      now={ctx.now}
      onRetry={() => ctx.retry(image.id)}
      onRemove={() => ctx.remove(image.id)}
      selected={props.selected}
      editable={props.editable}
      onObjectPointerDown={props.onObjectPointerDown}
    />
  );
}

registerObjectType('image', {
  Component: ImageObjectType,
  resizable: true,
  // An image keeps its proportions when resized (`image.aspect_resize`).
  aspectLocked: true,
  // The same floor an image is never placed smaller than, so it means one thing.
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  // The whole rectangle: an image is solid, so hitting its box is hitting the image.
  hitTest: (object: ObjectSnapshot, point: Point) =>
    rectContains(objectBounds(object), { ...point, width: 0, height: 0 }),
});
