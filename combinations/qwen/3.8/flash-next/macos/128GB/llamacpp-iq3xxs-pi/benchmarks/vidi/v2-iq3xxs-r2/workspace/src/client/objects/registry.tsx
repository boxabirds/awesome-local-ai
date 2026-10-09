import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import {
  markObjectTypeKnown,
  objectBounds,
  STICKY_TYPE,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { setTextWidthFixed, TEXT_TYPE } from '../../shared/objects/text';
import { rectContains, type Point, type Rect } from '../../shared/geometry';
import type { EndEditNext } from '../board/useSelection';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/**
 * The object type registry (`sel.registry`): the one place that knows what a board object
 * type can do. A type declares *only* whether it can be resized, whether it keeps its
 * proportions, how small it may go, whether its text can be edited, and how a point hits
 * it. Selecting, moving, resizing and deleting stay generic, so stories 9–12 add a type
 * without adding a line of interaction code (sel.all_types).
 */

/**
 * What every object type is handed: the object's own data, plus this client's local
 * selection/editing state and the one gesture entry point. Nothing else, so a new type
 * cannot reach into selection machinery even by accident.
 */
export interface ObjectProps {
  object: ObjectSnapshot;
  doc: Y.Doc;
  /** Camera zoom, for anything that must stay the same size on screen (toolbars). */
  zoom: number;
  /** Is this object part of what this client has selected? */
  selected: boolean;
  /** How many objects this client has selected; a toolbar appears for exactly one. */
  selectedCount: number;
  /** This object's text is being edited. */
  editing: boolean;
  /** A board that could not be loaded refuses edits but still allows selecting. */
  readOnly: boolean;
  /** A transform gesture (move or resize) is running on this client's board. */
  dragging: boolean;
  /** Pressing an object is the start of a possible move: the gesture owns it from here. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  /** Selecting without a pointer: keyboard focus reaching an object. */
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
}

/** What a type declares about itself. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** False for a type that is placed but never resized: no handles are shown for it. */
  resizable: boolean;
  /** True when resizing must keep the box's ratio (a sticky note, an image). */
  aspectLocked: boolean;
  /** The smallest side this type allows, in board units. */
  minSize: number;
  /** True when the object carries text the user can type into (story 2 stickies). */
  editableText: boolean;
  /**
   * Which handles a selection of only this type gets. `'horizontal'` for a type whose height
   * is its content and cannot be dragged (a text object): the box is drawn, and only its two
   * side handles are. Absent means every handle.
   */
  handles?: 'all' | 'horizontal';
  /**
   * Resize one object of this type to `to`, for a type where resizing is not simply making
   * its box that size: a text object stores a *width mode* next to its width, so its side
   * handle pins the width instead of scaling a box. Absent means the generic box resize.
   */
  resizeObject?(doc: Y.Doc, id: string, to: Rect): void;
  /** Is `worldPoint` on this object? Rectangular types: inside their bounds. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

/** Every type this build knows. Populated at import; nothing clears it. */
const TYPES = new Map<string, ObjectTypeSpec>();

/**
 * Declare an object type. Called once per type at module load — stories 9–12 add a type by
 * registering it here and by importing their module, and get selecting, moving, resizing,
 * deleting, handles, marquee, keyboard and undo-boundary behaviour without writing any of
 * it themselves (sel.all_types).
 *
 * Registering the same name twice is a programming error that would silently replace the
 * spec of a type that is probably on screen already, so it throws at import instead.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error('registerObjectType: an object type needs a name');
  }
  if (TYPES.has(type)) {
    throw new Error(`registerObjectType: object type "${type}" is already registered`);
  }
  TYPES.set(type, spec);
  // The model reads every object, but only selects the types it was told about (TC-08).
  markObjectTypeKnown(type);
}

/** The spec for `type`, or undefined when this build does not know it (TC-12). */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  if (typeof type !== 'string') return undefined;
  return TYPES.get(type);
}

/**
 * The component that draws `object`, or undefined — in which case the board draws nothing
 * for it. Unknown types are skipped rather than thrown about, so a document written by a
 * later build cannot break this one.
 */
export function getObjectComponent(object: ObjectSnapshot): ComponentType<ObjectProps> | undefined {
  return getObjectType(object.type)?.Component;
}

/** The specs of a whole selection, skipping types nobody registered (unknown objects). */
export function specsFor(objects: readonly ObjectSnapshot[]): ObjectTypeSpec[] {
  const specs: ObjectTypeSpec[] = [];
  for (const object of objects) {
    const spec = getObjectType(object.type);
    if (spec) specs.push(spec);
  }
  return specs;
}

/**
 * The hit test every rectangular type so far needs (TC-11): a point on the object's box,
 * edges included. An image with a transparent background (story 12) declares its own.
 */
export function boundsContain(object: ObjectSnapshot, worldPoint: Point): boolean {
  return rectContains(objectBounds(object), {
    x: worldPoint.x,
    y: worldPoint.y,
    width: 0,
    height: 0,
  });
}

registerObjectType(STICKY_TYPE, {
  Component: StickyNote,
  // A sticky note may be resized, keeps its square, and never gets smaller than 50 units.
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: boundsContain,
});

/**
 * What a text object's side handle does: pin the width the drag reached, which brings the
 * fixed width mode with it. Height is not asked for — it is what the text now needs, and the
 * client that made the drag measures it (`useTextBoxSync`).
 */
function resizeTextWidth(doc: Y.Doc, id: string, to: Rect): void {
  setTextWidthFixed(doc, id, to.width);
}

registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  // Wider, never taller: the height is the text, and the narrowest it may be pinned to is
  // the narrowest box one of these can have.
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  resizeObject: resizeTextWidth,
  hitTest: boundsContain,
});
