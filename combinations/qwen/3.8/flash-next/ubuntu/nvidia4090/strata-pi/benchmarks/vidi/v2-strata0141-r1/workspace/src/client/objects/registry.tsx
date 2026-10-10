import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type * as Y from 'yjs';
import {
  objectBounds,
  registerSelectableType,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { rectContainsPoint, type Point } from '../../shared/geometry';
import {
  IMAGE_MIN_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
} from '../../shared/config';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ConnectorObject, hitTestConnector } from './ConnectorObject';
import { ShapeObject } from './ShapeObject';
import { StrokeObject, hitTestStroke } from './StrokeObject';
import { ImageObject } from './ImageObject';
import type { ConnectorSnapshot } from '../../shared/objects/connector';
import type { StrokeSnap } from '../../shared/objects/stroke';
import type { BoardSurface } from '../canvas/BoardViewport';

/**
 * The object type registry (anchor `sel.registry`).
 *
 * A board object type declares **four** things and nothing else: whether it can
 * be resized, whether it keeps its proportions, how small it may go, and how to
 * tell that a point in the world is on it. Selection, marquee, move, resize,
 * stacking and deletion are written once here and in
 * `src/client/board/useTransformGesture.ts`, and stories 9-12 add types by
 * calling `registerObjectType` - never by adding their own interaction code
 * (`sel.all_types`).
 */
/**
 * What a transform gesture needs from a pointer event. Structural on purpose:
 * it is satisfied by a DOM `PointerEvent` and by React's synthetic event, so a
 * component can hand over whichever one it was given.
 */
export interface PointerEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly button: number;
  readonly pointerId: number;
  readonly currentTarget: EventTarget | null;
}

export interface ObjectProps<T extends ObjectSnapshot = ObjectSnapshot> {
  obj: T;
  doc: Y.Doc;
  /** Camera zoom, so a component can keep its chrome the same size on screen. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** This object is being moved or resized by a gesture right now. */
  dragging: boolean;
  /** False while the room could not load this board: nothing here mutates it. */
  editable?: boolean;
  /** Click (additive false) or Shift-click (additive true). */
  onSelect(id: string, additive: boolean): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * The board's transform gesture. A component forwards its own pointerdown
   * here and gets nothing else to write: selection, group move and the drag
   * threshold are the board's business (`sel.transform`).
   */
  onObjectPointerDown(event: PointerEventLike, id: string): void;
  /**
   * The board surface: camera, viewport and where the surface sits on the screen.
   * A component that turns a window pointer event into world coordinates needs it,
   * and needs the same conversion every tool uses - a connector measuring itself
   * against its own box would place an end somewhere the board is not pointing
   * (`connector.reattach`).
   */
  surface?: BoardSurface | null;
}

export interface ObjectTypeSpec {
  /**
   * The component that draws one object. Declared over `ObjectProps<never>` so
   * a component that wants a narrower snapshot (`ObjectProps<StickySnapshot>`)
   * is still a valid object component: the renderer passes the snapshot the
   * registry guarantees for the type.
   */
  Component: ComponentType<ObjectProps<never>>;
  resizable: boolean;
  aspectLocked: boolean;
  /** Smallest side this type allows, in world units (`sel.size_limits`). */
  minSize: number;
  editableText: boolean;
  /**
   * Which resize handles this type may use (`sel.resize`). A text object only
   * has room for its left and right edges; a type that does not say gets all
   * eight, which is how every type before story 9 was drawn.
   */
  handles?: HandlesMode;
  /**
   * Is this world point on this object?
   *
   * `zoom` is the camera zoom, because a type whose "on it" is a band of a certain
   * width *on the screen* - story 10's connector, `connector.tolerance` - has to
   * convert that band to world units to measure it. A type that only looks at its
   * rectangle ignores it.
   */
  hitTest(obj: ObjectSnapshot, worldPoint: Point, zoom?: number): boolean;
}

/** Which resize handles a type may use: all eight, or its two horizontal edges. */
export type HandlesMode = 'all' | 'horizontal';

/** The handles a type uses when its spec does not say. */
export const DEFAULT_HANDLES_MODE: HandlesMode = 'all';

/** The handles one type actually gets. */
export function handlesOf(spec: ObjectTypeSpec | undefined): HandlesMode {
  return spec?.handles ?? DEFAULT_HANDLES_MODE;
}

/**
 * The bounds hit-test every type starts with: the rectangle `objectBounds`
 * reports, borders included. A type with a shape that is not its bounding box
 * overrides it.
 */
export function hitTestBounds(obj: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContainsPoint(objectBounds(obj), worldPoint);
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register a type. A duplicate is a programming error and throws at module load
 * rather than silently letting the last import win.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The board model must know which types exist, or it cannot tell a board
  // object from a field another client wrote into the same map (TC-08, TC-12).
  registerSelectableType(type);
}

export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/**
 * The topmost object a world point is on, each type asked in its own way
 * (`sel.registry`, `connector.tolerance`).
 *
 * The board asks this when a click reached the surface rather than an object -
 * which is exactly the case an arrow needs, because a click that landed *near* a
 * thin line never landed on it, and only a distance test can tell whether that is
 * the same as on it. Objects are asked topmost first, the order they are drawn in.
 */
export function hitTestObjectAt(
  objects: readonly ObjectSnapshot[],
  worldPoint: Point,
  zoom: number,
): ObjectSnapshot | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const obj = objects[index];
    const spec = obj ? registry.get(obj.type) : undefined;
    if (!obj || !spec) {
      continue;
    }
    if (spec.hitTest(obj, worldPoint, zoom)) {
      return obj;
    }
  }
  return null;
}

/** Is this type one the board can draw, select and transform? */
export function isRegisteredType(type: string): boolean {
  return registry.has(type);
}

/**
 * Does this selection contain at least one type that can be resized? Handles are
 * hidden when it does not (`sel.resize`), and a resize gesture on it is ignored.
 */
export function selectionIsResizable(ids: Iterable<string>, typeOf: (id: string) => string): boolean {
  for (const id of ids) {
    const spec = getObjectType(typeOf(id));
    if (spec?.resizable) {
      return true;
    }
  }
  return false;
}

/**
 * Which handles a selection may show (`sel.resize`).
 *
 * `horizontal` only when **every** object in the selection takes handles on its left
 * and right edge alone - one text object, or a group of them. A sticky note in the
 * selection brings the other six back, because that note is resized as a rectangle
 * whatever else is selected with it.
 */
export function selectionHandlesMode(
  ids: Iterable<string>,
  typeOf: (id: string) => string,
): HandlesMode {
  let mode: HandlesMode | null = null;
  for (const id of ids) {
    const spec = getObjectType(typeOf(id));
    if (!spec) {
      continue; // an id whose type is not registered is not part of this decision
    }
    if (handlesOf(spec) !== 'horizontal') {
      return 'all';
    }
    mode = 'horizontal';
  }
  return mode ?? 'all';
}

/** Does this selection contain a type that keeps its proportions (Key decision 3)? */
export function selectionIsAspectLocked(
  ids: Iterable<string>,
  typeOf: (id: string) => string,
): boolean {
  for (const id of ids) {
    const spec = getObjectType(typeOf(id));
    if (spec?.aspectLocked) {
      return true;
    }
  }
  return false;
}

/** The minimum side each selected object allows, in the order the gesture reads them. */
export function selectionMinSizes(
  ids: Iterable<string>,
  typeOf: (id: string) => string,
): number[] {
  const sizes: number[] = [];
  for (const id of ids) {
    sizes.push(getObjectType(typeOf(id))?.minSize ?? 0);
  }
  return sizes;
}

/* -------------------------------------------------------------------------- */
/* Sticky notes (`sticky.*`): resizable, square, 50 board units minimum.      */
/* -------------------------------------------------------------------------- */

registerObjectType('sticky', {
  Component: StickyNote as ComponentType<ObjectProps<never>>,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: hitTestBounds,
});

/* -------------------------------------------------------------------------- */
/* Text (`text.*`): width resizable, height derived, horizontal handles only. */
/* -------------------------------------------------------------------------- */

registerObjectType('text', {
  Component: TextObject as ComponentType<ObjectProps<never>>,
  resizable: true,
  // A text object has no proportions to keep: its height follows its content and
  // only its width is a number a person sets (`text.height`, Key decision 2).
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: hitTestBounds,
});

/* -------------------------------------------------------------------------- */
/* Shapes (`shape.*`): the box is the shape, so the box is what a click finds. */
/* -------------------------------------------------------------------------- */

registerObjectType('shape', {
  Component: ShapeObject as ComponentType<ObjectProps<never>>,
  resizable: true,
  // A shape keeps no proportions: a 200x120 rectangle stays a rectangle when it is
  // stretched, and Shift is a *drag* constraint (`shape.size`), not a resize one.
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  // A rect, an ellipse and a diamond all fill their bounding box - an ellipse
  // touches it at four points, a diamond along four edges - and the SVG that draws
  // them covers the box, so a click anywhere in the box reaches the shape.
  hitTest: hitTestBounds,
});

/* -------------------------------------------------------------------------- */
/* Connectors (`connector.*`): never resized, hit by distance, no text.       */
/* -------------------------------------------------------------------------- */

registerObjectType('connector', {
  Component: ConnectorObject as ComponentType<ObjectProps<never>>,
  // An arrow has no size to change. Its box is derived from its ends
  // (`connector.follow`), so it gets no handles, `resizeObjects` refuses it and
  // `moveObjects` leaves it to the objects it is attached to.
  resizable: false,
  aspectLocked: false,
  // Never asked: a type that cannot be resized has no minimum side.
  minSize: 0,
  // No text: a double-click on an arrow must not create any (`shape.create`).
  editableText: false,
  // Not the box - the line, plus `CONNECTOR_HIT_TOLERANCE_PX` of screen either
  // side, converted to world units at this zoom (`connector.tolerance`, TC-20).
  hitTest: (obj, worldPoint, zoom = 1) =>
    hitTestConnector(obj as ConnectorSnapshot, worldPoint, zoom),
});

/* -------------------------------------------------------------------------- */
/* Strokes (`pen.*`): resizable in proportion, hit by distance to the line.   */
/* -------------------------------------------------------------------------- */

registerObjectType('stroke', {
  Component: StrokeObject as ComponentType<ObjectProps<never>>,
  // A finished stroke is an ordinary board object: it moves, it resizes, it is
  // deleted, it is undone (`pen.resize`).
  resizable: true,
  // Its shape is what a hand drew. Stretching it makes it bigger in proportion -
  // the recorded path is scaled by one factor for both axes - and the thickness it
  // was drawn with stays what the pen was set to.
  aspectLocked: true,
  // As small as the thinnest line it could have been drawn with: a stroke is never
  // resized down to nothing.
  minSize: STROKE_MIN_SIZE_WORLD,
  // Nothing to type into: a drawing is not text (`pen.draw`).
  editableText: false,
  // Not the box - the line, plus `STROKE_HIT_TOLERANCE_PX` of screen either side,
  // converted to board units at this zoom (`pen.select`, TC-15, TC-16). A click
  // inside the box but away from the line is answered by nothing here, so it falls
  // through to the objects below and to the board.
  hitTest: (obj, worldPoint, zoom = 1) =>
    hitTestStroke(obj as StrokeSnap, worldPoint, zoom),
});

/* -------------------------------------------------------------------------- */
/* Images (`image.*`): proportional, never typed into, hit by its box.        */
/* -------------------------------------------------------------------------- */

registerObjectType('image', {
  Component: ImageObject as ComponentType<ObjectProps<never>>,
  // An image moves and resizes like every other object once it is on the board
  // (`image.aspect_resize`): the bytes are stored once and whatever size a person
  // gives the object is what the browser scales them to.
  resizable: true,
  // A picture has a shape. Stretching one in only one direction squashes the thing
  // it was photographed of, so both sides always move by the same factor.
  aspectLocked: true,
  // As small as a board lets anything go: an image resized below this is a smudge
  // that cannot be recognised, so the gesture stops before it (`sel.size_limits`).
  minSize: IMAGE_MIN_SIZE_WORLD,
  // Nothing to type into: an image has no text, and a double-click on it must not
  // create any (`image.registry`).
  editableText: false,
  // The box is the picture, so the box is what a click finds - including while it is
  // still a placeholder, which is the same size it will be (`image.drop`).
  hitTest: hitTestBounds,
});

/**
 * A component that needs nothing from the registry: registering is a side
 * effect of importing this module, and `BoardView` imports it, so every board
 * has its types before it renders one.
 */
export function useObjectTypes(): void {
  useEffect(() => undefined, []);
}
