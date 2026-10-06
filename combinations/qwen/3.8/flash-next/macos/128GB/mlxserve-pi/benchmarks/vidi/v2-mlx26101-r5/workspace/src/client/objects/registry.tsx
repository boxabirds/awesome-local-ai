/**
 * The object-type registry (design capability `obj.registry`).
 *
 * A board object is anything a story has decided to put on the board. Today there is one type, the
 * sticky note; stories 9 to 12 add text, shapes, drawings and images by calling
 * {@link registerObjectType} and touching nothing else. Selection, marquee, group drag, resize,
 * delete, nudge and copy/paste all walk this list, which is why *select all* can promise that it
 * selects every object on the board whatever it is — and why a board written by a newer client still
 * opens here: an object whose type this build does not know is listed in the snapshot, is not
 * rendered, and is left strictly alone.
 *
 * A type declares five things: what draws it, whether it can be resized, whether it keeps its
 * proportions, how small it may go, and where it is. Those are the only per-type knobs there are —
 * a type cannot have its own selection, its own drag or its own delete, which is what keeps a board
 * of six object types behaving as one board.
 */

import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import type { Doc } from 'yjs';

import {
  declareObjectType,
  objectBounds,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import { rectContainsPoint, type Point } from '../../shared/geometry';
import type { TextSnapshot } from '../../shared/objects/text';
import type { UndoControls } from '../board/useUndo';
import { STICKY_OBJECT_TYPE, StickyNote } from './StickyNote';
import { TEXT_OBJECT_TYPE, TextObject } from './TextObject';

/**
 * What the board gives an object so that it can take part in the board's behaviour. An object never
 * moves, resizes or deletes itself: it says what it wants and the board does it, so that one gesture
 * can act on a whole selection of mixed types.
 *
 * `T` is the snapshot of the object's own type: a sticky note is drawn with
 * `ObjectProps<StickySnapshot>`. The board reads an object, looks its type up here and hands the
 * component the props of exactly that type.
 */
export interface ObjectProps<T extends ObjectSnapshot = ObjectSnapshot> {
  /** The object being drawn. */
  obj: T;
  /** The shared document, for the object's own content (a sticky note's text). */
  doc: Doc;
  /** Current zoom, for the parts of an object that stay the same size on screen. */
  zoom: number;
  /** The object is in the selection. */
  selected: boolean;
  /** This object is the whole selection, so it shows the tools that belong to one object alone. */
  soleSelected: boolean;
  /** A pointer is down on this object and the gesture has not moved yet. */
  pressed: boolean;
  /** A gesture is moving this object. */
  dragging: boolean;
  /** The object's own editing surface is open; the board does not move an object while it is. */
  editing: boolean;
  /** Editing is allowed (false when the board could not be loaded). */
  editable: boolean;
  /** Plain click: this object is the selection, on its own. */
  onSelect(id: string): void;
  /** Open this object's editing surface, if its type has one. Sticky notes do; shapes do not. */
  onStartEdit(id: string): void;
  /**
   * Close this object's editing surface, given this object's id.
   *
   * The id is not decoration: a single pointer press can close one object's editor and open another's,
   * and the object that is finished is the one that says so — closing "the open editor" would close the
   * editor that this very press opened.
   */
  onEndEdit(owner?: string): void;
  /** The object is gone from the document: stop drawing it and drop any editing state. */
  onDeleted(id: string): void;
  /**
   * A pointer went down on the object. The board decides what happens next — a click, a group move,
   * a shift-click that toggles the object in or out of the selection — because a gesture that starts
   * on one object may have to move twenty, and an object that dragged itself would move one object
   * while leaving the selection where it was.
   */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement> | PointerEvent, id: string): void;
  /**
   * This person's undo history, for the writes an object makes to its own content.
   *
   * An object that changes its own colour, or asks to be deleted, is doing one thing — and one thing
   * is one step of the history. It says so with `boundary` on either side of the write, because the
   * history cannot tell on its own that a colour click is not the second half of the drag that ended
   * a moment ago: from where it stands they are two writes half a second apart, which is exactly what
   * a burst of typing looks like.
   *
   * Left out, the object's writes are still undone — they simply join whatever step was open.
   */
  undo?: UndoControls;
}

/**
 * Which handles a type offers: all eight around its box, or the two on its sides.
 *
 * One word per type, decided by the type and read by whoever draws or drags the handles: the overlay
 * that draws them, the gesture that is driven by them and the tests that count them all ask the same
 * question, and none of them is the place the answer belongs.
 */
export type HandlesMode = 'all' | 'horizontal';

/**
 * What one object type tells the board about itself.
 *
 * `Component` and `hitTest` are declared as methods rather than as properties holding functions: the
 * board keeps the specifications of every type in one list and hands each component the object of
 * the type it looked up, which is a question a list cannot ask at compile time. Methods are the
 * documented way in TypeScript to say "the type of the object is the type of the props", and it is
 * true here — the object read from the snapshot of type `T` is the object drawn.
 */
export interface ObjectTypeSpec<T extends ObjectSnapshot = ObjectSnapshot> {
  /** How it is drawn, and how it is picked up by a pointer. */
  Component(props: ObjectProps<T>): ReactElement | null;
  /** Whether a resize handle may change its size at all. */
  resizable: boolean;
  /** True when a resize always keeps the object's proportions (a sticky note, a drawing). */
  aspectLocked: boolean;
  /** Smallest this type may be dragged to, in world units. */
  minSize: number;
  /** True when the type has a text body a person can type into (text, sticky notes). */
  editableText: boolean;
  /**
   * Which handles this type has: all eight around the box, or the two on its sides.
   *
   * Left out it is `'all'`, which is every object this board had until story 9. `'horizontal'` is for a
   * thing whose height is its content's own business: a text object has no handle that makes it taller,
   * because the only thing that makes text taller is more text. A type that could not be given a height
   * by a handle does not get one to try.
   */
  handles?: HandlesMode;
  /** Is this object at this world point? Where the type is, is the type's own business. */
  hitTest(obj: T, worldPoint: Point): boolean;
}

/**
 * What this build can draw, by type name.
 *
 * A module-level map, like the board itself: there is one board on a page and one registry in a page,
 * and a story's object type registers itself when the module is loaded — which is why adding a type
 * never means editing selection, marquee, group drag, delete or copy/paste.
 */
const registry = new Map<string, ObjectTypeSpec>();

/**
 * Adds an object type.
 *
 * Registering the same type twice is a bug rather than a last-writer-wins race: two definitions of
 * one type means two components that disagree about what a `sticky` is, and whichever won we would be
 * drawing the wrong thing with no clue why. So it throws, at module load, in development.
 */
export function registerObjectType<T extends ObjectSnapshot>(type: string, spec: ObjectTypeSpec<T>): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The document model keeps its own list of what this build knows about, because select-all and the
  // marquee work from snapshots and must not have to import a React component to ask a question.
  declareObjectType(type);
}

/** The specification of `type`, or undefined when this build does not know that type. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** Types this build can draw, in the order they registered. */
export function registeredObjectTypes(): readonly string[] {
  return [...registry.keys()];
}

/**
 * The smallest an object of `type` may be dragged, in world units.
 *
 * A type we cannot draw still takes part in a group resize — it is in the selection, so its box is in
 * the bounding box — and its box still has to stop somewhere. The size we know it to be is the size
 * every object of that type starts out at, which is the one size that cannot be wrong.
 */
export function minSizeWorld(type: string): number {
  return getObjectType(type)?.minSize ?? STICKY_MIN_SIZE_WORLD;
}

/** True when an object of this type always keeps its proportions. Unknown types keep nothing. */
export function keepsAspect(type: string): boolean {
  return getObjectType(type)?.aspectLocked === true;
}

/** Whether a handle may resize this object at all. Unknown types cannot be resized. */
export function isResizableType(type: string): boolean {
  return getObjectType(type)?.resizable === true;
}

/** Whether this object's type has a text body, which is what Enter opens. */
export function hasEditableText(type: string): boolean {
  return getObjectType(type)?.editableText === true;
}

/** Which handles a type offers: `'all'` unless it said otherwise. Unknown types get none at all. */
export function handlesOf(type: string): HandlesMode {
  return isResizableType(type) && getObjectType(type)?.handles === 'horizontal' ? 'horizontal' : 'all';
}

/**
 * The handles a whole selection offers.
 *
 * A selection of text objects has the two side handles, because that is what each of them has. Add a
 * sticky note to it and the selection has eight, because the selection can now resize something that
 * takes any shape it is given — and the text objects in it are resized by that same gesture in the one
 * way they can be: wider, or narrower, with their height following their own content.
 *
 * Types this build cannot draw are not counted: they are in the selection and in the bounding box, but
 * they are not what the handles are offered for.
 */
export function handlesForObjects(objects: readonly ObjectSnapshot[]): HandlesMode {
  let resizable = 0;
  let horizontal = 0;
  for (const obj of objects) {
    if (!isResizableType(obj.type)) continue;
    resizable += 1;
    if (handlesOf(obj.type) === 'horizontal') horizontal += 1;
  }
  return resizable > 0 && resizable === horizontal ? 'horizontal' : 'all';
}

/** Where this object is, according to its own type. Unknown types are nowhere. */
export function hitTestObject(obj: ObjectSnapshot, worldPoint: Point): boolean {
  const spec = getObjectType(obj.type);
  return spec ? spec.hitTest(obj, worldPoint) : false;
}

/**
 * Draws one object, whatever its type is — and draws nothing at all when nobody registered one.
 *
 * This is the only place the board asks the registry for a component, which is the whole reason
 * `Board` does not know what a sticky note is: an object whose type is unknown to this build is not
 * rendered, is not deleted, and stays in every selection it was in, waiting for a client that can
 * draw it.
 */
export function ObjectView(props: ObjectProps): ReactNode {
  const spec = getObjectType(props.obj.type);
  if (spec === undefined) return null;
  const Component = spec.Component;
  return <Component {...props} />;
}

// The types this build ships with. Stories 10-12 add their own line here and nothing else.
registerObjectType<StickySnapshot>(STICKY_OBJECT_TYPE, {
  Component: StickyNote,
  // A note is a note: it has a size and a handle can change it.
  resizable: true,
  // …and it is a square of paper, so a corner handle scales it and an edge handle squares it up.
  aspectLocked: true,
  // The size a note stops at when it is dragged smaller than that, and the size a note of this build
  // that never recorded a width is assumed to be.
  minSize: STICKY_MIN_SIZE_WORLD,
  // Its body is the text; Enter opens it.
  editableText: true,
  // A sticky note is exactly where its bounds say it is, to the last unit and not one beyond.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
});

registerObjectType<TextSnapshot>(TEXT_OBJECT_TYPE, {
  Component: TextObject,
  // A text object has a width, and a handle can change it.
  resizable: true,
  // …but no proportion of any kind: its height is the number of lines its content makes, so a handle
  // that scaled width and height together would be writing a height that the next keystroke undoes.
  aspectLocked: false,
  // The narrowest a text column may be dragged to, and the width a fixed width never goes below.
  minSize: TEXT_MIN_WIDTH_WORLD,
  // Its body is the text; Enter opens it, and so does a double-click on it.
  editableText: true,
  // Two handles, on the sides: nothing on this board makes a text object taller but more text.
  handles: 'horizontal',
  // The box the document holds is the whole of it: the selection, the marquee and a click all agree
  // with the pixels on the answer the measurement wrote.
  hitTest: (obj, worldPoint) => rectContainsPoint(objectBounds(obj), worldPoint),
});
