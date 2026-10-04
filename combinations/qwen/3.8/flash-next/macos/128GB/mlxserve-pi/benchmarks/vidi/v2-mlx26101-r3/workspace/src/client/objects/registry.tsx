import type { ComponentType, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { STICKY_MIN_SIZE_WORLD, TEXT_FONT_FAMILY } from '../../shared/config';
import {
  LOCAL_ORIGIN,
  STICKY_TYPE,
  moveObjects,
  objectBounds,
  registerObjectReader,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { rectContainsPoint, type Point, type Rect } from '../../shared/geometry';
import { TEXT_TYPE, getTextFields, setTextWidthFixed } from '../../shared/objects/text';
import type { EditEnd } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { createCanvasMeasurer } from './textLayout';
import { remeasureTextBox } from './useTextBoxSync';

/** A pointer event as it arrives from React or from the window. */
export type ObjectPointerEvent = ReactPointerEvent<HTMLElement> | PointerEvent;

/**
 * What the board hands an object component to draw it.
 *
 * Every object type is drawn from the same props: the object's own data plus what the board
 * knows that the object cannot know for itself - whether it is selected, whether it is being
 * typed in, how far away the camera is, and whether this person is allowed to write at all. The
 * three callbacks are the only way back out, and they are the board's generic gestures: this is
 * where a press goes to be turned into a move or a resize, whatever the object is.
 */
export interface ObjectProps {
  /** Plain data, from the board model's snapshot. */
  object: ObjectSnapshot;
  /** Operations go to the document, never to props or local state. */
  doc: Y.Doc;
  /** Current zoom, so screen movement can be turned into world movement. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /**
   * True while a move or resize gesture is carrying this object: the outline is drawn by the
   * selection overlay, and the object itself stops showing its toolbar mid-drag.
   */
  transforming: boolean;
  /**
   * Whether this object may be written to. False while the board could not be loaded: the object
   * can still be looked at and selected, but nothing here writes to the document, because what
   * is on screen is not known to be the board.
   */
  canEdit: boolean;
  /** A press on the object: selection, then a possible move (the transform gesture takes it). */
  onObjectPointerDown(event: ObjectPointerEvent, id: string): void;
  /** The browser taking pointer capture away mid-gesture (see story 2's notes on this). */
  onObjectLostPointerCapture(event: ObjectPointerEvent, id: string): void;
  onStartEdit(id: string): void;
  /** Escape keeps the object selected; a press outside it deselects. */
  onEndEdit(next: EditEnd): void;
  /**
   * This person's undo history, for the two things an object type owns and the board cannot
   * know about: a spell of typing, which is one step rather than one per letter, and Ctrl/Cmd+Z
   * pressed while the object's own text field has the keyboard. Left out, the object does not
   * group its own edits - which is what a component mounted on its own, outside a board, does.
   */
  undo?: UndoController;
}

/**
 * What the board needs to know about one object type, and the only thing it needs to know.
 *
 * Selection, moving, resizing and deleting are written once, for every type, in terms of an
 * object's box ({@link ObjectSnapshot}) and these few knobs: whether the type can be resized at
 * all, whether resizing keeps its proportions, how small and how big it may be, whether it has
 * text to type into, and whether a point hits it. Stories 9-12 add types by registering a
 * component and answering those questions - not by writing another gesture.
 */
export interface ObjectTypeSpec {
  /** The component that draws one object of this type. */
  Component: ComponentType<ObjectProps>;
  /** Whether the type shows resize handles at all. */
  resizable: boolean;
  /** Whether a resize keeps the width-to-height ratio (a sticky note stays square). */
  aspectLocked: boolean;
  /** Smallest width or height the type may be resized to, in world units. */
  minSize: number;
  /** Whether the object has text a person can type into (Enter opens it). */
  editableText: boolean;
  /**
   * Which resize handles a selection of nothing but this type offers. `'all'` (or left out) is the
   * usual eight, because both axes are sizes this object can be given. `'horizontal'` is for an
   * object whose height is not a size but a consequence - a text object's height is how many lines
   * its words came to - so it is offered on the two sides only. A selection that also holds
   * anything else offers all eight, because the box being dragged belongs to the group.
   */
  handles?: 'all' | 'horizontal';
  /** Whether `world` lies on this object; the marquee and future hit-testing use it. */
  hitTest(object: ObjectSnapshot, world: Point): boolean;
  /**
   * This type writes its own resize, given the box the gesture worked out for one object of it:
   * called instead of the generic `resizeObjects` for objects of this type.
   *
   * `direct` says whether the person is dragging one of *this type's own* handles - a `'horizontal'`
   * type's side handle, on a selection of nothing but this type - in which case the width in the box
   * is the thing they asked for. In a mixed selection the handles belong to the group's shape and
   * the object is only being carried along with it, which is a different question to answer.
   *
   * A text object uses this to keep its height for itself: take the width, go where the group's
   * scaling put the top-left, then measure the height the words need at that width. The gesture has
   * no idea any of that is happening, which is the point of asking the type rather than knowing.
   */
  applyResize?(doc: Y.Doc, id: string, box: Rect, direct: boolean): void;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. A duplicate is a programming error and throws: two specs for one
 * type would mean the board silently drawing one and resizing it by the other's rules, which is
 * a bug nobody would see until an object behaved differently on two screens.
 *
 * Registering a type also tells the board model to read objects of that type, so one call is
 * enough to make a new type appear on the board.
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`the board object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  registerObjectReader(type);
}

/** The spec of a type this client knows, or `undefined` for one it does not. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

/** The types this client can draw, in registration order. */
export function registeredObjectTypes(): readonly string[] {
  return [...registry.keys()];
}

/** A sticky note is a square that stays a square, and is the whole of its box. */
registerObjectType(STICKY_TYPE, {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: (object, world) => rectContainsPoint(objectBounds(object), world),
});

/**
 * The canvas that resize gestures measure text against: made once, like every other measurer here,
 * and on a machine that will not give a context it measures by estimate.
 */
const resizeMeasurer = createCanvasMeasurer(TEXT_FONT_FAMILY);

/**
 * Free text anywhere on the board (story 9): words with nothing around them, sized by four buttons
 * and as tall as the lines they come to.
 */
registerObjectType(TEXT_TYPE, {
  Component: TextObject,
  resizable: true,
  // Four sizes, no way to set a font size, and a height that belongs to the words: a shape that
  // cannot be stretched in one direction has no proportion for a resize to hold on to.
  aspectLocked: false,
  // No minimum through the generic resize clamp, deliberately: a minimum there is a minimum on
  // *both* axes, and a minimum height for a text object would be a limit on how short a line of
  // text is allowed to be - one line of small text selected alongside a note would make the group
  // refuse to be scaled down at all. The width has its own minimum (TEXT_MIN_WIDTH_WORLD), applied
  // where the width is written; the height is measured, not given.
  minSize: 0,
  // Takes text entry exactly as a note does: the same editing state, the same Escape and Enter keys.
  editableText: true,
  // The height is the lines the words came to, so the width is the only size to be had.
  handles: 'horizontal',
  hitTest: (object, world) => rectContainsPoint(objectBounds(object), world),
  applyResize: (doc, id, box, direct) => {
    const fields = getTextFields(doc, id);
    if (fields === null) {
      // Gone from the board while the gesture was underway: there is nothing here to resize, and
      // writing a box would not bring it back.
      return;
    }
    // The width is what was asked for when the person has this type's own side handle in hand, and
    // when the box already had a width written down for it. Otherwise the words keep the width they
    // were wrapped at: rewrapping a sentence because a *note* in the same selection was scaled is
    // not a thing anybody meant when they dragged its corner.
    const wantsWidth = direct || fields.widthMode === 'fixed';
    // One transaction for the whole of this object's resize, so a frame of a drag is one update on
    // the wire, and so the resize is one undoable thing rather than a move, a width and a height.
    doc.transact(() => {
      if (fields.x !== box.x || fields.y !== box.y) {
        moveObjects(doc, new Map<string, Point>([[id, { x: box.x, y: box.y }]]));
      }
      if (wantsWidth) {
        setTextWidthFixed(doc, id, box.width);
      }
      // Never the height that came in the box: the height is what the words need at this width and
      // this size, which is the one measurement on the board that is not a matter of opinion.
      remeasureTextBox(doc, id, resizeMeasurer);
    }, LOCAL_ORIGIN);
  },
});
