/**
 * The object type registry (`sel.all_types`).
 *
 * One entry per board object type, and the *only* place a type may say anything
 * about how it behaves on the board: whether it can be resized, whether it keeps
 * its proportions, how small it may go, whether it has editable text, and how to
 * tell whether a point is on it. Selection, moving, resizing and deleting are
 * generic — they live in `board/` and are written once for every type, so stories
 * 9-12 add a `registerObjectType` call and no selection code at all.
 */

import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import { objectBounds, STICKY_TYPE, TEXT_TYPE } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { STICKY_MIN_SIZE_WORLD, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';

/** What the board renders one object with; the same props for every type. */
export interface ObjectProps {
  /** The object to draw, exactly as the document holds it. */
  readonly object: ObjectSnapshot;
  readonly doc: Y.Doc;
  /** Camera zoom, so screen-space chrome can inverse-scale itself. */
  readonly zoom: number;
  readonly selected: boolean;
  readonly editing: boolean;
  /**
   * True while a move or resize gesture has this object in hand: it is how an
   * object says `data-dragging`, and how a type can get out of the way (the
   * selection bar hides its controls) without asking the gesture anything.
   */
  readonly dragging: boolean;
  /** False while this client may not write to the board (`canEdit`). */
  readonly editable: boolean;
  /**
   * This person's undo history (story 8), for the types that take text: an edit
   * is one undo step of its own, and Ctrl/Cmd+Z typed into the object belongs to
   * the board rather than to the browser's field. Types without text ignore it.
   */
  readonly undo?: UndoController | undefined;
  /** pointerdown on the object: select it, and maybe start moving it. */
  onObjectPointerDown(event: ReactPointerEvent<HTMLElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/** Everything one object type declares about itself. */
export interface ObjectTypeSpec {
  readonly Component: ComponentType<ObjectProps>;
  readonly resizable: boolean;
  readonly aspectLocked: boolean;
  readonly minSize: number;
  readonly editableText: boolean;
  /**
   * Which handles this type accepts (`sel.resize`, and story 9's `text.fixed_width`):
   * `'all'` (the default) is the eight corners and edges a box has; `'horizontal'`
   * is the two side edges only, for a type whose height is not its own to give —
   * text takes as many lines as its words need, so pulling its bottom would be
   * pulling at a measurement.
   */
  readonly handles?: 'all' | 'horizontal';
  /** Is `worldPoint` on `object`? Used by hit testing, never by the renderer. */
  hitTest(object: ObjectSnapshot, worldPoint: Point): boolean;
}

/** The handles a type accepts, when it said nothing: all eight. */
export function objectHandles(type: string): 'all' | 'horizontal' {
  return specs.get(type)?.handles ?? 'all';
}

/** What is registered, in registration order. Written only by `registerObjectType`. */
const specs = new Map<string, ObjectTypeSpec>();

/**
 * Register `type`. Called at module load, and a second attempt at a type that is
 * already registered is refused: two components answering for one type would
 * mean a board whose objects are resizable on one screen and not on another,
 * and the duplicate would be found as a wrong selection rather than as an error.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (specs.has(type)) {
    throw new Error(`object type ${JSON.stringify(type)} is already registered`);
  }
  specs.set(type, spec);
}

/** The spec of `type`, or `undefined` when nothing can draw that type. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return specs.get(type);
}

/** Whether this build can draw `type`; what select-all and hit testing ask. */
export function isObjectType(type: string): boolean {
  return specs.has(type);
}

/** The types this build has registered, in registration order. */
export function objectTypeNames(): string[] {
  return [...specs.keys()];
}

/**
 * The sticky note, registered like any other type: a square that can be resized
 * but never un-square, no smaller than `STICKY_MIN_SIZE_WORLD`, with text you can
 * type into, and rectangular to the touch.
 */
registerObjectType(STICKY_TYPE, {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (object, point) => {
    const bounds = objectBounds(object);
    return (
      point.x >= bounds.x &&
      point.y >= bounds.y &&
      point.x <= bounds.x + bounds.width &&
      point.y <= bounds.y + bounds.height
    );
  },
});

/**
 * Text, registered the same way and the first type added purely by registering it:
 * `sel.all_types` promised that a new object type is a `registerObjectType` call
 * and no selection code, and story 9 is holding that promise — selection, marquee,
 * arrow keys, delete, duplicate, group moves and undo are all untouched here.
 *
 * It can be resized, but its proportions are its words' doing, and the smallest it
 * may be squeezed is one short word wide. Its handles are the two side edges only:
 * a text's width is the one thing about it a person may choose, and its height is
 * the consequence (`text.fixed_width`, `text.height`).
 */
registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  aspectLocked: false,
  minSize: TEXT_MIN_WIDTH_WORLD,
  editableText: true,
  handles: 'horizontal',
  hitTest: (object, point) => {
    const bounds = objectBounds(object);
    return (
      point.x >= bounds.x &&
      point.y >= bounds.y &&
      point.x <= bounds.x + bounds.width &&
      point.y <= bounds.y + bounds.height
    );
  },
});
