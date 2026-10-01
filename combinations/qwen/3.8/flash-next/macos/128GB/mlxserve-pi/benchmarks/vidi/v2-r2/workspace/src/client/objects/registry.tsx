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
  STICKY_MIN_SIZE_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TYPE_STICKY,
  TYPE_TEXT,
} from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { StickyNoteProps } from './StickyNote';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** Every object this build can draw. */
export type BoardObject = StickySnapshot | TextSnapshot;

/**
 * The props the board passes to any object component. Every object type in
 * this build takes exactly what a sticky note takes - the snapshot, the
 * document, the zoom, the selection and editing flags and the interaction
 * callbacks - which is what lets the board render types it has no `if` for.
 * The snapshot is whichever object of that type it is handed.
 */
export interface ObjectProps extends Omit<StickyNoteProps, 'note'> {
  note: BoardObject;
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
   * one: inside the object's bounds.
   */
  hitTest?: (object: ObjectSnapshot) => boolean;
  /**
   * Which handles a single selected object gets. 'all' (the default) is a box
   * resized from any of eight; 'horizontal' is a box whose height belongs to its
   * content - text - so it has an east and a west handle and nothing else.
   */
  handles?: ObjectHandles;
}

/** The handle set an object type shows when it is selected on its own. */
export type ObjectHandles = 'all' | 'horizontal';

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
export function hitTestObject(object: ObjectSnapshot, point: Point): boolean {
  const spec = registrations.get(object.type);
  if (spec === undefined) return false;
  if (spec.hitTest !== undefined) return spec.hitTest(object);
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

/** The two handles of a box whose height belongs to its content. */
const SIDE_HANDLES: readonly Handle[] = ['e', 'w'];

/**
 * The handles a selection gets: the eight of a box you resize from any side, or -
 * when every object in it is a type whose height is its content's, which today
 * means text and nothing else - the two side handles, because there is no height
 * for a top or bottom handle to set.
 */
export function handlesFor(objects: readonly ObjectSnapshot[]): readonly Handle[] {
  const horizontal =
    objects.length > 0 &&
    objects.every((object) => registrations.get(object.type)?.handles === 'horizontal');
  return horizontal ? SIDE_HANDLES : [...HANDLES];
}
