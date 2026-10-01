// The object type registry: the one table that knows which object types this
// build ships. Adding a tool (stories 9-12) means adding one entry here; the
// selection overlay, the marquee, the selection bar and the keyboard never
// learn the word "sticky".
//
// A registration says:
//   - how an object of this type draws (its component),
//   - the two per-type transform rules the group resize reads: the smallest
//     edge it may shrink to, and whether a corner resize keeps its ratio,
//   - whether an editor can open on it, and
//   - how a point decides as "on" it (default: inside its bounds - every
//     object in this build is an axis-aligned rect, so one rule fits all).
//
// Creation stays with board-model (createSticky and the next stories'
// creators): the registry describes behaviour of existing objects, it does
// not own the schema.

import type { ComponentType, JSX } from 'react';
import type { Handle, Point } from '../../shared/geometry';
import { HANDLES, objectBounds } from '../../shared/geometry';
import {
  CONNECTOR_HIT_TOLERANCE_PX,
  IMAGE_MIN_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TYPE_CONNECTOR,
  TYPE_IMAGE,
  TYPE_SHAPE,
  TYPE_STICKY,
  TYPE_STROKE,
  TYPE_TEXT,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { ShapeSnapshot } from '../../shared/objects/shape';
import type { ConnectorSnapshot } from '../../shared/objects/connector';
import type { StrokeSnapshot } from '../../shared/objects/stroke';
import type { ImageSnapshot } from '../../shared/objects/image';
import { scaledPoints, strokeThicknessWorld } from '../../shared/objects/stroke';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { StickyNoteProps } from './StickyNote';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';
import { StrokeObject } from './StrokeObject';
import { ImageObject } from './ImageObject';

/** Every object this build can draw. */
export type BoardObject =
  | StickySnapshot
  | TextSnapshot
  | ShapeSnapshot
  | ConnectorSnapshot
  | StrokeSnapshot
  | ImageSnapshot;

/**
 * The props the board passes to any object component. Every object type in
 * this build takes exactly what a sticky note takes - the snapshot, the
 * document, the zoom, the selection and editing flags and the interaction
 * callbacks - which is what lets the board render types it has no `if` for.
 * The snapshot is whichever object of that type it is handed.
 */
export interface ObjectProps extends Omit<StickyNoteProps, 'note'> {
  note: BoardObject;
  /**
   * Pictures only (story 12), and only while *this client* is the one uploading: 0 to 1.
   * Everyone else has no number to be shown, which is why it is optional rather than 0.
   */
  progress?: number;
  /** Whether the person reading this board is the one who added the picture. */
  isUploader?: boolean;
  /** Whether a retry would achieve anything - the file is still in this browser's memory. */
  canRetry?: boolean;
  /** The board's render clock, which is how an upload is allowed to go stale. */
  now?: number;
  /** Upload the same file again. */
  onRetry?(id: string): void;
  /** Delete a placeholder that is going nowhere. */
  onRemove?(id: string): void;
}

/**
 * A component declares the snapshot of its own type in `note`; the board hands a
 * component the snapshot of the object's own type. The registry keeps one
 * component type for all of them, so this is where the two meet - one cast, whose
 * promise ("this component is registered for the snapshot it is handed") is the
 * board's to keep, since it renders a component chosen from the object's type.
 */
function componentForType<N extends ObjectSnapshot>(
  Component: (props: Omit<ObjectProps, 'note'> & { note: N }) => JSX.Element,
): ComponentType<ObjectProps> {
  return Component as unknown as ComponentType<ObjectProps>;
}

export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Can a group resize change its size at all? Text-in-shape types say no. */
  resizable: boolean;
  /**
   * Does a corner resize keep the object's ratio? Sticky notes are squares
   * that stay squares; a future free-form type registers false and is resized
   * per axis.
   */
  aspectLocked: boolean;
  /** Per-type minimum edge, world units; the resize clamp reads it here. */
  minSize: number;
  /**
   * Can an editor open on it? A sticky note edits its text; a shape registers
   * false until it has an in-place editor, and Enter then does nothing.
   */
  editableText: boolean;
  /**
   * Per-type override of the point-in-object rule; absent means the shared
   * one: inside the object's bounds. Given the point in board units and the
   * zoom, because a type whose body is a line rather than a box has to measure
   * its tolerance in screen pixels - and only the zoom says how wide a board
   * unit is on the screen.
   */
  hitTest?: (object: ObjectSnapshot, point: Point, zoom: number) => boolean;
  /**
   * Which handles a single selected object gets. 'all' (the default) is a box
   * resized from any of eight; 'horizontal' is a box whose height belongs to its
   * content - text - so it has an east and a west handle and nothing else;
   * 'none' is an object with no box to resize at all - an arrow, whose two ends
   * are handles of their own, drawn by the arrow itself.
   */
  handles?: ObjectHandles;
}

/** The handle set an object type shows when it is selected on its own. */
export type ObjectHandles = 'all' | 'horizontal' | 'none';

const registrations = new Map<string, ObjectTypeSpec>();

/**
 * Register a type under its name. Registering the same name twice is a wiring
 * bug and throws, rather than silently letting one module's entry win over
 * another's.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registrations.has(type)) {
    throw new Error(`object type already registered: ${type}`);
  }
  registrations.set(type, spec);
}

/** The spec for a type name, or undefined when this build does not know it. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registrations.get(type);
}

/**
 * The component that draws an object of this type, or null when the type is
 * unknown - and the board renders nothing for it, exactly as the snapshot
 * skips it.
 */
export function componentFor(type: string): ComponentType<ObjectProps> | null {
  return registrations.get(type)?.Component ?? null;
}

/** The names of every known type, in registration order. */
export function registeredTypes(): string[] {
  return [...registrations.keys()];
}

/**
 * The shared hit test: ask the type's spec, and with no spec - or a type that
 * does not override the rule - fall back to "the point lies inside the
 * object's bounds". The bounds are half-open on the right and bottom edges,
 * the way DOM boxes are: the pixel where the next object begins belongs to
 * the next object, never to both. An unknown type answers false: what this
 * build cannot draw it cannot click either.
 */
export function hitTestObject(object: ObjectSnapshot, point: Point, zoom = 1): boolean {
  const spec = registrations.get(object.type);
  if (spec === undefined) return false;
  if (spec.hitTest !== undefined) return spec.hitTest(object, point, zoom);
  const b = objectBounds(object);
  return (
    point.x >= b.x &&
    point.x < b.x + b.width &&
    point.y >= b.y &&
    point.y < b.y + b.height
  );
}

// --- the types this build ships ---------------------------------------------

registerObjectType(TYPE_STICKY, {
  Component: componentForType<StickySnapshot>(StickyNote),
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
});

// Text is a sticky note with no box behind the words: resizable, editable, no
// ratio to keep - and only a side handle, because its height is its content's.
registerObjectType(TYPE_TEXT, {
  Component: componentForType<TextSnapshot>(TextObject),
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
});

// A shape is a box that holds words: the sticky note's eight handles and its
// editor, but no ratio to keep - a rectangle drawn wide stays wide, and the only
// square a shape is obliged to be is the one Shift asks for as it is drawn. Its
// box is its own, never its text's, so it is measured by nothing.
registerObjectType(TYPE_SHAPE, {
  Component: componentForType<ShapeSnapshot>(ShapeObject),
  resizable: true,
  aspectLocked: false,
  minSize: SHAPE_MIN_SIZE_WORLD,
  editableText: true,
  handles: 'all',
});

// An arrow is not a box. It cannot be resized, it holds no text, and it takes no
// handles - and being "on" it means being near its line rather than inside its
// box, which is the one thing about it the shared rule cannot say.
registerObjectType(TYPE_CONNECTOR, {
  Component: componentForType<ConnectorSnapshot>(ConnectorObject),
  resizable: false,
  aspectLocked: false,
  minSize: 0,
  editableText: false,
  handles: 'none',
  hitTest: (object, point, zoom) =>
    distanceToPolyline(
      [(object as ConnectorSnapshot).ends.from, (object as ConnectorSnapshot).ends.to],
      point,
    ) <= CONNECTOR_HIT_TOLERANCE_PX / zoom,
});

/** The two handles of a box whose height belongs to its content. */
const SIDE_HANDLES: readonly Handle[] = ['e', 'w'];

// A drawing is a box that holds a line rather than words: it is moved and resized like
// any object - proportionally, because a drawing squashed sideways is a different
// drawing - and it holds nothing to type into. Being "on" it is measured against the
// line rather than the box, and the box of a scribble is mostly empty space: a click
// in it belongs to whatever the line went round, which is the one thing the shared
// rule cannot say and the reason this entry exists.
registerObjectType(TYPE_STROKE, {
  Component: componentForType<StrokeSnapshot>(StrokeObject),
  resizable: true,
  aspectLocked: true,
  minSize: STROKE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
  hitTest: (object, point, zoom) => {
    const stroke = object as StrokeSnapshot;
    // Half the ink, or six screen pixels in board units, whichever is more: a thin
    // line is still clickable, and a thick one is clickable over all of it.
    const tolerance = Math.max(strokeThicknessWorld(stroke) / 2, STROKE_HIT_TOLERANCE_PX / zoom);
    return distanceToPolyline(scaledPoints(stroke), point) <= tolerance;
  },
});

// A picture is a box that holds bytes kept somewhere else: it is moved, resized, deleted and
// undone like any object - and resized in proportion, because a photograph squashed sideways is
// a different photograph, which is the one thing the story 7 resize is told here rather than
// asked about. It holds nothing to type into, and being "on" it is being inside its box, which
// is why it is the only type in this build that registers no hit test at all: a picture fills
// its box completely, so the shared rule is exactly right.
//
// The minimum edge is here rather than in the drag maths because a picture may be shrunk to a
// thumbnail but not to nothing: below sixteen board units there are no pixels left to show.
registerObjectType(TYPE_IMAGE, {
  Component: componentForType<ImageSnapshot>(ImageObject),
  resizable: true,
  aspectLocked: true,
  minSize: IMAGE_MIN_SIZE_WORLD,
  editableText: false,
  handles: 'all',
});

/** Nothing a selection can be dragged by. */
const NO_HANDLES: readonly Handle[] = [];
/**
 * The handles a selection gets: the eight of a box you resize from any side, or -
 * when every object in it is a type whose height is its content's, which today
 * means text and nothing else - the two side handles, because there is no height
 * for a top or bottom handle to set; or none at all, when every object in it is a
 * type that is not resized - which is what leaves an arrow, selected on its own,
 * with nothing on the board but its own two ends.
 *
 * Objects of unknown types are skipped: the board draws nothing for them and
 * selects nothing, so they neither take handles nor deny the others their own.
 * A selection of nothing the build knows - an empty selection - has nothing to
 * drag, and says so.
 */
export function handlesFor(objects: readonly ObjectSnapshot[]): readonly Handle[] {
  const known = objects.filter((object) => registrations.has(object.type));
  if (known.length === 0) return NO_HANDLES;
  if (known.every((object) => registrations.get(object.type)?.handles === 'none')) return NO_HANDLES;
  const horizontal = known.every((object) => registrations.get(object.type)?.handles === 'horizontal');
  return horizontal ? SIDE_HANDLES : [...HANDLES];
}
